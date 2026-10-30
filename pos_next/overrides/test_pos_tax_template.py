# Copyright (c) 2026, BrainWise and contributors
# For license information, please see license.txt

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from pos_next.api.pos_profile import get_company_taxes
from pos_next.overrides.pos_tax_template import default_sales_tax_template, validate_pos_profile

TEMPLATE = "Sales Taxes and Charges Template"


def _template(company, title, is_default=0, included=0):
	account = frappe.db.get_value(
		"Account", {"company": company, "account_type": "Tax", "is_group": 0}, "name"
	) or frappe.db.get_value("Account", {"company": company, "root_type": "Liability", "is_group": 0}, "name")
	return frappe.get_doc(
		{
			"doctype": TEMPLATE,
			"title": title,
			"company": company,
			"is_default": is_default,
			"taxes": [
				{
					"charge_type": "On Net Total",
					"account_head": account,
					"description": "PPN",
					"rate": 11,
					"included_in_print_rate": included,
				}
			],
		}
	).insert()


class TestPosTaxTemplate(IntegrationTestCase):
	# Tests in one class share a transaction: each rolls back its own changes.
	def setUp(self):
		frappe.db.savepoint("pos_tax_template")
		# Any POS Profile of the site; tests move its company's Default template
		name = frappe.db.get_value("POS Profile", {}, "name")
		if not name:
			self.skipTest("No POS Profile on this site")
		self.profile = frappe.get_doc("POS Profile", name)
		self.company = self.profile.company
		frappe.db.set_value(TEMPLATE, {"company": self.company}, "is_default", 0)
		frappe.db.set_value("POS Profile", self.profile.name, "taxes_and_charges", None)

	def tearDown(self):
		frappe.db.rollback(save_point="pos_tax_template")

	def test_new_default_moves_onto_pos_profiles(self):
		"""TXINVTS20261014-00001: the profile and a split invoice must take one template."""
		template = _template(self.company, "POS Tax Test Default", is_default=1, included=1)

		self.assertEqual(default_sales_tax_template(self.company), template.name)
		self.assertEqual(
			frappe.db.get_value("POS Profile", self.profile.name, "taxes_and_charges"), template.name
		)

		other = _template(self.company, "POS Tax Test Other")
		other.is_default = 1
		other.save()
		self.assertEqual(
			frappe.db.get_value("POS Profile", self.profile.name, "taxes_and_charges"), other.name
		)
		self.assertEqual(frappe.db.get_value(TEMPLATE, template.name, "is_default"), 0)

	def test_default_used_by_pos_profile_cannot_be_dropped(self):
		template = _template(self.company, "POS Tax Test Default", is_default=1)

		template.reload()
		template.is_default = 0
		with self.assertRaises(frappe.ValidationError):
			template.save()

		template.reload()
		template.disabled = 1
		template.is_default = 0
		with self.assertRaises(frappe.ValidationError):
			template.save()

	def test_unused_template_can_drop_default(self):
		template = _template(self.company, "POS Tax Test Default", is_default=1)
		frappe.db.set_value("POS Profile", self.profile.name, "taxes_and_charges", None)

		template.reload()
		template.is_default = 0
		template.save()

		self.assertIsNone(default_sales_tax_template(self.company))

	def test_pos_profile_takes_or_must_match_the_default(self):
		profile = self.profile
		profile.taxes_and_charges = None
		validate_pos_profile(profile)
		self.assertIsNone(profile.taxes_and_charges)

		template = _template(self.company, "POS Tax Test Default", is_default=1)
		other = _template(self.company, "POS Tax Test Other")

		profile.taxes_and_charges = None
		validate_pos_profile(profile)
		self.assertEqual(profile.taxes_and_charges, template.name)

		profile.taxes_and_charges = other.name
		with self.assertRaises(frappe.ValidationError):
			validate_pos_profile(profile)

	def test_company_taxes_follow_each_companys_template(self):
		"""The cart taxes a row by the company it is billed to (staging penjualan pecah 9a6a291e46)."""
		other_company = frappe.db.get_value("Company", {"name": ["!=", self.company]}, "name")
		own = frappe.db.get_value("Warehouse", {"company": self.company, "is_group": 0}, "name")
		foreign = frappe.db.get_value("Warehouse", {"company": other_company, "is_group": 0}, "name")
		if not (other_company and own and foreign):
			self.skipTest("Needs warehouses of two companies")

		frappe.db.set_value(TEMPLATE, {"company": other_company}, "is_default", 0)
		included = _template(other_company, "POS Tax Test Included", is_default=1, included=1)

		scope = {"native": own, "branch": [own, foreign], "outside": []}
		with patch("pos_next.api.items.get_session_scope", return_value=scope):
			result = get_company_taxes(self.profile.name)

		self.assertEqual(result["company"], self.company)
		self.assertEqual(result["taxes"][self.company], [])
		self.assertEqual(
			[(row["rate"], row["included_in_print_rate"]) for row in result["taxes"][other_company]],
			[(11, 1)],
		)
		self.assertEqual(default_sales_tax_template(other_company), included.name)
