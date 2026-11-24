import { beforeEach, describe, expect, it, vi } from "vitest";
const { call, offline } = vi.hoisted(() => ({ call: vi.fn(), offline: { value: false } }));
vi.mock("@/utils/apiWrapper", () => ({ call }));
vi.mock("@/utils/offline", () => ({ isOffline: () => offline.value }));
globalThis.__ = (s) => s;
import { getSelectedUomPrice, selectPriceReference, pricingDiscountFactor } from "@/utils/itemPricing";
const item = { item_code: "A", custom_selling_price_list: "Special", batch_no: "BATCH-1" };
beforeEach(() => { offline.value = false; call.mockReset(); });
describe("selected layer UOM pricing", () => {
	it("keeps manual pricing available when the normal reference is missing", async () => {
		call.mockResolvedValue({enabled: true, normal_price_list: "Normal", options: [{price_list: "Normal", rate: null}]});
		await expect(getSelectedUomPrice({...item, custom_selling_price_list: "Normal"}, "POS", "Box")).resolves.toBeNull();
	});

	it("uses the selected list, requested UOM, currency and batch", async () => {
		call.mockResolvedValue({ message: { enabled: true, options: [{ price_list: "Special", rate: 1080 }] } });
		await expect(getSelectedUomPrice(item, "POS", "Box", "IDR")).resolves.toEqual({rate: 1080, price_list_rate: 1080});
		expect(call).toHaveBeenCalledWith("nextend.sales_approval.pricing.get_pricing_context", {pos_profile: "POS", item_code: "A", uom: "Box", currency: "IDR", batch_no: "BATCH-1"});
	});
	it("rejects missing special prices rather than falling back to normal", async () => {
		call.mockResolvedValue({enabled: true, options: [{price_list: "Normal", rate: 1200}]});
		await expect(getSelectedUomPrice(item, "POS", "Box")).rejects.toThrow("tidak memiliki harga");
	});
	it("does not substitute cached normal prices while offline", async () => {
		offline.value = true;
		await expect(getSelectedUomPrice(item, "POS", "Box")).rejects.toThrow("Hubungkan internet");
		expect(call).not.toHaveBeenCalled();
	});
	it("propagates connection errors", async () => {
		call.mockRejectedValue(new Error("connection lost"));
		await expect(getSelectedUomPrice(item, "POS", "Box")).rejects.toThrow("connection lost");
	});
	it("leaves legacy pricing alone when no list is selected", async () => {
		await expect(getSelectedUomPrice({item_code: "A"}, "POS", "Box")).resolves.toBeNull();
		expect(call).not.toHaveBeenCalled();
	});
	it("leaves legacy pricing alone when approval is disabled", async () => {
		call.mockResolvedValue({enabled: false});
		await expect(getSelectedUomPrice(item, "POS", "Box")).resolves.toBeNull();
	});
});

describe("automatic price references", () => {
	const options = [{price_list: "Normal", rate: 100, tier_level: 0}, {price_list: "Special", rate: 90, tier_level: 1}];
	it.each([[110,"Normal",false],[100,"Normal",false],[95,"Special",false],[90,"Special",false],[85,"Special",true]])("classifies %s without replacing its amount", (rate, name, belowAll) => {
		const result = selectPriceReference(options, rate);
		expect(result.option.price_list).toBe(name);
		expect(result.belowAll).toBe(belowAll);
	});
	it("allocates nota discount to already discounted line totals", () => {
		const factor = pricingDiscountFactor(190, 20);
		expect(selectPriceReference(options, 95 * factor).belowAll).toBe(true);
		expect(pricingDiscountFactor(0,20)).toBe(1);
	});
});
