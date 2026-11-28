// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const call = vi.fn();
const showError = vi.fn();
const showSuccess = vi.fn();

vi.mock("@/utils/apiWrapper", () => ({ call: (...args) => call(...args) }));
vi.mock("@/composables/useToast", () => ({
	useToast: () => ({ showError, showSuccess }),
}));
vi.mock("frappe-ui", () => ({
	Dialog: { template: "<div><slot name='body-content' /></div>" },
	Button: {
		props: ["disabled", "loading"],
		template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
		emits: ["click"],
	},
}));
globalThis.__ = (s, args = []) => String(s).replace(/\{(\d+)\}/g, (_, i) => args[i]);

import PindahPesananDialog from "@/components/sale/PindahPesananDialog.vue";

const USULAN = [
	{
		item_code: "PAIL",
		qty: 7,
		dari_so: "TXSO5-00001",
		ke_so: "SO5-00001",
		ke_company: "BUANA INDAH SENTOSA, CV",
		warehouse_group: "Cabang 5",
	},
];

const METHOD = "nextend.penjualan_grup.pindah";

beforeEach(() => {
	call.mockReset();
	showError.mockReset();
	showSuccess.mockReset();
	call.mockImplementation(async (method) => {
		if (method === `${METHOD}.usulan_pindah`) return USULAN;
		if (method === `${METHOD}.ajukan`) return "PP-00001";
	});
});

async function open() {
	const wrapper = mount(PindahPesananDialog, {
		props: { modelValue: false, kodeGrup: "SOG5" },
		global: { mocks: { __: globalThis.__ } },
	});
	await wrapper.setProps({ modelValue: true });
	await flushPromises();
	return wrapper;
}

describe("PindahPesananDialog", () => {
	it("menampilkan usulan pindah untuk kode grup yang sedang dibuka", async () => {
		const wrapper = await open();

		expect(call).toHaveBeenCalledWith(`${METHOD}.usulan_pindah`, { kode_grup: "SOG5" });
		expect(wrapper.text()).toContain("TXSO5-00001");
		expect(wrapper.text()).toContain("SO5-00001");
		expect(wrapper.text()).toContain("PAIL");
	});

	it("mengirim usulan dengan qty yang diubah kasir", async () => {
		const wrapper = await open();
		await wrapper.find("input[type=number]").setValue("6");
		await wrapper
			.findAll("button")
			.find((b) => b.text() === "Ajukan pindah")
			.trigger("click");
		await flushPromises();

		expect(call).toHaveBeenCalledWith(`${METHOD}.ajukan`, {
			kode_grup: "SOG5",
			item_code: "PAIL",
			qty: 6,
			dari_so: "TXSO5-00001",
			ke_so: "SO5-00001",
			ke_company: "BUANA INDAH SENTOSA, CV",
		});
		expect(wrapper.emitted("submitted")).toHaveLength(1);
		expect(showSuccess).toHaveBeenCalled();
	});

	it("mengajukan ke company yang belum punya SO di grup", async () => {
		const usulan = [{ ...USULAN[0], ke_so: null }];
		call.mockImplementation(async (method) => (method.endsWith("usulan_pindah") ? usulan : "PP-1"));
		const wrapper = await open();

		expect(wrapper.text()).toContain("SO baru BUANA INDAH SENTOSA, CV");
		await wrapper
			.findAll("button")
			.find((b) => b.text() === "Ajukan pindah")
			.trigger("click");
		await flushPromises();

		expect(call).toHaveBeenCalledWith(
			`${METHOD}.ajukan`,
			expect.objectContaining({ ke_so: null, ke_company: "BUANA INDAH SENTOSA, CV" })
		);
	});

	it("menampilkan pesan bila tidak ada usulan", async () => {
		call.mockImplementation(async () => []);
		const wrapper = await open();

		expect(wrapper.text()).toContain("Tidak ada barang yang bisa dipindah");
		expect(wrapper.findAll("button").some((b) => b.text() === "Ajukan pindah")).toBe(false);
	});
});
