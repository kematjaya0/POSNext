import frappe


def run():
	companies = frappe.get_all("Company", fields=["name", "abbr"], order_by="name")
	for c in companies:
		si = frappe.db.count("Sales Invoice", {"company": c.name})
		pi = frappe.db.count("Purchase Invoice", {"company": c.name})
		sle = frappe.db.count("Stock Ledger Entry", {"company": c.name})
		gle = frappe.db.count("GL Entry", {"company": c.name})
		acc = frappe.db.count("Account", {"company": c.name})
		wh = frappe.db.count("Warehouse", {"company": c.name})
		print(
			f"{c.name!r:45} abbr={c.abbr!r:8} SI={si:4} PI={pi:4} SLE={sle:4} GLE={gle:5} ACC={acc:4} WH={wh:3}"
		)
