// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const call = vi.fn();
const requireAuthorization = vi.fn();
const isAuthorizationRequired = vi.fn(() => true);
vi.mock("@/utils/apiWrapper", () => ({ call: (...args) => call(...args) }));
vi.mock("@/composables/useAuthorization", () => ({
	useAuthorization: () => ({
		requireAuthorization: (...args) => requireAuthorization(...args),
		isAuthorizationRequired: (...args) => isAuthorizationRequired(...args),
	}),
}));
vi.mock("frappe-ui", () => ({
	Dialog: { template: "<div><slot name='body-content' /></div>" },
	Button: {
		props: ["disabled", "loading"],
		template: "<button :disabled=\"disabled\" @click=\"$emit('click')\"><slot /></button>",
		emits: ["click"],
	},
}));
globalThis.__ = (s, args = []) => String(s).replace(/\{(\d+)\}/g, (_, i) => args[i]);

import PengeluaranKasDialog from "@/components/sale/PengeluaranKasDialog.vue";

const CONTEXT = {
	allowed: true,
	pos_opening_shift: "SHIFT-1",
	pos_profile: "PROFIL A",
	sumber_dana: ["Laci Kasir", "Kas Kecil", "Non-Tunai"],
	mode_of_payment: ["Cash", "Transfer"],
	cash_mode: "Cash",
	jenis: ["Bensin", "Tol"],
	butuh_pin: true,
	batas_per_transaksi: 500000,
	batas_per_shift: 1000000,
	sisa_shift: 750000,
};

function respond(overrides = {}) {
	call.mockImplementation(async (method) => {
		if (method in overrides) {
			const value = overrides[method];
			if (value instanceof Error) throw value;
			return value;
		}
		if (method.endsWith("get_context")) return CONTEXT;
		if (method.endsWith("shift_expenses")) return { rows: [], by_mode: {}, total: 0 };
		if (method.endsWith("create")) return { name: "PKS-1", sisa_shift: 650000 };
	});
}

async function open(props = {}) {
	const wrapper = mount(PengeluaranKasDialog, {
		props: { modelValue: false, ...props },
		global: { mocks: { __: globalThis.__ } },
	});
	await wrapper.setProps({ modelValue: true });
	await flushPromises();
	return wrapper;
}

async function fill(wrapper, { total = 100000, bukti = true } = {}) {
	const selects = wrapper.findAll("select");
	await selects[1].setValue("Cash");
	await selects[2].setValue("Bensin");
	await typeTotal(wrapper, total);
	await wrapper.find('input[aria-label="Penerima"]').setValue("Pak Budi");
	await wrapper.find("textarea").setValue("Bensin mobil box");
	if (bukti) {
		const input = wrapper.find("input[type=file]");
		Object.defineProperty(input.element, "files", {
			value: [new File(["x"], "bukti.png")],
			configurable: true,
		});
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({ message: { file_url: "/files/bukti.png" } }),
		}));
		await input.trigger("change");
		await flushPromises();
	}
}

async function typeTotal(wrapper, total) {
	const input = wrapper.find('input[aria-label="Total"]');
	input.element.value = String(total);
	input.element.setSelectionRange(String(total).length, String(total).length);
	await input.trigger("input");
}

const saveButton = (wrapper) => wrapper.findAll("button").find((b) => b.text().includes("Simpan"));

describe("PengeluaranKasDialog", () => {
	beforeEach(() => {
		call.mockReset();
		requireAuthorization.mockReset();
		isAuthorizationRequired.mockReset();
		isAuthorizationRequired.mockReturnValue(true);
		respond();
	});

	it("offers only cash for Laci Kasir and only non-cash for Non-Tunai", async () => {
		respond();
		const wrapper = await open();
		const [sumber, mode] = wrapper.findAll("select");

		expect(mode.findAll("option:not([disabled])").map((o) => o.element.value)).toEqual(["Cash"]);

		await sumber.setValue("Non-Tunai");
		expect(mode.findAll("option:not([disabled])").map((o) => o.element.value)).toEqual(["Transfer"]);
		// Metode tunai yang sudah terpilih tidak boleh tertinggal di sumber Non-Tunai.
		expect(mode.element.value).toBe("Transfer");
	});

	it("groups thousands while typing and still sends a plain number", async () => {
		const wrapper = await open();
		await fill(wrapper);

		expect(wrapper.find('input[aria-label="Total"]').element.value).toBe("100.000");

		requireAuthorization.mockResolvedValue({ grant_token: "tok-1" });
		await saveButton(wrapper).trigger("click");
		await flushPromises();

		const payload = JSON.parse(call.mock.calls.find(([m]) => m.endsWith("create"))[1].payload);
		expect(payload.total).toBe(100000);
	});

	it("shows the remaining shift limit", async () => {
		const wrapper = await open();
		expect(wrapper.text()).toContain("Sisa batas shift: 750.000");
	});

	it("keeps save disabled until the form is complete", async () => {
		const wrapper = await open();
		expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
		await fill(wrapper, { bukti: false });
		expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
		await fill(wrapper);
		expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
	});

	it("asks the head of store for approval with the action and amount, then creates", async () => {
		requireAuthorization.mockResolvedValue({ grant_token: "tok-1" });
		const wrapper = await open();
		await fill(wrapper, { total: 125000 });
		await saveButton(wrapper).trigger("click");
		await flushPromises();

		expect(requireAuthorization).toHaveBeenCalledWith("Cash Expense", {
			pos_profile: "PROFIL A",
			amount: 125000,
		});
		const createCall = call.mock.calls.find(([m]) => m.endsWith("create"));
		expect(createCall[1].token).toBe("tok-1");
		expect(JSON.parse(createCall[1].payload)).toMatchObject({
			pos_opening_shift: "SHIFT-1",
			total: 125000,
			jenis: "Bensin",
			bukti: "/files/bukti.png",
		});
	});

	it("tells the cashier to reload when the PIN dialog is not armed yet", async () => {
		// Rule dibuat setelah sesi POS ini boot: policy di bootstrap belum memuatnya.
		isAuthorizationRequired.mockReturnValue(false);
		const wrapper = await open();
		await fill(wrapper);
		await saveButton(wrapper).trigger("click");
		await flushPromises();

		expect(requireAuthorization).not.toHaveBeenCalled();
		expect(call.mock.calls.some(([m]) => m.endsWith("create"))).toBe(false);
		expect(wrapper.text()).toContain("Muat ulang halaman POS");
	});

	it("does not create anything when the approval is cancelled", async () => {
		requireAuthorization.mockResolvedValue(null);
		const wrapper = await open();
		await fill(wrapper);
		await saveButton(wrapper).trigger("click");
		await flushPromises();

		expect(call.mock.calls.some(([m]) => m.endsWith("create"))).toBe(false);
	});

	it("shows the server error message", async () => {
		requireAuthorization.mockResolvedValue({ grant_token: "tok-1" });
		respond({ "nextend.pengeluaran_kas.create": new Error("Melebihi batas per shift") });
		const wrapper = await open();
		await fill(wrapper);
		await saveButton(wrapper).trigger("click");
		await flushPromises();

		expect(wrapper.text()).toContain("Melebihi batas per shift");
	});

	it("refuses while offline without calling the server", async () => {
		const wrapper = await open({ offline: true });
		expect(wrapper.text()).toContain("hanya bisa dicatat saat online");
		expect(call).not.toHaveBeenCalled();
	});

	it("explains when there is no open shift", async () => {
		respond({ "nextend.pengeluaran_kas.get_context": { allowed: false } });
		const wrapper = await open();
		expect(wrapper.text()).toContain("Tidak ada shift kasir yang terbuka");
	});
});
