import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
const { call } = vi.hoisted(() => ({call: vi.fn()}));
vi.mock("@/utils/apiWrapper", () => ({call}));
vi.mock("frappe-ui", () => ({createResource: () => ({submit: vi.fn(), fetch: vi.fn()})}));
vi.mock("@/utils/offline", () => ({isOffline: () => false, getCachedItem: vi.fn()}));
vi.mock("@/utils/offline/offlineState", () => ({offlineState: {isOffline: false}}));
vi.mock("@/utils/offline/db", () => ({db: {}}));
vi.mock("@/utils/offline/uuid", () => ({generateUUID: () => "key"}));
vi.mock("@/utils/itemAddons", () => ({getAddonCarrierItem: () => "ADDON"}));
vi.mock("@/stores/posOffers", () => ({usePOSOffersStore: () => ({updateCartSnapshot: vi.fn()})}));
vi.mock("@/stores/posSettings", () => ({usePOSSettingsStore: () => ({shouldEnforceStockValidation: () => false})}));
vi.mock("@/stores/posShift", () => ({usePOSShiftStore: () => ({currentProfile: {selling_price_list: "Normal"}})}));
vi.mock("@/stores/stock", () => ({useStockStore: () => ({scope: {companyByWarehouse: {}}, ensureScope: vi.fn().mockResolvedValue(), getStockByWarehouse: () => ({})})}));
vi.mock("@/composables/useToast", () => ({useToast: () => ({showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn()})}));
globalThis.__ = (s) => s;
import { usePOSCartStore } from "@/stores/posCart";
let cart;
const row = (values = {}) => ({item_code: "A", item_name: "A", uom: "Nos", stock_uom: "Nos", quantity: 1, rate: 90, price_list_rate: 90, custom_selling_price_list: "Special", item_uoms: [{uom: "Box", conversion_factor: 12}], ...values});
beforeEach(() => {
	vi.useFakeTimers();
	setActivePinia(createPinia());
	cart = usePOSCartStore();
	cart.posProfile = "POS";
	call.mockReset().mockResolvedValue({enabled: true, options: [{price_list: "Special", rate: 1080}]});
});
afterEach(() => {cart.$dispose(); vi.clearAllTimers(); vi.useRealTimers();});
describe("cart price lists", () => {
	it("resolves the special rate before changing a row's UOM", async () => {
		cart.invoiceItems = [row()];
		expect(await cart.updateItemDetails("A", {uom: "Box"}, "Nos")).toBe(true);
		expect(cart.invoiceItems[0]).toMatchObject({uom: "Box", conversion_factor: 12, rate: 1080, price_list_rate: 1080, custom_selling_price_list: "Special"});
	});
	it("retains the original UOM and rate when the selected price is unavailable", async () => {
		call.mockResolvedValue({enabled: true, options: []});
		cart.invoiceItems = [row()];
		expect(await cart.updateItemDetails("A", {uom: "Box"}, "Nos")).toBe(false);
		expect(cart.invoiceItems[0]).toMatchObject({uom: "Nos", rate: 90, price_list_rate: 90});
	});
	it("refuses to merge different price lists", async () => {
		cart.invoiceItems = [row(), row({uom: "Box", custom_selling_price_list: "Normal", quantity: 3})];
		expect(await cart.updateItemDetails("A", {uom: "Box"}, "Nos")).toBe(false);
		expect(cart.invoiceItems.map((r) => r.quantity)).toEqual([1, 3]);
	});
	it("merges matching layers without losing the list", async () => {
		cart.invoiceItems = [row(), row({uom: "Box", quantity: 3, rate: 1080, price_list_rate: 1080})];
		expect(await cart.updateItemDetails("A", {uom: "Box"}, "Nos")).toBe(true);
		expect(cart.invoiceItems).toHaveLength(1);
		expect(cart.invoiceItems[0]).toMatchObject({quantity: 4, custom_selling_price_list: "Special"});
	});
});
