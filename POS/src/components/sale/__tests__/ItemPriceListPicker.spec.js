// @vitest-environment jsdom
import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { submit, updateItemDetails } = vi.hoisted(() => ({
	submit: vi.fn(),
	updateItemDetails: vi.fn(),
}));
vi.mock("frappe-ui", () => ({ createResource: () => ({ submit }) }));
vi.mock("@/stores/posCart", () => ({ usePOSCartStore: () => ({ updateItemDetails }) }));
vi.mock("@/utils/offline", () => ({ isOffline: () => false }));
globalThis.__ = (s) => s;
import ItemPriceListPicker from "../ItemPriceListPicker.vue";
const policy = {
	enabled: true,
	territory: "Gresik",
	normal_price_list: "Regional Normal",
	options: [
		{ price_list: "Regional Normal", rate: 100, tier_level: 0 },
		{ price_list: "Any Configured Name", rate: 90, tier_level: 1 },
	],
};
beforeEach(() => {
	submit.mockReset().mockResolvedValue(policy);
	updateItemDetails.mockReset().mockResolvedValue(true);
});
async function open(item = {}) {
	const wrapper = mount(ItemPriceListPicker, {
		props: {
			item: { item_code: "A", uom: "Nos", ...item },
			posProfile: "Gresik POS",
			currency: "IDR",
		},
		global: { mocks: { __: (s) => s } },
	});
	await flushPromises();
	return wrapper;
}
describe("regional item Price List", () => {
	it("offers only lists returned by the branch policy, with arbitrary names", async () => {
		const wrapper = await open();
		expect(wrapper.findAll("option").map((o) => o.element.value)).toEqual([
			"Regional Normal",
			"Any Configured Name",
		]);
		expect(wrapper.text()).toContain("Gresik");
	});
	it("stamps the normal list without resetting existing discounts", async () => {
		await open({ rate: 95, discount_percentage: 5 });
		expect(updateItemDetails).toHaveBeenCalledWith(
			"A",
			{ custom_selling_price_list: "Regional Normal" },
			"Nos",
		);
	});
	it("updates only the selected item and clears its old discount", async () => {
		const wrapper = await open();
		updateItemDetails.mockClear();
		await wrapper.find("select").setValue("Any Configured Name");
		await flushPromises();
		expect(updateItemDetails).toHaveBeenCalledTimes(1);
		expect(updateItemDetails).toHaveBeenCalledWith(
			"A",
			expect.objectContaining({
				custom_selling_price_list: "Any Configured Name",
				rate: 90,
				price_list_rate: 90,
				discount_percentage: 0,
				discount_amount: 0,
			}),
			"Nos",
		);
	});
	it("preserves a loaded transaction selection and rate", async () => {
		await open({ custom_selling_price_list: "Any Configured Name", rate: 85 });
		expect(updateItemDetails).not.toHaveBeenCalled();
	});
	it("shows a failure when a branch policy cannot be loaded", async () => {
		submit.mockRejectedValue(new Error("Territory belum diatur"));
		const wrapper = await open();
		expect(wrapper.find("[role=alert]").text()).toContain("Territory belum diatur");
	});
});
