// @vitest-environment jsdom
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { submit, offline } = vi.hoisted(() => ({submit: vi.fn(), offline: {value: false}}));
vi.mock("frappe-ui", () => ({createResource: () => ({submit})}));
vi.mock("@/utils/offline", () => ({isOffline: () => offline.value}));
vi.mock("@/utils/currency", () => ({formatCurrency: (value) => `Rp${value}`}));
globalThis.__ = (s) => s;
import ItemPriceListPicker from "../ItemPriceListPicker.vue";
const policy = {enabled: true, territory: "Gresik", normal_price_list: "Normal", options: [
	{price_list: "Normal", rate: 100, tier_level: 0},
	{price_list: "Spesial", rate: 90, tier_level: 1},
]};
let wrapper;
beforeEach(() => {offline.value = false; submit.mockReset().mockResolvedValue(policy);});
afterEach(() => wrapper?.unmount());
async function open(props = {}) {
	wrapper = mount(ItemPriceListPicker, {props: {item: {item_code: "A", uom: "Nos", rate: 100}, posProfile: "POS", currency: "IDR", effectiveRate: 100, ...props}, global: {mocks: {__: (s) => s}}});
	await flushPromises();
	return wrapper;
}
describe("item price reference", () => {
	it("shows only the reference and territory on the cart", async () => {
		await open();
		expect(wrapper.find("select").exists()).toBe(false);
		expect(wrapper.get('[data-testid="price-list-label"]').text()).toBe("Normal — Gresik");
	});
	it("offers a dropdown with reference prices only inside the editor", async () => {
		await open({editable: true});
		expect(wrapper.findAll("option").map((o) => o.text())).toEqual(["Normal · Rp100", "Spesial · Rp90"]);
		await wrapper.get("select").setValue("Spesial");
		expect(wrapper.emitted("select-price").at(-1)[0]).toEqual(policy.options[1]);
	});
	it("moves the reference automatically without emitting a price replacement", async () => {
		await open({item: {item_code: "A", uom: "Nos", rate: 95, custom_selling_price_list: "Normal"}, effectiveRate: 95, editable: true});
		expect(wrapper.get("select").element.value).toBe("Spesial");
		expect(wrapper.emitted("reference-change").at(-1)[0].price_list).toBe("Spesial");
		expect(wrapper.emitted("select-price")).toBeUndefined();
		expect(wrapper.props("item").rate).toBe(95);
	});
	it("returns to normal after discounts are removed", async () => {
		await open({item: {item_code: "A", uom: "Nos", custom_selling_price_list: "Spesial"}, effectiveRate: 95, editable: true});
		await wrapper.setProps({effectiveRate: 100});
		expect(wrapper.get("select").element.value).toBe("Normal");
		expect(wrapper.emitted("reference-change").at(-1)[0].price_list).toBe("Normal");
	});
	it("marks a price below all references without inventing another price list", async () => {
		await open({effectiveRate: 85, editable: true});
		expect(wrapper.get("select").element.value).toBe("Spesial");
		expect(wrapper.text()).toContain("approval tertinggi");
		expect(wrapper.findAll("option")).toHaveLength(2);
	});
	it("passes the batch and reloads when it changes", async () => {
		await open({item: {item_code: "A", uom: "Nos", batch_no: "B1"}});
		expect(submit.mock.calls[0][0].batch_no).toBe("B1");
		await wrapper.setProps({item: {...wrapper.props("item"), batch_no: "B2"}});
		await flushPromises();
		expect(submit.mock.calls.at(-1)[0].batch_no).toBe("B2");
	});
	it("ignores stale responses after the item changes", async () => {
		let finish;
		submit.mockImplementationOnce(() => new Promise((resolve) => {finish = resolve;}));
		await open();
		submit.mockResolvedValue({...policy, territory: "Surabaya", options: [{price_list: "Other", rate: 75, tier_level: 0}]});
		await wrapper.setProps({item: {item_code: "B", uom: "Nos"}});
		await flushPromises();
		finish(policy);
		await flushPromises();
		expect(wrapper.text()).toContain("Other — Surabaya");
	});
	it("cannot change price lists while offline", async () => {
		offline.value = true;
		await open({item: {item_code: "A", custom_selling_price_list: "Spesial", pricing_territory: "Gresik"}});
		expect(submit).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain("Spesial — Gresik");
	});
	it("shows a policy error", async () => {
		submit.mockRejectedValue(new Error("Territory belum diatur"));
		await open();
		expect(wrapper.get('[role="alert"]').text()).toBe("Territory belum diatur");
	});
});
