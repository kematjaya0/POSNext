import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

vi.mock("@/utils/apiWrapper", () => ({ call: vi.fn() }));
vi.mock("@/utils/offline", () => ({ isOffline: () => false }));
vi.mock("@/utils/offline/workerClient", () => ({
	offlineWorker: { searchCachedCustomers: vi.fn(), cacheCustomers: vi.fn() },
}));
vi.mock("@/composables/useRealtimeCustomers", () => ({
	useRealtimeCustomers: () => ({ onCustomerUpdate: () => {} }),
}));

const store = new Map();
globalThis.localStorage = {
	getItem: (k) => store.get(k) ?? null,
	setItem: (k, v) => store.set(k, String(v)),
	clear: () => store.clear(),
};

import { call } from "@/utils/apiWrapper";
import { offlineWorker } from "@/utils/offline/workerClient";
import { useCustomerSearchStore } from "@/stores/customerSearch";

describe("loadAllCustomers", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		vi.clearAllMocks();
		localStorage.clear();
	});

	it("empty IndexedDB with a stale sync key does a full fetch, not a delta", async () => {
		localStorage.setItem("pos_customers_last_sync", "2026-10-07T00:00:00.000Z");
		offlineWorker.searchCachedCustomers.mockResolvedValue([]);
		call.mockResolvedValue([{ name: "CUST-1", customer_name: "Umum", disabled: 0 }]);

		const store = useCustomerSearchStore();
		await store.loadAllCustomers("Utama");

		expect(call.mock.calls[0][1].modified_since).toBeNull();
		expect(store.allCustomers).toHaveLength(1);
	});

	it("populated cache still uses the delta sync key", async () => {
		localStorage.setItem("pos_customers_last_sync", "2026-10-07T00:00:00.000Z");
		offlineWorker.searchCachedCustomers.mockResolvedValue([{ name: "CUST-1" }]);
		call.mockResolvedValue([]);

		await useCustomerSearchStore().loadAllCustomers("Utama");

		expect(call.mock.calls[0][1].modified_since).toBe("2026-10-07T00:00:00.000Z");
	});
});
