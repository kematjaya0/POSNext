// Run explicitly with POS_PRINT_BROWSER=/usr/bin/chromium-headless-shell.
// All data is synthetic; no Frappe connection or printer is used.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

globalThis.__ = (s) => s;
vi.mock("@/utils/apiWrapper", () => ({ call: vi.fn() }));
vi.mock("@/utils/offline/offlineReceiptCache", () => ({ getOfflineReceiptPayload: vi.fn() }));
vi.mock("@/utils/offline/sync", () => ({ getOfflineInvoiceByOfflineId: vi.fn() }));
vi.mock("@/utils/offline/workerClient", () => ({
	offlineWorker: { markOfflineInvoicePrinted: vi.fn().mockResolvedValue() },
}));
vi.mock("@/utils/qzTray", () => ({ printHTML: vi.fn() }));
import { buildReceiptHTML, printInvoiceCustom, silentPrintInvoiceFromDoc } from "@/utils/printInvoice";
import { printHTML } from "@/utils/qzTray";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const python = path.resolve(root, "../../env/bin/python");
const artifacts = process.env.POS_PRINT_ARTIFACTS || "/tmp/pos-next-thermal-validation";
const formats = path.join(root, "pos_next/pos_next/print_format/pos_next_receipt");

describe("receipt template source", () => {
	it("keeps the JSON fallback and file template identical", () => {
		const definition = JSON.parse(readFileSync(path.join(formats, "pos_next_receipt.json"), "utf8"));
		expect(readFileSync(path.join(formats, "pos_next_receipt.html"), "utf8").trim())
			.toBe(definition.html.trim());
	});
});

describe.runIf(Boolean(process.env.POS_PRINT_BROWSER))("thermal receipt digital render", () => {
	let browser;
	beforeAll(async () => {
		mkdirSync(artifacts, { recursive: true });
		browser = await chromium.launch({
			executablePath: process.env.POS_PRINT_BROWSER,
			args: ["--no-sandbox"],
		});
	});
	afterAll(async () => { await browser?.close(); });

	it("automatically prints a locally written popup after document.close", async () => {
		const context = await browser.newContext();
		await context.route("http://receipt.test/**", (route) => route.fulfill({
			contentType: "text/html", body: "<html><body>POS</body></html>",
		}));
		const parent = await context.newPage();
		await parent.goto("http://receipt.test/pos");
		await parent.evaluate((source) => {
			const printCustom = new Function(
				"buildReceiptDocumentHTML", "printWhenReady", "flagOfflineInvoicePrinted", "log", "__",
				`return (${source})`,
			)(
				() => '<html><body>Receipt<script>window.print = () => { window.opener.receiptPrinted = true; };</script></body></html>',
				async (popup) => { await popup.document.fonts.ready; popup.print(); },
				() => {}, console, (text) => text,
			);
			printCustom({ name: "INV-TEST" });
		}, printInvoiceCustom.toString());
		await parent.waitForFunction(() => window.receiptPrinted === true);
		await context.close();
	});

	it("prints once after actual popup navigation and font readiness", async () => {
		const template = readFileSync(path.join(formats, "pos_next_receipt.html"), "utf8");
		const script = template.match(/<script>[\s\S]*?<\/script>/)[0].replace(
			'{% include "templates/includes/receipt_print_lifecycle.js" %}',
			readFileSync(path.join(root, "pos_next/templates/includes/receipt_print_lifecycle.js"), "utf8"),
		);
		const context = await browser.newContext();
		const harness = `<script>
			Object.defineProperty(document, "fonts", {
				value: { ready: new Promise((resolve) => { window.releaseFonts = resolve; }) }
			});
			window.print = () => { window.printCalls = (window.printCalls || 0) + 1; };
		</script>`;
		await context.route("http://receipt.test/**", (route) => route.fulfill({
			contentType: "text/html",
			body: route.request().url().includes("/printview")
				? `<html><body><p>Receipt</p>${harness}${script}</body></html>`
				: "<html><body>POS</body></html>",
		}));
		const parent = await context.newPage();
		await parent.goto("http://receipt.test/pos");
		const opened = parent.waitForEvent("popup");
		await parent.evaluate(() => window.open("/printview?trigger_print=0", "_blank"));
		const popup = await opened;
		await popup.waitForLoadState("load");
		expect(await popup.evaluate(() => window.printCalls || 0)).toBe(0);
		await popup.evaluate(() => window.releaseFonts());
		await popup.waitForFunction(() => window.printCalls === 1);
		const closed = popup.waitForEvent("close");
		await popup.evaluate(() => window.dispatchEvent(new Event("afterprint")));
		await closed;
		await context.close();
	});

	for (const [scenario, count] of [["approved", 2], ["discount", 2], ["free", 2], ["short", 1], ["long-name", 4], ["long", 60]]) {
		for (const mode of ["online", "offline"]) {
			it(`${mode}: ${scenario}, black text, 72mm, no horizontal overflow, vector PDF`, async () => {
				const sampleItems = [
					{ item_name: "Cat Tembok Interior 5 kg", qty: 2, price_list_rate: 125000, rate: 125000, amount: 250000, warehouse: "Gudang Toko" },
					{ item_name: "Kuas Cat 3 inci", qty: 1, price_list_rate: 25000, rate: 25000, amount: 25000, warehouse: "Gudang Utama" },
				];
				let items;
				if (["approved", "discount", "free"].includes(scenario)) {
					items = sampleItems.map((item) => ({ ...item, discount_percentage: 0, discount_amount: 0, serial_no: "", is_free_item: 0 }));
					if (scenario === "discount") {
						Object.assign(items[0], { rate: 112500, amount: 225000, discount_percentage: 10, discount_amount: 12500 });
						Object.assign(items[1], { rate: 20000, amount: 20000, discount_amount: 5000 });
					}
					if (scenario === "free") Object.assign(items[1], { is_free_item: 1, rate: 0, amount: 0 });
				} else {
					items = Array.from({ length: count }, (_, i) => ({
						item_name: `Barang-${String(i).padStart(3, "0")} ${scenario === "long-name" ? "PRODUKPANJANG".repeat(12) : "AaBb 012345"}`,
						qty: 2, rate: 225000, amount: 450000, price_list_rate: 250000,
						discount_percentage: 10, discount_amount: 25000, is_free_item: 0,
						serial_no: `SN-${i}-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`,
						warehouse: scenario === "long-name"
							? "Gudang Cabang Utama Dengan Nama Panjang & Area Pengambilan - CV Tes"
							: i % 2 ? "Gudang Pusat - CV Tes" : "Gudang Toko - CV Tes",
					}));
				}
				const additionalDiscount = ["approved", "discount"].includes(scenario) ? 5000 : 0;
				const tax = scenario === "short" ? 11000 : 0;
				const grandTotal = items.reduce((sum, item) => sum + item.amount, 0) + tax - additionalDiscount;
				const paidAmount = scenario === "long" ? 100000 : grandTotal + 30000;
				const doc = {
					name: "INV-2026-00128",
					company: "NAMA TOKO",
					currency: "IDR",
					posting_date: "2026-11-20",
					posting_time: "10:30:00",
					customer_name: "Pelanggan Umum",
					status: scenario === "long" ? "Partly Paid" : "Paid",
					items,
					grand_total: grandTotal,
					total_taxes_and_charges: tax,
					discount_amount: additionalDiscount,
					paid_amount: paidAmount,
					outstanding_amount: Math.max(0, grandTotal - paidAmount),
					payments: [{ mode_of_payment: "Cash", amount: paidAmount }],
					change_amount: Math.max(0, paidAmount - grandTotal),
				};
				const snapshot = structuredClone(doc);
				const expectedWarehouses = doc.items.map((_, i) => {
					if (["approved", "discount", "free"].includes(scenario)) return i ? "Gudang Utama" : "Gudang Toko";
					if (scenario === "long-name") return "Gudang Cabang Utama Dengan Nama Panjang & Area Pengambilan";
					return i % 2 ? "Gudang Pusat" : "Gudang Toko";
				});
				const qr = buildReceiptHTML(doc).match(/<svg[\s\S]*?<\/svg>/)[0];
				writeFileSync(path.join(artifacts, `${scenario}.fixture.json`), JSON.stringify({ invoice: doc, qr }));
				let html;
				if (mode === "online") {
					html = JSON.parse(execFileSync(python, [path.join(root, "POS/tests/render_thermal_receipt.py")], {
						input: JSON.stringify({ invoice: doc, qr }), encoding: "utf8",
					})).html;
				} else {
					printHTML.mockClear();
					await silentPrintInvoiceFromDoc(doc);
					html = printHTML.mock.calls[0][0];
				}
				expect(doc).toEqual(snapshot);
				const prefix = path.join(artifacts, `${mode}-${scenario}`);
				writeFileSync(`${prefix}.html`, html);
				const context = await browser.newContext({
					viewport: { width: 800, height: 900 }, deviceScaleFactor: 203 / 96,
				});
				const page = await context.newPage();
				await page.setContent(html, { waitUntil: "load" });
				await page.evaluate(() => document.fonts.ready);
				await page.emulateMedia({ media: "print" });
				expect(await page.locator(".item-warehouse").count()).toBe(count);
				expect(await page.locator(".item-warehouse").first().textContent()).toBe(`[${expectedWarehouses[0]}]`);
				if (count > 1) expect(await page.locator(".item-warehouse").nth(1).textContent()).toBe(`[${expectedWarehouses[1]}]`);
				expect(await page.locator(".footer").textContent()).not.toMatch(/Thank you|Powered by|©2026/);
				const firstHeading = (await page.locator(".item-name").first().textContent()).trim();
				expect(firstHeading.startsWith(`[${expectedWarehouses[0]}]`)).toBe(true);
				expect(firstHeading).toContain(doc.items[0].item_name);
				const expectedAmount = `Rp ${new Intl.NumberFormat("id-ID").format(doc.items[0].amount)}`;
				expect(await page.locator(".item-details > span:last-child").first().textContent()).toBe(expectedAmount);
				if (scenario === "discount") {
					expect((await page.locator(".item-discount").first().textContent()).replace(/\s+/g, " ")).toContain("Diskon 10%");
					expect(await page.locator(".item-discount > span:last-child").first().textContent()).toBe("-Rp 25.000");
				}

				const metrics = await page.evaluate(() => {
					const body = document.body.getBoundingClientRect();
					const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
					const issues = [];
					while (walker.nextNode()) {
						const node = walker.currentNode;
						if (!node.textContent.trim() || ["STYLE", "SCRIPT", "title", "desc"].includes(node.parentElement.tagName)) continue;
						const style = getComputedStyle(node.parentElement);
						const range = document.createRange();
						range.selectNodeContents(node);
						for (const rect of range.getClientRects()) {
							if (!rect.width || !rect.height) continue;
							if (rect.left < body.left - 0.5 || rect.right > body.right + 0.5 || style.color !== "rgb(0, 0, 0)") {
								issues.push({ text: node.textContent.slice(0, 40), x: rect.x, right: rect.right, color: style.color });
							}
						}
					}
					return { x: body.x, width: body.width, issues, font: getComputedStyle(document.body).fontFamily };
				});
				writeFileSync(`${prefix}.metrics.json`, JSON.stringify(metrics, null, 2));
				expect(metrics.x).toBe(0);
				expect(metrics.width).toBeCloseTo(72 * 96 / 25.4, 1);
				expect(metrics.issues).toEqual([]);
				const expectedQr = await page.evaluate((source) => new DOMParser()
					.parseFromString(source, "text/html").querySelector("svg").outerHTML, qr);
				expect(await page.locator("svg").evaluate((svg) => svg.outerHTML)).toBe(expectedQr);
				await page.locator("body").screenshot({ path: `${prefix}-203dpi.png` });
				await page.pdf({ path: `${prefix}.pdf`, width: "72mm", height: "200mm", scale: 1, printBackground: true });
				await page.pdf({ path: `${prefix}-80mm.pdf`, width: "80mm", height: "200mm", scale: 1, printBackground: true });
				const pdfStats = JSON.parse(execFileSync(python, ["-c", `
import json, sys
from pypdf import PdfReader
r=PdfReader(sys.argv[1])
text='\\n'.join(page.extract_text() for page in r.pages)
print(json.dumps({'pages':len(r.pages),'text':text,'images':sum(len(page.images) for page in r.pages)}))
`, `${prefix}.pdf`], { encoding: "utf8" }));
				expect(pdfStats.text).toContain(doc.name);
				expect(pdfStats.text.replace(/\s+/g, "")).toContain(doc.items[count - 1].item_name.replace(/\s+/g, ""));
				expect(pdfStats.text).toContain("Cash");
				expect(pdfStats.text.replace(/\s+/g, "")).toContain(`[${expectedWarehouses[0].replace(/\s+/g, "")}]`);
				expect(pdfStats.text).toContain("Terima kasih atas kepercayaan anda.");
				expect(pdfStats.text.replace(/\s+/g, " ")).toContain("Barang yang sudah dibeli dapat ditukar di hari yang sama dan tidak bisa dikembalikan.");
				expect(pdfStats.images).toBe(0);
				if (scenario === "long") expect(pdfStats.pages).toBeGreaterThan(1);
				writeFileSync(`${prefix}.pdf-stats.json`, JSON.stringify(pdfStats, null, 2));
				await context.close();
			}, 30000);
		}
	}
});
