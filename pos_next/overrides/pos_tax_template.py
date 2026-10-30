# Copyright (c) 2026, BrainWise and contributors
# For license information, please see license.txt

"""One sales tax template per company for every POS sale.

A sale billed to another company of the branch (PT/CV split) can only take
that company's Default Sales Taxes and Charges Template: the cashier's POS
Profile belongs to a different company. The POS Profiles of that company must
therefore carry the same Default template, or the same item is taxed
differently depending on the cashier who sells it (staging
TXINVTS20261014-00001: PT stock sold at a CV cashier went out without PPN).

* ``validate_pos_profile`` - an empty template takes the company's Default;
  any other template is refused.
* ``validate_template`` - a template POS Profiles use cannot stop being the
  Default (unticked or disabled) before another template replaces it.
* ``sync_pos_profiles`` - the template that becomes the Default moves onto
  every POS Profile of its company. ERPNext unticks the previous Default by
  SQL, without hooks, so this is the only place the change is seen.
"""

import frappe
from frappe import _
from frappe.utils import cint


def default_sales_tax_template(company):
	"""The company's enabled Default Sales Taxes and Charges Template, or None."""
	if not company:
		return None
	return frappe.db.get_value(
		"Sales Taxes and Charges Template",
		{"company": company, "is_default": 1, "disabled": 0},
		"name",
	)


def validate_pos_profile(doc, method=None):
	default = default_sales_tax_template(doc.company)
	if not doc.taxes_and_charges:
		doc.taxes_and_charges = default
		return
	if doc.taxes_and_charges == default:
		return

	if default:
		message = _(
			"Template pajak POS Profile harus template Default {0}: {1}. PPN di kasir selalu "
			"mengikuti template Default, termasuk untuk barang {0} yang dijual lewat kasir company lain."
		).format(doc.company, default)
	else:
		message = _(
			"{0} belum punya Sales Taxes and Charges Template yang ditandai Default. Tandai {1} "
			"sebagai Default, atau kosongkan template pajak di POS Profile ini."
		).format(doc.company, doc.taxes_and_charges)
	frappe.throw(message, title=_("Template Pajak POS"))


def validate_template(doc, method=None):
	if doc.is_new() or not (doc.has_value_changed("is_default") or doc.has_value_changed("disabled")):
		return
	if cint(doc.is_default) and not cint(doc.disabled):
		return

	profiles = frappe.get_all(
		"POS Profile", filters={"company": doc.company, "taxes_and_charges": doc.name}, pluck="name"
	)
	if profiles:
		frappe.throw(
			_(
				"Template {0} dipakai sebagai PPN oleh POS Profile {1}. Tandai template lain sebagai "
				"Default dulu; POS Profile akan ikut pindah ke template itu."
			).format(doc.name, ", ".join(profiles)),
			title=_("Template Pajak POS"),
		)


def sync_pos_profiles(doc, method=None):
	if not cint(doc.is_default) or cint(doc.disabled):
		return

	moved = [
		profile.name
		for profile in frappe.get_all(
			"POS Profile", filters={"company": doc.company}, fields=["name", "taxes_and_charges"]
		)
		if profile.taxes_and_charges != doc.name
	]
	for name in moved:
		frappe.db.set_value("POS Profile", name, "taxes_and_charges", doc.name)
	if moved:
		frappe.msgprint(
			_("POS Profile {0} sekarang memakai template pajak {1}.").format(", ".join(moved), doc.name),
			alert=True,
		)
