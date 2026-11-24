// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const { call, settings } = vi.hoisted(() => ({
	call: vi.fn(),
	settings: {
		allowUserToEditRate: false,
		allowItemDiscount: true,
		settings: { pos_profile: "Kasir" },
	},
}))
vi.mock("@/utils/apiWrapper", () => ({ call }))
vi.mock("@/utils/offline", () => ({ isOffline: () => false }))
vi.mock("@/stores/posSettings", () => ({ usePOSSettingsStore: () => settings }))
vi.mock("@/stores/posOffers", () => ({
	usePOSOffersStore: () => ({ availableOffers: [] }),
}))
vi.mock("@/stores/posShift", () => ({
	usePOSShiftStore: () => ({ currentProfile: { name: "Kasir" } }),
}))
vi.mock("@/stores/serialNumber", () => ({ useSerialNumberStore: () => ({}) }))
vi.mock("@/stores/posCart", () => ({
	usePOSCartStore: () => ({ invoiceItems: [] }),
}))
vi.mock("@/utils/stockValidator", () => ({
	cartStockQty: () => 1,
	getItemStock: vi.fn(),
}))
vi.mock("@/utils/itemAddons", () => ({ isOpenPriceItem: () => false }))
vi.mock("@/composables/useToast", () => ({
	useToast: () => ({
		showSuccess: vi.fn(),
		showError: vi.fn(),
		showWarning: vi.fn(),
	}),
}))
vi.mock("@/utils/currency", () => ({
	formatCurrency: (n) => `Rp${n}`,
	getCurrencySymbol: () => "Rp",
	roundCurrency: (n) => Math.round(n * 100) / 100,
}))
vi.mock("frappe-ui", () => ({
	createResource: ({url}) => ({
		submit: vi.fn((args) => url.includes("get_pricing_context") ? call(url, args) : Promise.resolve({price_list_rate: 3000})),
	}),
	FeatherIcon: { template: "<i />" },
	Button: {
		props: ["disabled"],
		emits: ["click"],
		template: `<button :disabled="disabled" @click="$emit('click')"><slot /></button>`,
	},
}))
globalThis.__ = (s) => s
import EditItemDialog from "@/components/sale/EditItemDialog.vue"
const ITEM = {
	item_code: "A",
	item_name: "Item A",
	uom: "Nos",
	stock_uom: "Nos",
	quantity: 1,
	rate: 3000,
	price_list_rate: 3000,
	item_uoms: [{ uom: "Box", conversion_factor: 12 }],
}
const context = (uom = "Nos") => ({
	enabled: true,
	normal_price_list: "Standard Selling",
	options: [
		{
			price_list: "Standard Selling",
			rate: uom === "Box" ? 36000 : 3000,
			tier_level: 0,
		},
		{
			price_list: "Harga Spesial",
			rate: uom === "Box" ? 34200 : 2850,
			tier_level: 1,
		},
	],
})
let wrapper
beforeEach(() => {
	settings.allowUserToEditRate = false;
	call
		.mockReset()
		.mockImplementation((method, args) =>
			Promise.resolve(
				method.includes("get_pricing_context")
					? context(args.uom)
					: { has_promotion: false },
			),
		)
})
afterEach(() => wrapper?.unmount())
async function open(item = ITEM) {
	wrapper = mount(EditItemDialog, {
		props: { modelValue: true, item: { ...item }, currency: "IDR" },
		global: {
			mocks: { __: (s) => s },
			stubs: {
				teleport: true,
				transition: false,
				WarehouseStockList: true,
				SelectInput: {
					name: "SelectInput",
					props: ["modelValue", "options", "disabled"],
					emits: ["update:modelValue"],
					template: `<select :disabled="disabled" :value="modelValue" @change="$emit('update:modelValue', $event.target.value)"><option v-for="o in options" :value="o.value">{{ o.label }}</option></select>`,
				},
			},
		},
	})
	await flushPromises()
	return wrapper
}
async function save() {
	await wrapper.findAll("button").at(-1).trigger("click")
	return wrapper.emitted("update-item")?.at(-1)?.[0]
}
describe("selected price list in the item editor", () => {
	it("uses the discounted line price to change its reference", async () => {
		await open();
		const discount = wrapper.findAll('input[type="number"]').find((field) => field.attributes('class')?.includes('pe-8'));
		await discount.setValue(3);
		await flushPromises();
		expect(wrapper.get('[aria-label="Price List Item"]').element.value).toBe("Harga Spesial");
		expect(await save()).toMatchObject({rate: 3000, price_list_rate: 3000, discount_percentage: 3, custom_selling_price_list: "Harga Spesial"});
	});
	it("does not change the cart item when a price choice is cancelled", async () => {
		await open();
		await wrapper.get('[aria-label="Price List Item"]').setValue("Harga Spesial");
		await wrapper.findAll('button').find((button) => button.text() === 'Cancel').trigger('click');
		expect(wrapper.emitted('update-item')).toBeUndefined();
		expect(wrapper.props('item').rate).toBe(3000);
	});
	it("keeps a promotion's discount when a price is selected", async () => {
		call.mockImplementation((method, args) => Promise.resolve(method.includes('get_pricing_context') ? context(args.uom) : {has_promotion: true}));
		await open({...ITEM, discount_percentage: 10});
		await wrapper.get('[aria-label="Price List Item"]').setValue("Harga Spesial");
		expect(await save()).toMatchObject({rate: 2850, price_list_rate: 2850, discount_percentage: 10});
	});

	it("puts Price List above Item Discount and applies a manual choice locally", async () => {
		await open();
		const price = wrapper.get('[aria-label="Price List Item"]');
		expect(wrapper.html().indexOf('id="item-price-list"')).toBeLessThan(wrapper.html().indexOf('Item Discount'));
		await price.setValue("Harga Spesial");
		expect(await save()).toMatchObject({rate: 2850, price_list_rate: 2850, custom_selling_price_list: "Harga Spesial", discount_amount: 0});
	});
	it("changes only the reference after a manual rate reduction", async () => {
		settings.allowUserToEditRate = true;
		await open();
		const rate = wrapper.findAll('input[type="number"]').find((field) => field.attributes('step') === '0.01' && !field.attributes('class')?.includes('pe-8'));
		await rate.setValue(2910);
		await flushPromises();
		expect(wrapper.get('[aria-label="Price List Item"]').element.value).toBe("Harga Spesial");
		expect(await save()).toMatchObject({rate: 2910, price_list_rate: 3000, custom_selling_price_list: "Harga Spesial"});
	});
	it("includes the proportional nota discount in the reference", async () => {
		await open();
		await wrapper.setProps({pricingTotal: 6000, originalItemTotal: 3000, additionalDiscount: 300});
		await flushPromises();
		expect(wrapper.get('[aria-label="Price List Item"]').element.value).toBe("Harga Spesial");
		expect(await save()).toMatchObject({rate: 3000, price_list_rate: 3000, custom_selling_price_list: "Harga Spesial"});
	});

	it("keeps the selected layer when changing UOM", async () => {
		await open({...ITEM, custom_selling_price_list: "Harga Spesial", price_list_rate: 2850, rate: 2850});
		const uom = wrapper.findAllComponents({name: "SelectInput"}).find((c) => c.props("options").some((o) => o.value === "Box"));
		await uom.find("select").setValue("Box");
		await flushPromises();
		expect(call).toHaveBeenCalledWith("nextend.sales_approval.pricing.get_pricing_context", expect.objectContaining({pos_profile: "Kasir", item_code: "A", uom: "Box", currency: "IDR"}));
		expect(await save()).toMatchObject({custom_selling_price_list: "Harga Spesial", uom: "Box", rate: 34200, price_list_rate: 34200, conversion_factor: 12, is_rate_manually_edited: 0});
	});
	it("blocks saving an unavailable UOM price and allows a valid retry", async () => {
		call.mockImplementation((method, args) => {
			if (!method.includes("get_pricing_context")) return Promise.resolve({has_promotion: false});
			const data = context(args.uom);
			if (args.uom === "Box") data.options = data.options.slice(0, 1);
			return Promise.resolve(data);
		});
		await open({...ITEM, custom_selling_price_list: "Harga Spesial", price_list_rate: 2850, rate: 2850});
		const uom = wrapper.findAllComponents({name: "SelectInput"}).find((c) => c.props("options").some((o) => o.value === "Box"));
		await uom.find("select").setValue("Box");
		await flushPromises();
		expect(wrapper.find('[role="alert"]').text()).toContain("tidak memiliki harga");
		expect(wrapper.findAll("button").at(-1).element.disabled).toBe(true);
		await uom.find("select").setValue("Nos");
		await flushPromises();
		expect(await save()).toMatchObject({uom: "Nos", rate: 2850, custom_selling_price_list: "Harga Spesial"});
	});
	it("blocks save while a price is loading and ignores the previous item's response", async () => {
		let finish;
		call.mockImplementation((method) => method.includes("get_pricing_context") ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({has_promotion: false}));
		await open({...ITEM, custom_selling_price_list: "Harga Spesial"});
		const uom = wrapper.findAllComponents({name: "SelectInput"}).find((c) => c.props("options").some((o) => o.value === "Box"));
		await uom.find("select").setValue("Box");
		expect(wrapper.findAll("button").at(-1).element.disabled).toBe(true);
		await wrapper.setProps({item: {...ITEM, item_code: "B", rate: 9000, price_list_rate: 9000}});
		finish(context("Box"));
		await flushPromises();
		expect(await save()).toMatchObject({item_code: "B", uom: "Nos", rate: 9000});
	});
});
