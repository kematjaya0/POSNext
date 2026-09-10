# Copyright (c) 2026, BrainWise and contributors
# For license information, please see license.txt

"""Integration tests for get_item_warehouse_stock - the endpoint behind the
Warehouse + stock picker in ItemSelectionDialog / EditItemDialog.

Deliberately self-contained (no import from pos_next.test_promotions):
that module imports erpnext.stock.doctype.stock_entry.test_stock_entry,
whose module-level `erpnext.tests.utils.BootStrapTestData()` inserts master
data (e.g. Price List "Standard Buying") without ignore_if_duplicate - it
crashes with a DuplicateEntryError the moment it's imported on a site that
already has real data (e.g. erp.programmer-newbie.web.id). Not caused by
this change; just don't import anything that drags that chain in.

Builds against whatever Company/Warehouse the running site has configured,
no assumption of a specific test fixture site. All data this file creates is
prefixed `_PNXT_TEST_WHSTOCK_` so it never collides with real records.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from pos_next.api.items import get_item_warehouse_stock

ITEM = "_PNXT_TEST_WHSTOCK_ITEM"
UOM_BOX = "_PNXT_TEST_WHSTOCK_BOX"
OTHER_WAREHOUSE = "_PNXT_TEST_WHSTOCK_WH2"
TEST_USER = "_pnxt_test_whstock_user@example.com"
WAREHOUSE_GROUP = "_PNXT_TEST_WHSTOCK_GROUP"


def _resolve_company():
	default = frappe.defaults.get_global_default("company")
	if default:
		return default
	return frappe.db.get_value("Company", {"name": ["!=", ""]}, "name")


def _resolve_warehouse(company):
	wh = frappe.db.get_value(
		"Warehouse",
		{"company": company, "is_group": 0, "disabled": 0},
		"name",
		order_by="creation asc",
	)
	if not wh:
		frappe.throw(f"No warehouse for company {company}.")
	return wh


def _ensure_pos_profile(company, warehouse):
	profile_name = f"_PNXT_TEST_WHSTOCK_POS_PROFILE_{company}"
	if frappe.db.exists("POS Profile", profile_name):
		return profile_name

	price_list = frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name")
	write_off_account = frappe.get_cached_value(
		"Company", company, "write_off_account"
	) or frappe.db.get_value("Account", {"company": company, "is_group": 0}, "name")
	cost_center = frappe.db.get_value(
		"Cost Center", {"company": company, "is_group": 0, "disabled": 0}, "name"
	)

	profile = frappe.get_doc(
		{
			"doctype": "POS Profile",
			"name": profile_name,
			"company": company,
			"warehouse": warehouse,
			"selling_price_list": price_list,
			"currency": frappe.get_cached_value("Company", company, "default_currency"),
			"write_off_account": write_off_account,
			"write_off_cost_center": cost_center,
			"disabled": 0,
		}
	)
	profile.flags.ignore_validate = True
	profile.insert(ignore_permissions=True, ignore_mandatory=True)
	return profile.name


class TestGetItemWarehouseStock(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.company = _resolve_company()
		cls.native_warehouse = _resolve_warehouse(cls.company)
		cls.pos_profile = _ensure_pos_profile(cls.company, cls.native_warehouse)

		if not frappe.db.exists("UOM", UOM_BOX):
			frappe.get_doc({"doctype": "UOM", "uom_name": UOM_BOX}).insert(ignore_permissions=True)

		if not frappe.db.exists("Item", ITEM):
			frappe.get_doc(
				{
					"doctype": "Item",
					"item_code": ITEM,
					"item_name": ITEM,
					"item_group": frappe.db.get_value("Item Group", {}, "name") or "All Item Groups",
					"stock_uom": "Nos",
					"is_stock_item": 1,
					"uoms": [{"uom": UOM_BOX, "conversion_factor": 10}],
				}
			).insert(ignore_permissions=True)

		if not frappe.db.exists("Warehouse", {"warehouse_name": OTHER_WAREHOUSE, "company": cls.company}):
			frappe.get_doc(
				{"doctype": "Warehouse", "warehouse_name": OTHER_WAREHOUSE, "company": cls.company}
			).insert(ignore_permissions=True)
		cls.other_warehouse = frappe.db.get_value(
			"Warehouse", {"warehouse_name": OTHER_WAREHOUSE, "company": cls.company}, "name"
		)

		cls._receive_stock(cls.native_warehouse, 100)
		cls._receive_stock(cls.other_warehouse, 40)

		if not frappe.db.exists("User", TEST_USER):
			frappe.get_doc(
				{
					"doctype": "User",
					"email": TEST_USER,
					"first_name": "PNXT Test WHStock",
					"send_welcome_email": 0,
				}
			).insert(ignore_permissions=True)

	@classmethod
	def _receive_stock(cls, warehouse, qty):
		existing = flt(frappe.db.get_value("Bin", {"item_code": ITEM, "warehouse": warehouse}, "actual_qty"))
		if existing >= qty:
			return
		doc = frappe.get_doc(
			{
				"doctype": "Stock Entry",
				"stock_entry_type": "Material Receipt",
				"company": cls.company,
				"items": [
					{
						"item_code": ITEM,
						"qty": qty - existing,
						"basic_rate": 10,
						"t_warehouse": warehouse,
					}
				],
			}
		)
		doc.insert(ignore_permissions=True)
		doc.submit()

	def tearDown(self):
		# Warehouse Group has no meaningful autoname (random hash) - the label
		# is just a display field, so look it up by label rather than assume
		# it doubles as the name.
		group_name = frappe.db.get_value("Warehouse Group", {"label": WAREHOUSE_GROUP}, "name")
		if group_name:
			frappe.delete_doc("Warehouse Group", group_name, force=True, ignore_permissions=True)
		frappe.db.set_value("Warehouse", self.other_warehouse, "warehouse_group", None)
		frappe.db.set_value("User", TEST_USER, "warehouse_groups", [])

	def test_empty_inputs_return_empty_list(self):
		self.assertEqual(get_item_warehouse_stock("", "Nos", self.pos_profile), [])
		self.assertEqual(get_item_warehouse_stock(ITEM, "Nos", ""), [])

	def test_returns_stock_uom_quantities_without_group(self):
		result = get_item_warehouse_stock(ITEM, "Nos", self.pos_profile)
		by_warehouse = {row["warehouse"]: row for row in result}

		self.assertIn(self.native_warehouse, by_warehouse)
		self.assertIn(self.other_warehouse, by_warehouse)
		self.assertEqual(by_warehouse[self.native_warehouse]["stock_qty"], 100)
		self.assertEqual(by_warehouse[self.other_warehouse]["stock_qty"], 40)
		self.assertFalse(by_warehouse[self.other_warehouse]["is_own"])

	def test_stock_converted_to_requested_uom(self):
		result = get_item_warehouse_stock(ITEM, UOM_BOX, self.pos_profile)
		by_warehouse = {row["warehouse"]: row for row in result}

		# 100 Nos / 10 (conversion_factor) = 10 Box
		self.assertEqual(by_warehouse[self.native_warehouse]["stock_qty"], 10)
		self.assertEqual(by_warehouse[self.other_warehouse]["stock_qty"], 4)

	def test_own_warehouse_via_group_sorts_first(self):
		group = frappe.get_doc({"doctype": "Warehouse Group", "label": WAREHOUSE_GROUP}).insert(
			ignore_permissions=True
		)
		frappe.db.set_value("Warehouse", self.other_warehouse, "warehouse_group", group.name)

		user_doc = frappe.get_doc("User", TEST_USER)
		user_doc.append("warehouse_groups", {"warehouse_group": group.name})
		user_doc.save(ignore_permissions=True)

		frappe.set_user(TEST_USER)
		try:
			result = get_item_warehouse_stock(ITEM, "Nos", self.pos_profile)
		finally:
			frappe.set_user("Administrator")

		self.assertEqual(result[0]["warehouse"], self.other_warehouse)
		self.assertTrue(result[0]["is_own"])
		# Same company in this single-company test setup - see
		# get_item_warehouse_stock's own sort tiers for the cross-company case.
		self.assertTrue(result[0]["is_native_company"])
		self.assertNotEqual(result[1]["warehouse"], self.other_warehouse)
