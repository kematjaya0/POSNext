# Copyright (c) 2020, Youssef Restom and Contributors
# See license.txt

import json
import unittest
from unittest.mock import MagicMock, patch

import frappe

from pos_next.pos_next.doctype.pos_closing_shift import pos_closing_shift as module

PT = "_Test PT"
CV = "_Test CV"

OPENING = {
	"name": "POSA-OS-TEST",
	"period_start_date": "2026-09-29 08:00:00",
	"pos_profile": "_Test Profile",
	"user": "cashier@example.com",
	"company": PT,
	"balance_details": [
		{"mode_of_payment": "Cash", "amount": 100000},
		{"mode_of_payment": "Bank", "amount": 0},
	],
}


def _invoice(name, company, grand_total, mode="Cash", is_return=0, tax=0):
	return frappe._dict(
		{
			"name": name,
			"company": company,
			"posting_date": "2026-09-29",
			"customer": "Walk-in",
			"currency": "IDR",
			"conversion_rate": 1,
			"grand_total": grand_total,
			"base_grand_total": grand_total,
			"net_total": grand_total - tax,
			"base_net_total": grand_total - tax,
			"total_qty": 1,
			"is_return": is_return,
			"change_amount": 0,
			"payments": [
				frappe._dict({"mode_of_payment": mode, "amount": grand_total, "base_amount": grand_total})
			],
			"taxes": [
				frappe._dict(
					{
						"account_head": f"VAT - {company}",
						"rate": 11,
						"tax_amount": tax,
						"base_tax_amount": tax,
					}
				)
			]
			if tax
			else [],
		}
	)


class TestMakeClosingShiftPerCompany(unittest.TestCase):
	def _make(self, invoices, payment_entries=()):
		with (
			patch.object(module, "submit_printed_invoices"),
			patch.object(module, "get_pos_invoices", return_value=list(invoices)),
			patch.object(module, "get_payments_entries", return_value=list(payment_entries)),
			patch.object(module, "_get_cash_mode_of_payment", return_value="Cash"),
			patch.object(module.frappe, "get_cached_value", return_value="IDR"),
		):
			return module.make_closing_shift_from_opening(json.dumps(OPENING))

	def test_single_company_shift_has_one_closing(self):
		result = self._make([_invoice("SI-1", PT, 50000)])

		self.assertEqual([c.company for c in result.companies], [PT])
		cash = result.companies[0].payment_reconciliation[0]
		self.assertEqual(cash.expected_amount, 150000)
		self.assertEqual(result.grand_total, 50000)

	def test_invoices_split_by_company_with_opening_on_opening_company(self):
		result = self._make(
			[
				_invoice("SI-1", PT, 50000, tax=5000),
				_invoice("SI-2", CV, 30000, mode="Bank"),
				_invoice("SI-3", CV, 20000),
			]
		)

		pt, cv = result.companies
		self.assertEqual((pt.company, cv.company), (PT, CV))
		self.assertEqual([t.sales_invoice for t in pt.pos_transactions], ["SI-1"])
		self.assertEqual([t.sales_invoice for t in cv.pos_transactions], ["SI-2", "SI-3"])

		pt_modes = {p.mode_of_payment: p for p in pt.payment_reconciliation}
		cv_modes = {p.mode_of_payment: p for p in cv.payment_reconciliation}
		self.assertEqual(
			(pt_modes["Cash"].opening_amount, pt_modes["Cash"].expected_amount), (100000, 150000)
		)
		# CV starts from zero but still gets every mode of the shift.
		self.assertEqual((cv_modes["Cash"].opening_amount, cv_modes["Cash"].expected_amount), (0, 20000))
		self.assertEqual(cv_modes["Bank"].expected_amount, 30000)

		self.assertEqual([t.account_head for t in pt.taxes], [f"VAT - {PT}"])
		self.assertEqual(cv.taxes, [])
		self.assertEqual((pt.grand_total, cv.grand_total, result.grand_total), (50000, 50000, 100000))
		self.assertEqual(result.sales_count, 3)

	def test_opening_company_kept_even_without_its_own_sales(self):
		result = self._make([_invoice("SI-1", CV, 30000)])

		self.assertEqual([c.company for c in result.companies], [PT, CV])
		self.assertEqual(result.companies[0].pos_transactions, [])
		self.assertEqual(result.companies[0].payment_reconciliation[0].expected_amount, 100000)

	def test_cv_return_with_unknown_mode_falls_back_to_cash(self):
		result = self._make([_invoice("SI-R", CV, -10000, mode="Voucher", is_return=1)])

		cv_modes = {p.mode_of_payment: p for p in result.companies[1].payment_reconciliation}
		self.assertNotIn("Voucher", cv_modes)
		self.assertEqual(cv_modes["Cash"].expected_amount, -10000)
		self.assertEqual(result.returns_count, 1)

	def test_payment_entry_goes_to_its_company(self):
		entry = frappe._dict(
			{
				"name": "PE-1",
				"company": CV,
				"mode_of_payment": "Cash",
				"paid_amount": 7000,
				"base_paid_amount": 7000,
				"posting_date": "2026-09-29",
				"party": "Walk-in",
			}
		)
		result = self._make([], [entry])

		pt, cv = result.companies
		self.assertEqual(pt.pos_payments, [])
		self.assertEqual([p.payment_entry for p in cv.pos_payments], ["PE-1"])


class TestSubmitClosingShiftPerCompany(unittest.TestCase):
	def test_opening_company_submitted_last(self):
		submitted = []

		def fake_get_doc(data):
			doc = MagicMock()
			doc.name = f"CS-{data['company']}"
			doc.submit.side_effect = lambda: submitted.append(data["company"])
			return doc

		payload = {
			"companies": [
				{"company": PT, "pos_opening_shift": "X"},
				{"company": CV, "pos_opening_shift": "X"},
			]
		}
		with (
			patch.object(module.frappe, "get_doc", side_effect=fake_get_doc),
			patch.object(module.frappe.db, "get_value", return_value=PT),
		):
			names = module.submit_closing_shift(json.dumps(payload))

		self.assertEqual(submitted, [CV, PT])
		self.assertEqual(names, [f"CS-{CV}", f"CS-{PT}"])

	def test_single_closing_dict_still_accepted(self):
		doc = MagicMock()
		doc.name = "CS-1"
		with (
			patch.object(module.frappe, "get_doc", return_value=doc),
			patch.object(module.frappe.db, "get_value", return_value=PT),
		):
			names = module.submit_closing_shift(json.dumps({"company": PT, "pos_opening_shift": "X"}))

		self.assertEqual(names, ["CS-1"])
		doc.submit.assert_called_once()
