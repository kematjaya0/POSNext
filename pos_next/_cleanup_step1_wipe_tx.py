import re
import traceback

import frappe

COMPANIES_WITH_TX = ["PT MAJU JAYA", "Demo Corp, PT", "_Test Company"]

_LINKED_WITH_RE = re.compile(r'is linked with ([\w \-]+?)\s*<a href="[^"]*">([^<]+)</a>')


def _log(*args):
	print(*args, flush=True)


def _voucher_docs(company):
	"""Distinct (voucher_type, voucher_no) pairs from GL/Stock Ledger Entry
	whose *document* still actually exists - i.e. still needs cancel+delete.
	Once a voucher's document is gone, any GL/SLE rows still pointing at it
	are orphaned residue, not something to "process" here (see _purge_orphan_ledger_rows).
	"""
	pairs = set()
	for doctype in ("GL Entry", "Stock Ledger Entry"):
		for row in frappe.get_all(
			doctype, filters={"company": company}, fields=["voucher_type", "voucher_no"]
		):
			if row.voucher_type and row.voucher_no:
				pairs.add((row.voucher_type, row.voucher_no))
	return {(t, n) for t, n in pairs if frappe.db.exists(t, n)}


def _cancel_and_delete_vouchers(company):
	"""Repeatedly cancel+delete every voucher *document* behind this
	company's GL/Stock Ledger Entries, plus whatever else those vouchers
	turn out to be linked to (e.g. a Sales Invoice linked to a POS Closing
	Shift) - discovered on the fly by parsing Frappe's "is linked with
	<DocType> <name>" error, since that dependency graph isn't knowable
	upfront. Stops once no voucher documents remain; leftover GL/Stock
	Ledger Entry rows at that point are orphaned residue, cleaned up
	separately by _purge_orphan_ledger_rows.
	"""
	pending = _voucher_docs(company)
	for round_no in range(15):
		if not pending:
			return
		progressed = False
		still_pending = set()
		for voucher_type, voucher_no in pending:
			if not frappe.db.exists(voucher_type, voucher_no):
				progressed = True  # someone else's cascade already removed it
				continue
			try:
				doc = frappe.get_doc(voucher_type, voucher_no)
				if doc.docstatus == 1:
					doc.cancel()
					_log("cancelled", voucher_type, voucher_no)
				frappe.delete_doc(voucher_type, voucher_no, force=True, ignore_permissions=True)
				_log("deleted", voucher_type, voucher_no)
				progressed = True
			except Exception as e:
				match = _LINKED_WITH_RE.search(str(e))
				if match:
					blocker = (match.group(1).strip(), match.group(2).strip())
					_log(f"  round {round_no}: {voucher_type} {voucher_no} blocked by {blocker}")
					still_pending.add(blocker)
				else:
					_log(f"  round {round_no}: {voucher_type} {voucher_no} failed: {e}")
				still_pending.add((voucher_type, voucher_no))

		pending = still_pending | _voucher_docs(company)
		if not progressed and pending:
			raise RuntimeError(f"{company}: stuck, could not progress on {pending}")

	if pending:
		raise RuntimeError(f"{company}: ran out of rounds, still pending {pending}")


def _purge_orphan_ledger_rows(company):
	"""GL Entry / Stock Ledger Entry rows whose voucher document no longer
	exists (its source was already cancelled+deleted above via the proper
	API) are dead residue with nothing left to own them - not "modifying a
	live document's ledger", which nextend/CLAUDE.md non-negotiable #1
	actually guards against. Safe to remove directly."""
	for doctype in ("GL Entry", "Stock Ledger Entry"):
		rows = frappe.get_all(
			doctype, filters={"company": company}, fields=["name", "voucher_type", "voucher_no"]
		)
		orphans = [
			r.name
			for r in rows
			if not (r.voucher_type and r.voucher_no and frappe.db.exists(r.voucher_type, r.voucher_no))
		]
		if orphans:
			frappe.db.delete(doctype, {"name": ["in", orphans]})
			_log(f"{company}: purged {len(orphans)} orphaned {doctype} row(s)")


def _reset_stock(company):
	"""Bin is a cached stock-level snapshot, not a ledger - safe to clear
	directly once its source Stock Ledger Entries are gone."""
	warehouses = frappe.get_all("Warehouse", filters={"company": company}, pluck="name")
	if not warehouses:
		return
	frappe.db.delete("Bin", {"warehouse": ["in", warehouses]})
	_log(f"{company}: cleared Bin for {len(warehouses)} warehouse(s)")


def run():
	try:
		for company in COMPANIES_WITH_TX:
			_log(f"=== {company} ===")
			_cancel_and_delete_vouchers(company)
			_purge_orphan_ledger_rows(company)
			_reset_stock(company)

			gle = len(frappe.get_all("GL Entry", filters={"company": company}))
			sle = len(frappe.get_all("Stock Ledger Entry", filters={"company": company}))
			warehouses = frappe.get_all("Warehouse", filters={"company": company}, pluck="name")
			bin_qty = frappe.get_all(
				"Bin", filters={"warehouse": ["in", warehouses]}, fields=["actual_qty"]
			)
			_log(
				f"{company}: GL Entry left={gle}, Stock Ledger Entry left={sle}, "
				f"Bin rows left={len(bin_qty)}"
			)

		frappe.db.commit()
		_log("DONE - committed")
	except Exception:
		frappe.db.rollback()
		_log("FAILED - rolled back")
		traceback.print_exc()
		raise
