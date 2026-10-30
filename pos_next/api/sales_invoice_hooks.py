# Copyright (c) 2025, BrainWise and contributors
# For license information, please see license.txt

"""
Sales Invoice Hooks
Event handlers for Sales Invoice document events
"""

import frappe
from frappe import _
from frappe.utils import cint


def validate(doc, method=None):
	"""
	Validate hook for Sales Invoice.
	Auto-assign loyalty program to customer if enabled.
	Keep return invoices aligned with the original invoice's loyalty program.

	Taxes follow the Sales Taxes and Charges Template as is, "included in
	print rate" included: the POS Settings tax_inclusive toggle that used to
	override it is gone (it added PPN on top of prices that already held it).

	Args:
		doc: Sales Invoice document
		method: Hook method name (unused)
	"""
	auto_assign_loyalty_program_on_invoice(doc)
	sync_return_loyalty_program(doc)


def auto_assign_loyalty_program_on_invoice(doc):
	"""
	Auto-assign loyalty program to customer if loyalty is enabled in POS Settings
	but customer doesn't have a loyalty program yet.

	This ensures customers created before loyalty was enabled can still earn points.
	The invoice itself must also carry loyalty_program — ERPNext's on_submit
	checks the invoice field, not the customer.

	Args:
		doc: Sales Invoice document
	"""
	if doc.get("is_return"):
		return

	if not doc.is_pos or not doc.pos_profile or not doc.customer:
		return

	from pos_next.services.miraaya_loyalty import is_magento_loyalty_mode

	if is_magento_loyalty_mode(doc.pos_profile):
		return

	# Check if customer already has a loyalty program
	customer_loyalty = frappe.db.get_value("Customer", doc.customer, "loyalty_program")
	if customer_loyalty:
		if not doc.loyalty_program:
			doc.loyalty_program = customer_loyalty
		return

	# Get POS Settings
	pos_settings = frappe.db.get_value(
		"POS Settings",
		{"pos_profile": doc.pos_profile},
		["enable_loyalty_program", "default_loyalty_program"],
		as_dict=True,
	)

	if not pos_settings:
		return

	if not cint(pos_settings.get("enable_loyalty_program")):
		return

	loyalty_program = pos_settings.get("default_loyalty_program")
	if not loyalty_program:
		return

	# Assign loyalty program to customer and this invoice
	frappe.db.set_value("Customer", doc.customer, "loyalty_program", loyalty_program, update_modified=False)
	if not doc.loyalty_program:
		doc.loyalty_program = loyalty_program


def sync_return_loyalty_program(doc):
	"""Keep credit notes on the original invoice's loyalty program.

	Sales Invoice.loyalty_program is no_copy and fetch_from customer.loyalty_program.
	If the customer was enrolled after the original invoice was submitted, the
	credit note would pick up that program and ERPNext would recalculate loyalty
	on an original invoice whose loyalty_program is empty — raising
	DoesNotExistError: Loyalty Program None not found.
	"""
	if not doc.get("is_return") or not doc.get("return_against"):
		return

	original_program = frappe.db.get_value("Sales Invoice", doc.return_against, "loyalty_program")
	doc.loyalty_program = original_program or None


def record_one_time_offer_usage(doc, method=None):
	"""Record redemption of one-time-per-customer Pricing Rules on submit.

	The applied one-time rules are read from ``pos_applied_one_time_rules`` (a
	JSON list stamped by update_invoice before item.pricing_rules is cleared —
	the cleared field can't be read back here). Inserts a
	``One Time Customer Offer Usage`` row per (customer, rule); the doctype's
	composite name ({customer}::{pricing_rule}) makes a duplicate insert raise
	DuplicateEntryError, so it stays idempotent and race-safe.
	"""
	import json

	if doc.get("is_return") or not doc.get("customer"):
		return

	raw = doc.get("pos_applied_one_time_rules")
	if not raw:
		return
	try:
		rule_names = json.loads(raw)
	except (ValueError, TypeError):
		return
	if not rule_names:
		return

	from frappe.utils import now

	for rule in rule_names:
		try:
			frappe.get_doc(
				{
					"doctype": "One Time Customer Offer Usage",
					"customer": doc.customer,
					"pricing_rule": rule,
					"sales_invoice": doc.name,
					"redemption_date": now(),
				}
			).insert(ignore_permissions=True, ignore_if_duplicate=True)
		except frappe.DuplicateEntryError:
			# Customer already recorded for this rule — one-time guard intact.
			pass


def release_one_time_offer_usage(doc, method=None):
	"""Release one-time redemptions on cancel so the customer can redeem again."""
	frappe.db.delete("One Time Customer Offer Usage", {"sales_invoice": doc.name})


def before_cancel(doc, method=None):
	"""
	Before Cancel hook for Sales Invoice.
	Cancel any credit redemption journal entries.

	Args:
		doc: Sales Invoice document
		method: Hook method name (unused)
	"""
	try:
		from pos_next.api.credit_sales import cancel_credit_journal_entries

		cancel_credit_journal_entries(doc.name)
	except Exception as e:
		frappe.log_error(
			title="Credit Sale JE Cancellation Error",
			message=f"Invoice: {doc.name}, Error: {e!s}\n{frappe.get_traceback()}",
		)
		# Don't block invoice cancellation if JE cancellation fails
		frappe.msgprint(
			_("Warning: Some credit journal entries may not have been cancelled. Please check manually."),
			alert=True,
			indicator="orange",
		)
