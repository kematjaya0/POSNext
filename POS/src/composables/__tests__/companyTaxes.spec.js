import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const PT = "PT Mitra Dagang Nusantara";
const CV = "CV Mitra Dagang Nusantara";
const ppn = (included) => ({
	charge_type: "On Net Total",
	rate: 11,
	included_in_print_rate: included,
	account_head: "PPN Keluaran",
});
let companyTaxes = {};

vi.mock("frappe-ui", () => ({
	createResource: ({ url }) => ({
		fetch: vi.fn(),
		submit: vi.fn(async () => (url.endsWith(".get_company_taxes") ? companyTaxes : undefined)),
	}),
}));
vi.mock("@/utils/offline", () => ({ isOffline: () => false, getCachedItem: vi.fn() }));
vi.mock("@/utils/offline/uuid", () => ({ generateUUID: () => "key-1" }));
vi.mock("@/utils/offline/db", () => ({ db: {} }));
vi.mock("@/utils/itemAddons", () => ({ getAddonCarrierItem: () => "ADDON-TINTING" }));
globalThis.__ = (s, args = []) => String(s).replace(/\{(\d+)\}/g, (_, i) => args[i]);

import { useInvoice } from "@/composables/useInvoice";

function row(item_code, price, quantity = 1) {
	return {
		item_code,
		item_name: item_code,
		uom: "Nos",
		quantity,
		rate: price,
		price_list_rate: price,
		warehouse: "W",
		conversion_factor: 1,
	};
}

describe("tax per company", () => {
	let invoice;
	beforeEach(() => {
		setActivePinia(createPinia());
		invoice = useInvoice();
	});

	async function load(company, taxes, rows, chunks = {}) {
		companyTaxes = { company, taxes };
		invoice.invoiceItems.value = rows;
		invoice.setTaxChunks((item) => chunks[item.item_code]);
		await invoice.loadTaxRules("Kasir");
	}

	it("keeps the price when the template includes PPN (TXINVTUP20261029-00001)", async () => {
		await load(PT, { [PT]: [ppn(1)] }, [row("NP-KMX-1L", 72000)]);

		expect(invoice.grandTotal.value).toBe(72000);
		expect(invoice.totalTax.value).toBe(7135.14);
		expect(invoice.addedTax.value).toBe(0);
		expect(invoice.formatItemsForSubmission(invoice.invoiceItems.value)[0].rate).toBe(72000);
	});

	it("adds PPN on top when the template does not include it", async () => {
		await load(CV, { [CV]: [ppn(0)] }, [row("DN-BRL-5KG", 100000)]);

		expect(invoice.grandTotal.value).toBe(111000);
		expect(invoice.totalTax.value).toBe(11000);
		expect(invoice.addedTax.value).toBe(11000);
		expect(invoice.formatItemsForSubmission(invoice.invoiceItems.value)[0].rate).toBe(100000);
	});

	it("taxes CV stock of a PT cashier without PPN (penjualan pecah 9a6a291e46)", async () => {
		await load(
			PT,
			{ [PT]: [ppn(1)], [CV]: [] },
			[row("NP-KMX-1L", 72000), row("DN-BRL-5KG", 126000)],
			{ "DN-BRL-5KG": [{ company: CV, qty: 1 }] }
		);

		expect(invoice.grandTotal.value).toBe(198000);
		expect(invoice.totalTax.value).toBe(7135.14);
		expect(invoice.invoiceItems.value[1].tax_amount).toBe(0);
	});

	it("taxes PT stock of a CV cashier with the PT template (TXINVTS20261014-00001)", async () => {
		await load(CV, { [CV]: [], [PT]: [ppn(1)] }, [row("NP-VNL-5KG", 150000, 20)], {
			"NP-VNL-5KG": [{ company: PT, qty: 20 }],
		});

		expect(invoice.grandTotal.value).toBe(3000000);
		expect(invoice.totalTax.value).toBe(297297.3);
	});

	it("splits one row across companies with different templates", async () => {
		await load(PT, { [PT]: [ppn(1)], [CV]: [ppn(0)] }, [row("CAT", 111000, 3)], {
			CAT: [
				{ company: PT, qty: 2 },
				{ company: CV, qty: 1 },
			],
		});

		// PT 222.000 holds 22.000 PPN; CV 111.000 + 12.210 PPN on top
		expect(invoice.totalTax.value).toBe(34210);
		expect(invoice.addedTax.value).toBe(12210);
		expect(invoice.grandTotal.value).toBe(345210);
		expect(invoice.formatItemsForSubmission(invoice.invoiceItems.value)[0].rate).toBe(111000);
	});

	it("taxes add ons by the company of the row's first chunk", async () => {
		await load(PT, { [PT]: [ppn(1)], [CV]: [ppn(0)] }, [row("CAT", 100000)], {
			CAT: [{ company: CV, qty: 1 }],
		});
		invoice.setItemAddons("CAT", "Nos", [
			{ item_code: null, addon_group: "Tinta", item_name: "Tinta", amount: 10000 },
		]);

		expect(invoice.addedTax.value).toBe(12100);
		expect(invoice.grandTotal.value).toBe(122100);
	});

	it("shows the share of each company in a split sale", async () => {
		await load(PT, { [PT]: [ppn(1)], [CV]: [] }, [row("NP-KMX-1L", 72000)]);
		expect(invoice.taxOnGross(126000, CV)).toEqual({ net: 126000, tax: 0, added: 0 });
		expect(invoice.taxOnGross(72000, PT)).toEqual({ net: 64864.86, tax: 7135.14, added: 0 });
	});
});
