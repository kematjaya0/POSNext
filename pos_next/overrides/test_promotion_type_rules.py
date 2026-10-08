# Copyright (c) 2026, BrainWise and contributors
# For license information, please see license.txt

import frappe
from frappe.tests import IntegrationTestCase

from pos_next.api.promotions import check_promotion_permissions
from pos_next.overrides.pricing_rule import validate_promotion_type_rules


def scheme(promotion_type, apply_on="Item Code", price=None, product=None, items=("ITEM-A",)):
	"""Unsaved Promotional Scheme - the validator only reads the document."""
	return frappe.get_doc(
		{
			"doctype": "Promotional Scheme",
			"promotion_type": promotion_type,
			"apply_on": apply_on,
			"items": [{"item_code": code} for code in items],
			"price_discount_slabs": price or [],
			"product_discount_slabs": product or [],
		}
	)


PRICE = {"rule_description": "10%", "rate_or_discount": "Discount Percentage", "discount_percentage": 10}
FREE = {"rule_description": "free", "free_item": "ITEM-B", "free_qty": 1}


class TestPromotionTypeRules(IntegrationTestCase):
	def test_item_level_discount_is_pos_only_and_unconditional(self):
		doc = scheme("Item Level Discount", price=[PRICE])
		validate_promotion_type_rules(doc)
		self.assertEqual(doc.pos_only, 1)

		with self.assertRaises(frappe.ValidationError):
			validate_promotion_type_rules(scheme("Item Level Discount", price=[{**PRICE, "min_qty": 2}]))
		with self.assertRaises(frappe.ValidationError):
			validate_promotion_type_rules(scheme("Item Level Discount", apply_on="Item Group", price=[PRICE]))
		with self.assertRaises(frappe.ValidationError):
			validate_promotion_type_rules(scheme("Item Level Discount", product=[FREE]))

	def test_accumulative_item_level_keeps_scope_and_thresholds(self):
		slab = {**PRICE, "apply_discount_on_price": "Accumulative", "min_amount": 1000}
		validate_promotion_type_rules(scheme("Item Level Discount", apply_on="Item Group", price=[slab]))

	def test_gwp_and_auto_discount_slab_kinds(self):
		validate_promotion_type_rules(scheme("GWP", product=[FREE]))
		validate_promotion_type_rules(scheme("Auto Discount", price=[PRICE]))
		with self.assertRaises(frappe.ValidationError):
			validate_promotion_type_rules(scheme("GWP", price=[PRICE]))
		with self.assertRaises(frappe.ValidationError):
			validate_promotion_type_rules(scheme("Auto Discount", product=[FREE]))

	def test_untyped_scheme_is_not_restricted(self):
		validate_promotion_type_rules(scheme("", apply_on="Item Group", price=[{**PRICE, "min_qty": 5}]))

	def test_pos_api_is_view_only_even_for_administrator(self):
		check_promotion_permissions("read")
		for action in ("write", "delete"):
			with self.assertRaises(frappe.PermissionError):
				check_promotion_permissions(action)
