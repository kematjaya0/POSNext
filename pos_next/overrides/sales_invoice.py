# Copyright (c) 2025, BrainWise and contributors
# For license information, please see license.txt

"""
Sales Invoice Override
Handles wallet payments that require party information for Receivable accounts.

"""

import frappe
from erpnext.accounts.doctype.sales_invoice.sales_invoice import SalesInvoice
from erpnext.accounts.utils import get_account_currency
from frappe import _
from frappe.utils import cint, flt


def _find_paid_bundle_row_for_free(si_doc, free_row):
	"""Pick the paid SI item row whose bundle qty should absorb this free bundle's packed items."""
	candidates = []
	for row in si_doc.get("items"):
		if row.name == free_row.name or cint(row.is_free_item):
			continue
		if row.item_code != free_row.item_code:
			continue
		if (row.warehouse or "") != (free_row.warehouse or ""):
			continue
		candidates.append(row)
	if not candidates:
		return None
	free_idx = free_row.idx or 0
	before = [r for r in candidates if (r.idx or 0) < free_idx]
	if before:
		return max(before, key=lambda r: r.idx or 0)
	return candidates[0]


def _find_matching_packed_item_for_merge(si_doc, paid_row, component_item_code, warehouse):
	"""Match a packed item on the paid bundle line; prefer same warehouse."""
	w = warehouse or ""
	matches = []
	for pi in si_doc.get("packed_items"):
		if pi.parent_detail_docname != paid_row.name:
			continue
		if pi.parent_item != paid_row.item_code:
			continue
		if pi.item_code != component_item_code:
			continue
		matches.append(pi)
	if not matches:
		return None
	for pi in matches:
		if (pi.warehouse or "") == w:
			return pi
	return matches[0]


def _get_post_change_gl_entries_setting():
	"""
	Get post_change_gl_entries setting compatible with ERPNext v15 and v16.

	- ERPNext v15: Field is in 'Accounts Settings'
	- ERPNext v16: Field moved to ERPNext's 'POS Settings' (singleton)

	Since pos_next has its own 'POS Settings' doctype (non-singleton) that overrides
	ERPNext's, we read directly from the Singles table for v16 compatibility.

	Returns:
		int: 1 if post_change_gl_entries is enabled, 0 otherwise (default: 0)
	"""
	# Check if field exists in Accounts Settings schema (v15)
	meta = frappe.get_meta("Accounts Settings")
	if meta.has_field("post_change_gl_entries"):
		value = frappe.db.get_single_value("Accounts Settings", "post_change_gl_entries")
		return cint(value) if value is not None else 0

	# For v16, read directly from Singles table using Query Builder to avoid ORM issues
	# ERPNext's POS Settings is a singleton, data stored in Singles table
	Singles = frappe.qb.DocType("Singles")
	result = (
		frappe.qb.from_(Singles)
		.select(Singles.value)
		.where(Singles.doctype == "POS Settings")
		.where(Singles.field == "post_change_gl_entries")
		.limit(1)
		.run()
	)
	return cint(result[0][0]) if result else 0


def _resolve_pos_customer(invoice_doc):
	"""Return a valid Customer name for POS invoices, or None."""
	customer = (invoice_doc.get("customer") or "").strip()
	if customer and frappe.db.exists("Customer", customer):
		return customer

	pos_profile = invoice_doc.get("pos_profile")
	if pos_profile:
		default_customer = frappe.db.get_value("POS Profile", pos_profile, "customer")
		if default_customer and frappe.db.exists("Customer", default_customer):
			return default_customer

	return None


def _foreign_company_pos_profile(pos_profile, company):
	"""POS Profile values for a sale billed to another company of the branch.

	A branch runs one POS Profile, yet a sale can take stock from another
	company's warehouse (PT/CV split). That invoice keeps the cashier's profile
	(naming, shift, price list, payment modes) but every value bound to the
	profile's company comes from `company`'s defaults instead.
	"""
	from erpnext.setup.doctype.company.company import get_default_company_address

	pos = frappe.get_cached_doc("POS Profile", pos_profile).as_dict()
	defaults = frappe.get_cached_value(
		"Company", company, ["cost_center", "write_off_account", "default_cash_account"], as_dict=True
	)
	pos.update(
		{
			"company": company,
			"cost_center": defaults.cost_center,
			"write_off_account": defaults.write_off_account,
			"write_off_cost_center": defaults.cost_center,
			"account_for_change_amount": defaults.default_cash_account,
			"taxes_and_charges": frappe.db.get_value(
				"Sales Taxes and Charges Template",
				{"company": company, "is_default": 1, "disabled": 0},
				"name",
			),
			"company_address": get_default_company_address(company),
			"income_account": None,
			"expense_account": None,
			"warehouse": None,
		}
	)
	return pos


class CustomSalesInvoice(SalesInvoice):
	"""
	Custom Sales Invoice class that handles wallet payments correctly.

	When a wallet payment is made using a Receivable account, ERPNext requires
	party information in the GL entry. This override adds party_type and party
	for wallet payment methods marked with is_wallet_payment.
	"""

	def is_foreign_company_pos(self):
		if not cint(self.is_pos) or not self.pos_profile or not self.company:
			return False
		return frappe.get_cached_value("POS Profile", self.pos_profile, "company") != self.company

	def set_pos_fields(self, for_validate=False):
		if not self.is_foreign_company_pos():
			return super().set_pos_fields(for_validate)

		# Mirrors SalesInvoice.set_pos_fields, fed the company-adjusted profile.
		from erpnext.accounts.doctype.sales_invoice.sales_invoice import update_multi_mode_option
		from erpnext.stock.get_item_details import ItemDetailsCtx, get_pos_profile_item_details_

		pos = _foreign_company_pos_profile(self.pos_profile, self.company)

		if not for_validate:
			update_multi_mode_option(self, pos)
			self.tax_category = pos.get("tax_category")
			self.ignore_pricing_rule = pos.ignore_pricing_rule
			if not self.customer:
				self.customer = pos.customer

		self.account_for_change_amount = pos.account_for_change_amount
		for fieldname in (
			"currency",
			"letter_head",
			"tc_name",
			"select_print_heading",
			"write_off_account",
			"taxes_and_charges",
			"write_off_cost_center",
			"apply_discount_on",
			"cost_center",
		):
			if (not for_validate) or (for_validate and not self.get(fieldname)):
				self.set(fieldname, pos.get(fieldname))

		self.company_address = pos.company_address
		if not self.selling_price_list:
			self.selling_price_list = pos.selling_price_list

		for item in self.get("items"):
			if item.get("item_code"):
				details = get_pos_profile_item_details_(
					ItemDetailsCtx(item.as_dict()), pos, pos, update_data=True
				)
				for fname, val in details.items():
					if (not for_validate) or (for_validate and not item.get(fname)):
						item.set(fname, val)

		if self.tc_name and not self.terms:
			self.terms = frappe.db.get_value("Terms and Conditions", self.tc_name, "terms")
		if self.taxes_and_charges and not len(self.get("taxes")):
			self.set_taxes()

		return pos

	def validate(self):
		if cint(self.is_pos):
			self._ensure_pos_customer()
			self._validate_pos_payment_accounts()
		super().validate()

	def on_submit(self):
		# Re-align after fetch_from so ERPNext's loyalty branch does not run on a
		# credit note whose original invoice has no loyalty_program.
		from pos_next.api.sales_invoice_hooks import sync_return_loyalty_program

		sync_return_loyalty_program(self)
		super().on_submit()

	def _ensure_pos_customer(self):
		"""POS invoices always need a customer for Receivable GL entries (debit_to)."""
		customer = _resolve_pos_customer(self)
		if not customer:
			frappe.throw(
				_(
					"Customer is required. Please select a customer or configure a default customer in POS Profile."
				),
				title=_("Customer Required"),
			)

		self.customer = customer
		if not self.customer_name:
			self.customer_name = frappe.db.get_value("Customer", customer, "customer_name")

	def make_pos_gl_entries(self, gl_entries):
		"""
		Override to add party information for wallet / receivable payment accounts.

		The standard ERPNext implementation doesn't set party_type/party for
		payment mode accounts, which causes validation errors for Receivable
		accounts (like wallet accounts).
		"""
		if cint(self.is_pos):
			skip_change_gl_entries = not _get_post_change_gl_entries_setting()

			for payment_mode in self.payments:
				if skip_change_gl_entries and payment_mode.account == self.account_for_change_amount:
					payment_mode.base_amount -= flt(self.change_amount)

				against_voucher = self.name
				if self.is_return and self.return_against and not self.update_outstanding_for_self:
					against_voucher = self.return_against

				payment_amount = flt(payment_mode.base_amount) or flt(payment_mode.amount)
				if not payment_amount:
					continue

				# Credit customer receivable (payment received against the invoice)
				gl_entries.append(
					self.get_gl_dict(
						{
							"account": self.debit_to,
							"party_type": "Customer",
							"party": self.customer,
							"against": payment_mode.account,
							"credit": payment_amount,
							"credit_in_account_currency": payment_amount
							if self.party_account_currency == self.company_currency
							else payment_mode.amount,
							"against_voucher": against_voucher,
							"against_voucher_type": self.doctype,
							"cost_center": self.cost_center,
						},
						self.party_account_currency,
						item=self,
					)
				)

				# Debit the payment-mode account (Cash/Bank/another Receivable, etc.)
				payment_mode_account_currency = get_account_currency(payment_mode.account)
				party_type, party = self.get_party_and_party_type_for_pos_gl_entry(
					payment_mode.mode_of_payment, payment_mode.account
				)

				gl_entries.append(
					self.get_gl_dict(
						{
							"account": payment_mode.account,
							"party_type": party_type,
							"party": party,
							"against": self.customer,
							"debit": payment_amount,
							"debit_in_account_currency": payment_amount
							if payment_mode_account_currency == self.company_currency
							else payment_mode.amount,
							"cost_center": self.cost_center,
						},
						payment_mode_account_currency,
						item=self,
					)
				)

			if not skip_change_gl_entries:
				if hasattr(self, "get_gle_for_change_amount"):
					gl_entries.extend(self.get_gle_for_change_amount())
				else:
					self.make_gle_for_change_amount(gl_entries)

	def _validate_pos_payment_accounts(self):
		"""Payment modes must not post to the same account as debit_to."""
		if not self.payments or not self.debit_to:
			return

		for payment in self.payments:
			if not payment.account or not flt(payment.amount):
				continue
			if payment.account == self.debit_to:
				frappe.throw(
					_(
						"Mode of Payment {0} uses account {1}, which is the same as the invoice receivable account. "
						"Please set a Cash or Bank account on the Mode of Payment."
					).format(payment.mode_of_payment, self.debit_to),
					title=_("Invalid Payment Account"),
				)

	def validate_pos_paid_amount(self):
		"""
		Allow POS sales to submit without a payment row in two cases:

		1. Pure customer-credit redemption — POSNext redeems existing customer
		   credit after submit through Journal Entries / Payment Entry allocation,
		   so there is no real Mode of Payment row to send.
		2. "Pay on Account" credit sales — the cashier intentionally puts the full
		   amount on the customer's account, leaving the invoice outstanding.

		Both are only honoured when submit_invoice has explicitly marked the
		document via the corresponding flag (set after verifying the POS Settings
		permit the operation), so a tampered client can't bypass the check.
		"""
		if getattr(self.flags, "pos_next_redeemed_customer_credit", 0) or getattr(
			self.flags, "pos_next_credit_sale", 0
		):
			if len(self.payments) == 0 and cint(self.is_pos) and flt(self.grand_total) > 0:
				return

		super().validate_pos_paid_amount()

	def get_party_and_party_type_for_pos_gl_entry(self, mode_of_payment, account):
		"""
		Get party type and party for POS payment GL entries.

		ERPNext requires party on GL entries against Receivable/Payable accounts.
		Wallet modes and any payment mode linked to a Receivable account need the
		invoice customer as party.
		"""
		party_type, party = "", ""

		if not account or not self.customer:
			return party_type, party

		is_wallet_mode_of_payment = frappe.db.get_value(
			"Mode of Payment", mode_of_payment, "is_wallet_payment"
		)
		account_type = frappe.get_cached_value("Account", account, "account_type")

		if is_wallet_mode_of_payment or account_type == "Receivable":
			party_type, party = "Customer", self.customer

		return party_type, party

	def make_loyalty_point_entry(self):
		"""Skip ERPNext loyalty ledger when this invoice has no program.

		Return invoices copy-map with no_copy on loyalty_program, then fetch the
		customer's current program. ERPNext then recalculates points on the
		original invoice. If that original has loyalty_program=None,
		get_loyalty_program_details_with_points does get_doc("Loyalty Program", None).
		"""
		if not self.loyalty_program:
			return
		return super().make_loyalty_point_entry()

	def set_loyalty_program_tier(self):
		if not self.loyalty_program:
			return
		return super().set_loyalty_program_tier()

	def update_packing_list(self):
		super().update_packing_list()
		self._combine_packed_qty_for_free_product_bundles()
		self._set_use_serial_batch_fields_on_packed_items()

	def _set_use_serial_batch_fields_on_packed_items(self):
		"""
		Force packed_items for batch/serial-tracked Items to use legacy fields path.

		ERPNext's auto-SBB creation during SLE.on_submit fails to link the bundle
		because SBB.voucher_detail_no gets remapped to the parent SI Item row name
		(set_serial_and_batch_values) while validation expects either a matching SLE
		or a Packed Item with that name. Routing through use_serial_batch_fields=1
		bypasses the broken auto-creation for the row.
		"""
		if not self.get("packed_items"):
			return
		for pi in self.get("packed_items"):
			if pi.get("serial_and_batch_bundle"):
				continue
			tracking = frappe.get_cached_value(
				"Item",
				pi.item_code,
				["has_batch_no", "has_serial_no"],
				as_dict=True,
			)
			if not tracking:
				continue
			if tracking.has_batch_no or tracking.has_serial_no:
				pi.use_serial_batch_fields = 1

	def _combine_packed_qty_for_free_product_bundles(self):
		"""
		Merge packed_items from free bundle lines into the matching paid bundle line.

		ERPNext builds packed rows per Sales Invoice Item row. For BOGO / pricing-rule
		free rows, the same product bundle often appears twice (paid + is_free_item).
		That duplicates component rows. Stock and picking should follow total bundle
		qty on one set of packed lines tied to the paid row.
		"""
		if self.is_return or not self.get("packed_items"):
			return

		free_bundle_rows = [
			row
			for row in self.get("items")
			if row.item_code and cint(row.is_free_item) and self.has_product_bundle(row.item_code)
		]
		if not free_bundle_rows:
			return

		for free_row in free_bundle_rows:
			paid_row = _find_paid_bundle_row_for_free(self, free_row)
			if not paid_row:
				continue

			to_remove = []
			for pi in list(self.get("packed_items")):
				if pi.parent_detail_docname != free_row.name or pi.parent_item != free_row.item_code:
					continue
				tgt = _find_matching_packed_item_for_merge(self, paid_row, pi.item_code, pi.warehouse)
				if tgt:
					prec = tgt.precision("qty")
					tgt.qty = flt(flt(tgt.qty) + flt(pi.qty), prec)
					to_remove.append(pi)

			for pi in to_remove:
				self.remove(pi)
