"""Render a synthetic receipt with Frappe's real wrapper/styles, without a DB."""

import json
import sys
from pathlib import Path
from types import SimpleNamespace

from jinja2 import Environment, FileSystemLoader


class Receipt(SimpleNamespace):
	def get(self, key, default=None):
		return getattr(self, key, default)


root = Path(__file__).resolve().parents[2]
frappe_root = root.parent / "frappe" / "frappe"
payload = json.load(sys.stdin)
doc = Receipt(**payload["invoice"])
doc.items = [Receipt(**item) for item in doc.items]
env = Environment(loader=FileSystemLoader([root / "pos_next", frappe_root]))
env.globals.update(
	_=lambda text: text,
	frappe=Receipt(
		db=Receipt(get_value=lambda *args: "Rp"),
		utils=Receipt(fmt_money=lambda value, **kwargs: f"{value:,.0f}".replace(",", ".")),
	),
)
template = root / "pos_next/pos_next/print_format/pos_next_receipt/pos_next_receipt.html"
if payload.get("template"):
	template = Path(payload["template"])
body = env.from_string(template.read_text()).render(doc=doc)

# Use the actual Nextend QR wrapper; the SVG is supplied unchanged by the test.
sys.path.insert(0, str(root.parent / "nextend"))
from nextend.nota_qr import NOTA_QR

doc.nextend_nota_qr = payload["qr"]
body += env.from_string(NOTA_QR).render(doc=doc)
standard = env.get_template("templates/styles/standard.css").render(
	page_margin="15mm", font="Arial", print_settings=Receipt(allow_page_break_inside_tables=1)
)
redesign = json.loads((frappe_root / "printing/print_style/redesign/redesign.json").read_text())["css"]
bootstrap = (frappe_root / "public/css/bootstrap.css").read_text()
env.globals.update(include_style=lambda _: f"<style>{bootstrap}</style>", include_script=lambda _: "")
html = env.get_template("www/printview.html").render(
	standalone=False,
	no_action_banner=True,
	body=body,
	print_style=standard + redesign,
	lang="en",
	layout_direction="ltr",
	title=doc.name,
)
print(json.dumps({"html": html, "body": body}))
