import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { chromium } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import thermalReceiptStyles from "../../../../pos_next/templates/includes/thermal_receipt.css?raw";

globalThis.__ = (text, args = []) => String(text).replace(/\{(\d+)\}/g, (_, i) => args[i]);
vi.mock("@/utils/apiWrapper", () => ({ call: vi.fn() }));
vi.mock("@/utils/offline/offlineReceiptCache", () => ({ getOfflineReceiptPayload: vi.fn() }));
vi.mock("@/utils/offline/sync", () => ({ getOfflineInvoiceByOfflineId: vi.fn() }));
vi.mock("@/utils/offline/workerClient", () => ({ offlineWorker: { markOfflineInvoicePrinted: vi.fn().mockResolvedValue() } }));
vi.mock("@/utils/qzTray", () => ({ printHTML: vi.fn().mockResolvedValue(true) }));

import { call } from "@/utils/apiWrapper";
import { getOfflineReceiptPayload } from "@/utils/offline/offlineReceiptCache";
import { offlineWorker } from "@/utils/offline/workerClient";
import { printHTML } from "@/utils/qzTray";
import { buildReceiptHTML, printInvoiceBatch } from "@/utils/printInvoice";

const parser = new JSDOM("").window.DOMParser;
const docs = new Map();
let popup;
let fetchPrintview;

function invoice(name, company = "PT CONTOH", count = 1) {
	const amount = company === "CV CONTOH" ? 90000 : 225000;
	const listRate = company === "CV CONTOH" ? 50000 : 125000;
	return {
		name, doctype: "Sales Invoice", company, pos_profile: "Kasir Utama",
		posting_date: "2026-11-20", posting_time: "10:30:00", currency: "IDR",
		items: Array.from({ length: count }, (_, i) => ({
			item_name: `Barang ${i} ${company}`, qty: 2, price_list_rate: listRate, rate: amount / 2,
			amount, discount_percentage: 10, warehouse: "Gudang Toko - CV",
		})),
		grand_total: count * amount, paid_amount: count * amount,
		payments: [{ mode_of_payment: "Cash", amount: count * amount }],
	};
}

function serverPage(doc) {
	return `<!doctype html><html><head><meta charset="utf-8">
		<link rel="stylesheet" href="/assets/frappe/print.bundle.css">
		<script src="/assets/frappe/print.bundle.test.js"></script>
		</head><body><div class="action-banner">Do not print this banner</div>
		<div class="print-format"><style>${thermalReceiptStyles}</style>
		<div class="copy-banner">SALINAN ${doc.name}</div>${buildReceiptHTML(doc)}
		<script>window.print(); window.close();</script></div></body></html>`;
}

function makePopup() {
	let current = new JSDOM("").window.document;
	const events = new EventTarget();
	const result = { closed: false, onload: null, print: vi.fn(), render_barcode: vi.fn() };
	result.addEventListener = (...args) => events.addEventListener(...args);
	result.dispatchEvent = (event) => events.dispatchEvent(event);
	result.close = vi.fn(() => { result.closed = true; });
	result.document = {
		fonts: { ready: Promise.resolve() },
		open: vi.fn(() => { current = new JSDOM("").window.document; result.onload = null; }),
		write: vi.fn((html) => { current = new JSDOM(html).window.document; }),
		querySelectorAll: (selector) => current.querySelectorAll(selector),
		querySelector: (selector) => {
			if (result.closed) throw new Error("Cannot access a closed print window");
			return current.querySelector(selector);
		},
		createElement: (tag) => current.createElement(tag),
		head: { appendChild: vi.fn((script) => {
			result.render_barcode = vi.fn();
			queueMicrotask(() => script.onload());
		}) },
		close: vi.fn(() => {
			const handler = result.onload;
			if (handler) queueMicrotask(handler);
		}),
	};
	return result;
}

beforeEach(() => {
	vi.clearAllMocks();
	docs.clear();
	docs.set("INV-PT", invoice("INV-PT"));
	docs.set("INV-CV", invoice("INV-CV", "CV CONTOH"));
	popup = makePopup();
	vi.stubGlobal("DOMParser", parser);
	vi.stubGlobal("window", { document: popup.document, location: { origin: "https://pos.test" }, open: vi.fn(() => popup) });
	call.mockImplementation(async (method, args) => {
		if (method === "pos_next.api.invoices.get_invoice") return docs.get(args.invoice_name);
		if (method === "frappe.client.get") return { print_format: "POS Next Receipt", letter_head: "Company Letterhead" };
		throw new Error(`Unexpected API ${method}`);
	});
	getOfflineReceiptPayload.mockImplementation((name) => docs.get(name));
	printHTML.mockResolvedValue(true);
	fetchPrintview = vi.fn(async (url) => {
		const name = new URL(url, "https://pos.test").searchParams.get("name");
		return { ok: true, redirected: false, text: async () => serverPage(docs.get(name)) };
	});
	vi.stubGlobal("fetch", fetchPrintview);
});
afterEach(() => vi.unstubAllGlobals());

const finalHTML = () => popup.document.write.mock.calls.at(-1)[0];

describe("one action prints the complete split sale", () => {
	it("opens one popup synchronously and prints both server-rendered receipts once", async () => {
		const printing = printInvoiceBatch(["INV-PT", "INV-CV"]);
		expect(window.open).toHaveBeenCalledOnce();
		expect(popup.print).not.toHaveBeenCalled();
		await expect(printing).resolves.toEqual({ method: "browser", success: true });
		expect(popup.print).toHaveBeenCalledOnce();
		const html = new parser().parseFromString(finalHTML(), "text/html");
		const pages = html.querySelectorAll(".invoice-print-page");
		expect(pages).toHaveLength(2);
		expect(pages[0].textContent).toContain("SALINAN INV-PT");
		expect(pages[1].textContent).toContain("SALINAN INV-CV");
		expect(pages[0].querySelector(".grand-total > span:last-child").textContent).toBe("Rp 225.000");
		expect(pages[1].querySelector(".grand-total > span:last-child").textContent).toBe("Rp 90.000");
		expect(pages[0].querySelector("svg").outerHTML).toBe(new parser().parseFromString(buildReceiptHTML(docs.get("INV-PT")), "text/html").querySelector("svg").outerHTML);
		expect(html.querySelectorAll("script:not([src])")).toHaveLength(0);
		expect(html.querySelectorAll("script[src]")).toHaveLength(0);
		expect(html.querySelector(".action-banner")).toBeNull();
		expect(finalHTML()).toContain("break-before: page");
		expect(fetchPrintview.mock.calls.every(([url]) => new URL(url, "https://pos.test").searchParams.get("trigger_print") === "0")).toBe(true);
		expect(call.mock.calls.filter(([method]) => method === "frappe.client.get")).toHaveLength(1);
	});

	it("waits for both responses and fonts, retaining invoice order when the CV response finishes first", async () => {
		let releasePT;
		let releaseFonts;
		popup.document.fonts.ready = new Promise((resolve) => { releaseFonts = resolve; });
		fetchPrintview.mockImplementation((url) => {
			const name = new URL(url, "https://pos.test").searchParams.get("name");
			const response = { ok: true, text: async () => serverPage(docs.get(name)) };
			return name === "INV-PT" ? new Promise((resolve) => { releasePT = () => resolve(response); }) : Promise.resolve(response);
		});
		const printing = printInvoiceBatch(["INV-PT", "INV-CV"]);
		await vi.waitFor(() => expect(fetchPrintview).toHaveBeenCalledTimes(2));
		expect(popup.print).not.toHaveBeenCalled();
		releasePT();
		await vi.waitFor(() => expect(finalHTML()).toContain("invoice-print-page"));
		expect(popup.print).not.toHaveBeenCalled();
		releaseFonts();
		await printing;
		expect(popup.print).toHaveBeenCalledOnce();
		expect(finalHTML().indexOf("SALINAN INV-PT")).toBeLessThan(finalHTML().indexOf("SALINAN INV-CV"));
	});

	it("prints neither invoice if one cannot be prepared, and shows the failed name", async () => {
		fetchPrintview.mockImplementation(async (url) => ({ ok: !url.includes("INV-CV"), text: async () => serverPage(docs.get("INV-PT")) }));
		await expect(printInvoiceBatch(["INV-PT", "INV-CV"])).rejects.toThrow("INV-CV");
		expect(popup.print).not.toHaveBeenCalled();
		expect(printHTML).not.toHaveBeenCalled();
		expect(popup.close).not.toHaveBeenCalled();
		expect(finalHTML()).toContain("Silakan cetak ulang semua nota");
		expect(offlineWorker.markOfflineInvoicePrinted).not.toHaveBeenCalled();
	});

	it("does not start requests when the popup is blocked", async () => {
		window.open.mockReturnValue(null);
		await expect(printInvoiceBatch(["INV-PT", "INV-CV"])).rejects.toThrow("Popup blocked");
		expect(call).not.toHaveBeenCalled();
	});

	it("rejects invalid input before opening a window", async () => {
		await expect(printInvoiceBatch("INV-PT")).rejects.toThrow("tidak valid");
		await expect(printInvoiceBatch([])).rejects.toThrow("tidak valid");
		expect(window.open).not.toHaveBeenCalled();
	});

	it("rejects a closed popup instead of reporting the batch as sent", async () => {
		popup.document.fonts.ready = new Promise(() => {});
		const printing = printInvoiceBatch(["INV-PT", "INV-CV"]);
		await vi.waitFor(() => expect(finalHTML()).toContain("invoice-print-page"));
		popup.closed = true;
		await expect(printing).rejects.toThrow("ditutup");
		expect(popup.print).not.toHaveBeenCalled();
	});

	it("deduplicates repeated invoice names", async () => {
		await printInvoiceBatch(["INV-PT", "INV-PT", "INV-CV"]);
		expect(fetchPrintview).toHaveBeenCalledTimes(2);
		expect(popup.print).toHaveBeenCalledOnce();
	});

	it("renders dynamic barcodes before the single print call", async () => {
		fetchPrintview.mockResolvedValue({ ok: true, text: async () => serverPage(docs.get("INV-PT")).replace('<div class="copy-banner">', '<svg data-barcode-value="123"></svg><div class="copy-banner">') });
		await printInvoiceBatch(["INV-PT", "INV-CV"]);
		expect(popup.render_barcode).toHaveBeenCalledTimes(2);
		expect(popup.render_barcode.mock.invocationCallOrder[1]).toBeLessThan(popup.print.mock.invocationCallOrder[0]);
	});

	it("routes dynamic barcodes through the browser rather than printing empty QZ placeholders", async () => {
		fetchPrintview.mockResolvedValue({ ok: true, text: async () => serverPage(docs.get("INV-PT")).replace('<div class="copy-banner">', '<svg data-barcode-value="123"></svg><div class="copy-banner">') });
		await printInvoiceBatch(["INV-PT", "INV-CV"], { silent: true });
		expect(printHTML).not.toHaveBeenCalled();
		expect(window.open).toHaveBeenCalledOnce();
		expect(popup.render_barcode).toHaveBeenCalledTimes(2);
		expect(popup.print).toHaveBeenCalledOnce();
	});

	it("loads the barcode renderer once after document load before printing either invoice", async () => {
		popup.render_barcode = undefined;
		fetchPrintview.mockResolvedValue({ ok: true, text: async () => serverPage(docs.get("INV-PT")).replace('<div class="copy-banner">', '<svg data-barcode-value="123"></svg><div class="copy-banner">') });
		await printInvoiceBatch(["INV-PT", "INV-CV"]);
		expect(popup.document.head.appendChild).toHaveBeenCalledOnce();
		expect(popup.render_barcode).toHaveBeenCalledTimes(2);
		expect(popup.print).toHaveBeenCalledOnce();
	});

	it("uses one QZ request containing two separate HTML records without a popup", async () => {
		await expect(printInvoiceBatch(["INV-PT", "INV-CV"], { silent: true })).resolves.toEqual({ method: "silent", success: true });
		expect(window.open).not.toHaveBeenCalled();
		expect(printHTML).toHaveBeenCalledOnce();
		const [documents, , options] = printHTML.mock.calls[0];
		expect(documents).toHaveLength(2);
		expect(documents[0]).toContain("SALINAN INV-PT");
		expect(documents[0]).not.toContain("SALINAN INV-CV");
		expect(documents[1]).toContain("SALINAN INV-CV");
		expect(options.scaleContent).toBe(false);
	});

	it("falls back to one combined browser window if QZ is unavailable", async () => {
		printHTML.mockRejectedValueOnce(new Error("QZ unavailable"));
		await expect(printInvoiceBatch(["INV-PT", "INV-CV"], { silent: true })).resolves.toEqual({ method: "browser", success: true });
		expect(window.open).toHaveBeenCalledOnce();
		expect(popup.print).toHaveBeenCalledOnce();
		expect(new parser().parseFromString(finalHTML(), "text/html").querySelectorAll(".invoice-print-page")).toHaveLength(2);
	});

	it("hydrates both offline receipts without fetching the server and flags both after dispatch", async () => {
		docs.set("pos_offline_batch-PT", invoice("pos_offline_batch-PT"));
		docs.set("pos_offline_batch-CV", invoice("pos_offline_batch-CV", "CV CONTOH"));
		await printInvoiceBatch(["pos_offline_batch-PT", "pos_offline_batch-CV"]);
		expect(call).not.toHaveBeenCalled();
		expect(fetchPrintview).not.toHaveBeenCalled();
		expect(popup.print).toHaveBeenCalledOnce();
		expect(offlineWorker.markOfflineInvoicePrinted.mock.calls.map(([name]) => name)).toEqual(["pos_offline_batch-PT", "pos_offline_batch-CV"]);
	});
});

describe.runIf(Boolean(process.env.POS_PRINT_BROWSER))("batch PDF pagination", () => {
	let browser;
	beforeAll(async () => { browser = await chromium.launch({ executablePath: process.env.POS_PRINT_BROWSER, args: ["--no-sandbox"] }); });
	afterAll(async () => { await browser?.close(); });
	for (const mode of ["online", "offline", "long"]) {
		it(`${mode}: preserves both companies and starts CV on its own page`, async () => {
			const names = mode === "offline" ? ["pos_offline_batch-PT", "pos_offline_batch-CV"] : ["INV-PT", "INV-CV"];
			docs.set(names[0], invoice(names[0], "PT CONTOH", mode === "long" ? 60 : 1));
			docs.set(names[1], invoice(names[1], "CV CONTOH"));
			await printInvoiceBatch(names);
			const context = await browser.newContext();
			await context.route("**/*", (route) => route.fulfill({ body: "", contentType: route.request().url().endsWith(".css") ? "text/css" : "application/javascript" }));
			const page = await context.newPage();
			await page.setContent(finalHTML(), { waitUntil: "load" });
			await page.evaluate(() => document.fonts.ready);
			const dir = "/tmp/pos-next-batch-validation";
			mkdirSync(dir, { recursive: true });
			writeFileSync(`${dir}/${mode}.html`, finalHTML());
			await page.pdf({ path: `${dir}/${mode}.pdf`, width: "72mm", height: "200mm", scale: 1, printBackground: true });
			const pdf = JSON.parse(execFileSync("/workspace/development/frappe-bench/env/bin/python", ["-c", `from pypdf import PdfReader
import json, sys, unicodedata
r=PdfReader(sys.argv[1])
print(json.dumps({'pages':[unicodedata.normalize('NFKC',p.extract_text()) for p in r.pages], 'images':sum(len(p.images) for p in r.pages)}))`, `${dir}/${mode}.pdf`], { encoding: "utf8" }));
			if (mode !== "long") expect(pdf.pages).toHaveLength(2);
			if (mode === "long") expect(pdf.pages.length).toBeGreaterThan(2);
			expect(pdf.pages[0]).toContain("PT CONTOH");
			expect(pdf.pages.at(-1)).toContain("CV CONTOH");
			expect(pdf.pages.slice(0, -1).join(" ")).not.toContain("CV CONTOH");
			expect(pdf.pages.at(-1)).not.toContain(names[0]);
			expect(pdf.pages.join(" ")).toContain(names[0]);
			expect(pdf.pages.at(-1)).toContain(names[1]);
			expect(pdf.images).toBe(0);
			await context.close();
		}, 30000);
	}
});
