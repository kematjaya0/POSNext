import { describe, expect, it, vi } from "vitest";

vi.mock("frappe-ui", () => ({ call: vi.fn() }));

import { cartStockQty, hasWarehouseChoice, pickSessionWarehouse } from "../stockValidator";

describe("cartStockQty", () => {
	const cart = [
		{ item_code: "A", quantity: 2, conversion_factor: 1 },
		{ item_code: "A", quantity: 1, conversion_factor: 12 },
		{ item_code: "B", quantity: 5, conversion_factor: 1 },
	];

	it("sums the item's rows in stock UOM", () => {
		expect(cartStockQty(cart, "A")).toBe(14);
	});

	it("defaults a missing conversion factor to 1", () => {
		expect(cartStockQty([{ item_code: "A", quantity: 3 }], "A")).toBe(3);
	});

	it("is 0 for an item not in the cart or an empty cart", () => {
		expect(cartStockQty(cart, "Z")).toBe(0);
		expect(cartStockQty(undefined, "A")).toBe(0);
	});
});

describe("pickSessionWarehouse", () => {
	const rows = [
		{ warehouse: "UTAMA - PT", stock_qty: 2, tier: "native" },
		{ warehouse: "UTAMA - CV", stock_qty: 5, tier: "branch" },
		{ warehouse: "DKB - PT", stock_qty: 50, tier: "outside" },
	];

	it("keeps the native warehouse while it covers the qty", () => {
		expect(pickSessionWarehouse(rows, 2)).toBe("UTAMA - PT");
	});

	it("moves to the next branch warehouse that covers the qty", () => {
		expect(pickSessionWarehouse(rows, 3)).toBe("UTAMA - CV");
	});

	it("falls back to the branch warehouse with the most stock, never outside", () => {
		expect(pickSessionWarehouse(rows, 10)).toBe("UTAMA - CV");
	});

	it("returns null without branch rows", () => {
		expect(pickSessionWarehouse([], 1)).toBeNull();
		expect(pickSessionWarehouse([rows[2]], 1)).toBeNull();
	});
});

describe("hasWarehouseChoice", () => {
	it("is false for a single-warehouse session", () => {
		expect(hasWarehouseChoice({ stock_by_warehouse: { A: 3 }, outside_qty: 0 })).toBe(false);
		expect(hasWarehouseChoice({})).toBe(false);
	});

	it("is true for a multi-warehouse branch or stock elsewhere", () => {
		expect(hasWarehouseChoice({ stock_by_warehouse: { A: 0, B: 5 } })).toBe(true);
		expect(hasWarehouseChoice({ stock_by_warehouse: { A: 0 }, outside_qty: 8 })).toBe(true);
	});
});
