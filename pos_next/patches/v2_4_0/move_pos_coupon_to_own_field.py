# Copyright (c) 2026, BrainWise and contributors
# For license information, please see license.txt

"""Move the POS Coupon code off ERPNext's Sales Invoice.coupon_code.

A Custom Field named ``coupon_code`` (Data) was added to Sales Invoice to hold
POS Coupon codes, but ERPNext already has a standard ``coupon_code`` (Link to
Coupon Code). Frappe keys meta fields by fieldname, so the custom one replaced
the standard one and the fieldname appeared twice in the meta. Every later
Custom Field save on Sales Invoice then failed with "Fieldname coupon_code
appears multiple times", and ERPNext still ran validate_coupon_code /
update_coupon_code_count on the POS code as if it were a Coupon Code.

POS Coupon codes now live in ``posa_coupon_code``. This patch:

1. drops the shadowing Custom Field row with ``frappe.db.delete`` (not
   ``delete_doc``), so the ``coupon_code`` column stays for ERPNext's field;
2. syncs pos_next's customizations now, because Frappe only syncs them after
   the post_model_sync patches and step 3 needs the new column;
3. moves values that are not an ERPNext Coupon Code into ``posa_coupon_code``.

Idempotent.
"""

import frappe
from frappe.modules.utils import sync_customizations


def execute():
	if not frappe.db.exists("Custom Field", "Sales Invoice-coupon_code"):
		return

	frappe.db.delete("Custom Field", {"name": "Sales Invoice-coupon_code"})
	frappe.clear_cache(doctype="Sales Invoice")
	sync_customizations("pos_next")

	frappe.db.sql(
		"""
		update `tabSales Invoice`
		set posa_coupon_code = coupon_code, coupon_code = null
		where ifnull(coupon_code, '') != ''
			and coupon_code not in (select name from `tabCoupon Code`)
		"""
	)
