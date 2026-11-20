import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { JSDOM } from "jsdom";

globalThis.__ = (s, args = []) => String(s).replace(/\{(\d+)\}/g, (_, i) => args[i]);

vi.mock("@/utils/apiWrapper", () => ({ call: vi.fn() }));
vi.mock("@/utils/offline/offlineReceiptCache", () => ({ getOfflineReceiptPayload: vi.fn() }));
vi.mock("@/utils/offline/sync", () => ({ getOfflineInvoiceByOfflineId: vi.fn() }));
vi.mock("@/utils/offline/workerClient", () => ({
	offlineWorker: { markOfflineInvoicePrinted: vi.fn().mockResolvedValue() },
}));
vi.mock("@/utils/qzTray", () => ({ printHTML: vi.fn() }));

import { call } from "@/utils/apiWrapper";
import { printHTML } from "@/utils/qzTray";
import {
	buildReceiptHTML,
	printInvoice,
	printInvoiceCustom,
	silentPrintDoc,
	silentPrintInvoiceFromDoc,
} from "@/utils/printInvoice";

const invoice = (extra = {}) => ({
	name: "pos_offline_1730000000000",
	company: "CV Tes",
	grand_total: 1000,
	items: [{ item_code: "A", item_name: "A", qty: 1, rate: 1000 }],
	...extra,
});

describe("buildReceiptHTML nota QR", () => {
	it("adds an SVG QR with the receipt number below it", () => {
		const html = buildReceiptHTML(invoice());
		expect(html).toContain("<svg");
		expect(html).toContain("nota-qr");
	});

	it("leaves returns without QR", () => {
		expect(buildReceiptHTML(invoice({ is_return: 1 }))).not.toContain("<svg");
	});
});

describe("receipt warehouse and footer", () => {
	it("keeps each item's actual warehouse, including the same product from two warehouses", () => {
		const doc = invoice({
			items: [
				{ item_name: "Cat Tembok", qty: 1, rate: 500, warehouse: "Gudang Toko - Lantai 2 - CV" },
				{ item_name: "Cat Tembok", qty: 1, rate: 500, warehouse: "Gudang Pusat-CV" },
			],
		});
		const original = structuredClone(doc);
		const html = buildReceiptHTML(doc);
		expect(html.match(/class="item-warehouse"/g)).toHaveLength(2);
		expect(html).toContain("[Gudang Toko - Lantai 2]</span> Cat Tembok");
		expect(html).toContain("[Gudang Pusat]</span> Cat Tembok");
		expect(html.match(/Rp 500/g)).toHaveLength(4);
		expect(doc).toEqual(original);
	});

	it("does not guess a warehouse when the item has none", () => {
		expect(buildReceiptHTML(invoice({ set_warehouse: "Gudang Profil" }))).not.toContain('class="item-warehouse"');
	});

	it("escapes warehouse names as text", () => {
		const html = buildReceiptHTML(invoice({
			items: [{ item_name: "Cat", qty: 1, rate: 1000, warehouse: '<Gudang & "Toko">' }],
		}));
		expect(html).toContain("&#60;Gudang &#38; &#34;Toko&#34;&#62;");
		expect(html).not.toContain('<Gudang & "Toko">');
	});

	it("shows the saved posting time without inventing a midnight time when it is missing", () => {
		const doc = invoice({ posting_date: "2026-11-20", posting_time: "09:30:00.123456" });
		expect(buildReceiptHTML(doc)).toContain("2026-11-20 09:30:00");
		const withoutTime = buildReceiptHTML(invoice({ posting_date: "2026-11-20" }));
		expect(withoutTime).toContain('class="receipt-meta-value">2026-11-20</span>');
	});

	it("replaces the old thank-you, branding and copyright with the requested policy", () => {
		const html = buildReceiptHTML(invoice({ footer: "Thank you for your business!" }));
		expect(html).toContain("Terima kasih atas kepercayaan anda.");
		expect(html).toContain("Barang yang sudah dibeli dapat ditukar di hari yang sama dan tidak bisa dikembalikan.");
		expect(html).not.toMatch(/Thank you|Powered by|©2026/);
	});
});

describe("receipt amounts after item discount", () => {
	const item = (extra = {}) => ({
		item_name: "Cat Tembok", qty: 2, price_list_rate: 125000,
		rate: 112500, amount: 225000, discount_percentage: 10, discount_amount: 12500,
		...extra,
	});
	const receipt = (items, extra = {}) => {
		const doc = invoice({ items, grand_total: 225000, ...extra });
		const original = structuredClone(doc);
		const result = new JSDOM(buildReceiptHTML(doc)).window.document;
		expect(doc).toEqual(original);
		return result;
	};
	const lineTotal = (doc) => doc.querySelector(".item-details > span:last-child").textContent;
	const discount = (doc) => doc.querySelector(".item-discount").textContent;

	it("uses the stored line amount and displays the whole-line percentage discount", () => {
		const doc = receipt([item()]);
		expect(lineTotal(doc)).toBe("Rp 225.000");
		expect(discount(doc)).toContain("Diskon 10%");
		expect(discount(doc)).toContain("-Rp 25.000");
	});

	it("uses the net rate for offline rows without amount, not the discount field's unit convention", () => {
		const doc = receipt([item({ amount: undefined, discount_amount: 25000 })]);
		expect(lineTotal(doc)).toBe("Rp 225.000");
		expect(discount(doc)).toContain("-Rp 25.000");
	});

	it("shows a nominal discount without inventing a percentage", () => {
		const doc = receipt([item({ rate: 120000, amount: 240000, discount_percentage: 0 })]);
		expect(lineTotal(doc)).toBe("Rp 240.000");
		expect(discount(doc)).toContain("-Rp 10.000");
		expect(discount(doc)).not.toContain("%");
	});

	it("keeps free items at zero without a duplicate discount row", () => {
		const doc = receipt([item({ is_free_item: 1, rate: 0, amount: 0 })]);
		expect(lineTotal(doc)).toBe("Rp 0");
		expect(doc.querySelector(".item-discount")).toBeNull();
		expect(doc.querySelector(".item-name").textContent).toContain("GRATIS");
	});

	it("preserves a zero amount for a fully discounted item", () => {
		const doc = receipt([item({ rate: 0, amount: 0, discount_percentage: 100 })]);
		expect(lineTotal(doc)).toBe("Rp 0");
		expect(discount(doc)).toContain("-Rp 250.000");
	});

	it("keeps the invoice discount separate and preserves the stored grand total", () => {
		const doc = receipt([item({ net_amount: 200000 })], { grand_total: 200000, discount_amount: 25000 });
		expect(lineTotal(doc)).toBe("Rp 225.000");
		expect(discount(doc)).toContain("-Rp 25.000");
		expect(doc.querySelector(".invoice-discount").textContent).toContain("-Rp 25.000");
		expect(doc.querySelector(".receipt-totals > .receipt-row:first-child").textContent).toContain("Rp 225.000");
		expect(doc.querySelector(".grand-total").textContent).toContain("Rp 200.000");
	});

	it("includes folded add-ons once in the printed amount without changing the source rows", () => {
		const doc = receipt([
			item({ custom_addon_key: "base-1" }),
			{ item_name: "Tinta", custom_addon_parent_key: "base-1", qty: 1, rate: 5000, amount: 5000 },
		]);
		expect(doc.querySelectorAll(".item-row")).toHaveLength(1);
		expect(lineTotal(doc)).toBe("Rp 230.000");
		expect(discount(doc)).toContain("-Rp 25.000");
	});

	it("preserves fractional quantities", () => {
		const doc = receipt([item({ qty: 0.5, rate: 100000, amount: 50000, discount_percentage: 20 })]);
		expect(doc.querySelector(".item-details > span:first-child").textContent).toBe("0.5 × Rp 125.000");
		expect(lineTotal(doc)).toBe("Rp 50.000");
		expect(discount(doc)).toContain("-Rp 12.500");
	});

	it("preserves return amounts and leaves returns without QR", () => {
		const doc = receipt([item({ qty: -2, amount: -225000 })], { is_return: 1, grand_total: -225000 });
		expect(lineTotal(doc)).toBe("Rp -225.000");
		expect(doc.querySelector("svg")).toBeNull();
	});

	it("omits discounts for full-price items", () => {
		const doc = receipt([item({ rate: 125000, amount: 250000, discount_percentage: 0, discount_amount: 0 })]);
		expect(lineTotal(doc)).toBe("Rp 250.000");
		expect(doc.querySelector(".item-discount")).toBeNull();
	});
});

describe("receipt print dispatch", () => {
	let popup;
	let fontsReady;
	beforeEach(() => {
		vi.clearAllMocks();
		popup = {
			document: {
				fonts: { ready: new Promise((resolve) => { fontsReady = resolve; }) },
				write: vi.fn(),
				close: vi.fn(),
			},
			print: vi.fn(),
			close: vi.fn(),
			addEventListener: vi.fn(),
			closed: false,
		};
		vi.stubGlobal("window", { open: vi.fn().mockReturnValue(popup) });
	});
	afterEach(() => vi.unstubAllGlobals());

	it("lets the thermal document wait for fonts, without Frappe's immediate trigger", async () => {
		await printInvoice(invoice({ name: "INV-TEST" }), "POS Next Receipt", "Letterhead");
		const url = new URL(window.open.mock.calls[0][0], "https://pos.test");
		expect(url.searchParams.get("trigger_print")).toBe("0");
		expect(url.searchParams.get("format")).toBe("POS Next Receipt");
		expect(url.searchParams.get("letterhead")).toBe("Letterhead");
		expect(popup.print).not.toHaveBeenCalled();
	});

	it("preserves Frappe's trigger for other browser print formats", async () => {
		await printInvoice(invoice({ name: "INV-TEST" }), "Another Format");
		const url = new URL(window.open.mock.calls[0][0], "https://pos.test");
		expect(url.searchParams.get("trigger_print")).toBe("1");
		expect(url.searchParams.get("format")).toBe("Another Format");
	});

	it("uses the same margin-free styles offline and waits for fonts", async () => {
		printInvoiceCustom(invoice());
		const html = popup.document.write.mock.calls[0][0];
		expect(html).toContain("max-width: 72mm");
		expect(html).toContain("@page { size: auto; margin: 0; }");
		expect(html).not.toContain("width: 80mm");
		expect(html).not.toContain("padding: 5mm");
		const printing = popup.onload();
		expect(popup.print).not.toHaveBeenCalled();
		fontsReady();
		await printing;
		expect(popup.print).toHaveBeenCalledOnce();
	});

	it("does not print a window closed while fonts were loading", async () => {
		printInvoiceCustom(invoice());
		const printing = popup.onload();
		popup.closed = true;
		fontsReady();
		await printing;
		expect(popup.print).not.toHaveBeenCalled();
	});

	it("uses the driver page and disables fitting only for the thermal format", async () => {
		call.mockResolvedValue({ html: "<div>receipt</div>", style: "" });
		await silentPrintDoc("Sales Invoice", "INV-TEST", "POS Next Receipt");
		expect(printHTML).toHaveBeenLastCalledWith(expect.any(String), undefined, {
			usePrinterPageSize: true, printableWidth: 72, scaleContent: false,
		});
		await silentPrintDoc("Sales Invoice", "INV-TEST", "A4 Invoice");
		expect(printHTML).toHaveBeenLastCalledWith(expect.any(String));
	});

	it("preserves receipt content and SVG when sending offline HTML to QZ", async () => {
		const doc = invoice();
		const original = structuredClone(doc);
		await silentPrintInvoiceFromDoc(doc);
		const [html, , options] = printHTML.mock.calls[0];
		expect(html).toContain(buildReceiptHTML(doc));
		expect(html).toContain("<svg");
		expect(options).toEqual({
			usePrinterPageSize: true, printableWidth: 72, scaleContent: false,
		});
		expect(doc).toEqual(original);
	});
});
