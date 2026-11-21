import { describe, expect, it } from "vitest";
import { itemHasPpn, stockCompanies } from "@/utils/ppn";

const PT = "MAJU JAYA PT";
const CV = "BUANA INDAH SENTOSA, CV";
const isTaxed = (company) => company === PT;
const scope = {
	native: "Toko - MJP",
	company: PT,
	companyByWarehouse: {
		"Toko - MJP": { company: PT, abbr: "MJP" },
		"Gudang - BISC": { company: CV, abbr: "BISC" },
	},
};

describe("PPN badge of the item list", () => {
	it("marks an item whose stock is in the PT", () => {
		expect(itemHasPpn({ stock_by_company: { MJP: 5 } }, scope, isTaxed)).toBe(true);
	});

	it("leaves an item stocked only by the CV unmarked", () => {
		expect(itemHasPpn({ stock_by_company: { MJP: 0, BISC: 7 } }, scope, isTaxed)).toBe(false);
	});

	it("marks an item stocked by both companies", () => {
		const item = { stock_by_company: { MJP: 2, BISC: 7 } };
		expect(stockCompanies(item, scope)).toEqual([PT, CV]);
		expect(itemHasPpn(item, scope, isTaxed)).toBe(true);
	});

	it("falls back to the session warehouse company without stock", () => {
		expect(itemHasPpn({ stock_by_company: { MJP: -1, BISC: 0 } }, scope, isTaxed)).toBe(true);
		expect(itemHasPpn({}, { ...scope, native: "Gudang - BISC" }, isTaxed)).toBe(false);
	});

	it("uses the profile company before the scope has loaded", () => {
		const empty = { native: null, company: PT, companyByWarehouse: {} };
		expect(itemHasPpn({ stock_by_company: { MJP: 3 } }, empty, isTaxed)).toBe(true);
		expect(itemHasPpn({}, { companyByWarehouse: {} }, isTaxed)).toBe(false);
	});

	it("ignores stock of a company abbr outside the session", () => {
		expect(stockCompanies({ stock_by_company: { XYZ: 9 } }, scope)).toEqual([PT]);
	});
});
