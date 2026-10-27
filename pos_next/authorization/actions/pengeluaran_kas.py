# Copyright (c) 2026, BrainWise and contributors
# For license information, please see license.txt

from frappe.utils import flt

from pos_next.authorization.registry import Action, register

ACTION_CASH_EXPENSE = "Cash Expense"
PENGELUARAN_KAS = "Pengeluaran Kas"


def _binding(ctx):
	"""Dipanggil dua kali dengan bentuk konteks berbeda: dari klien (pos_profile +
	amount) dan dari dokumen (gate.context_from_doc, yang amount-nya dari
	grand_total - nol untuk doctype ini, jadi nominalnya dibaca dari doc.total)."""
	doc = ctx.get("doc") or {}
	amount = doc.get("total")
	if amount in (None, ""):
		amount = ctx.get("amount")
	return {
		"pos_profile": doc.get("pos_profile") or ctx.get("pos_profile"),
		"amount": flt(amount),
	}


register(Action(name=ACTION_CASH_EXPENSE, doctype=PENGELUARAN_KAS, binding=_binding))
