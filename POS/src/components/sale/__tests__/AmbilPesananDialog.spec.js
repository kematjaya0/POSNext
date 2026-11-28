// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const call = vi.fn();
const showError = vi.fn();
const showSuccess = vi.fn();

vi.mock("@/utils/apiWrapper", () => ({ call: (...args) => call(...args) }));
vi.mock("@/utils/currency", () => ({
	formatCurrency: (value) => `Rp ${Number(value || 0).toLocaleString("id-ID")}`,
}));
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
vi.mock("@/components/sale/PindahPesananDialog.vue", () => ({
	default: {
		props: ["modelValue", "kodeGrup"],
		emits: ["update:modelValue", "submitted"],
		template: `<div v-if="modelValue" class="stub-pindah">Pindah {{ kodeGrup }}</div>`,
	},
}));
vi.mock("@/components/sale/PaymentDialog.vue", () => ({
	default: {
		props: [
			"modelValue",
			"grandTotal",
			"posProfile",
			"allowDoctypeSwitch",
			"lockedDoctype",
			"prepaidAmount",
			"orderTotal",
		],
		emits: ["payment-completed", "update:modelValue"],
		template: `<div v-if="modelValue" class="stub-payment" :data-locked="lockedDoctype" :data-prepaid="prepaidAmount" :data-order-total="orderTotal" :data-grand-total="grandTotal">
			<button @click="$emit('payment-completed', { payments: grandTotal > 0 ? [{ mode_of_payment: 'Tunai', amount: 1500000 }] : [] })">
				Selesaikan pembayaran
			</button>
		</div>`,
	},
}));
globalThis.__ = (s, args = []) => String(s).replace(/\{(\d+)\}/g, (_, i) => args[i]);

import AmbilPesananDialog from "@/components/sale/AmbilPesananDialog.vue";

const GRUP = {
	kode_grup: "SOG5",
	orders: [
		{
			name: "TXSO5-00001",
			company: "MAJU JAYA PT",
			customer: "CUST-1",
			shift: "_T-PG7-SHIFT",
			total: 1500000,
			uang_muka: 1000000,
			sisa: 500000,
			items: [
				{
					item_code: "PAIL",
					item_name: "Pail",
					qty: 15,
					sisa_qty: 15,
					rate: 100000,
					warehouse: "UTAMA - MJP",
				},
			],
		},
		{
			name: "PJR5-00001",
			company: "BUANA INDAH SENTOSA, CV",
			customer: "CUST-1",
			shift: "_T-PG7-SHIFT",
			total: 500000,
			uang_muka: 0,
			sisa: 500000,
			items: [
				{
					item_code: "PAIL",
					item_name: "Pail",
					qty: 5,
					sisa_qty: 5,
					rate: 100000,
					warehouse: "UTAMA - BISC",
				},
			],
		},
	],
};

const NOTA = {
	name: "TXPJR5-00001",
	doctype: "Sales Invoice",
	docstatus: 1,
	kode_grup: "SOG5",
	posa_split_ref: "abc123",
	pos_profile: "Kasir",
	invoices: [
		{
			name: "TXPJR5-00001",
			company: "MAJU JAYA PT",
			grand_total: 1500000,
			total_advance: 1000000,
			outstanding_amount: 0,
		},
		{
			name: "PJR5-00001",
			company: "BUANA INDAH SENTOSA, CV",
			grand_total: 500000,
			total_advance: 0,
			outstanding_amount: 0,
		},
	],
};

beforeEach(() => {
	call.mockReset();
	showError.mockReset();
	showSuccess.mockReset();
	call.mockImplementation(async (method) => {
		if (method.endsWith("get_pesanan_grup")) return GRUP;
		if (method.endsWith("buat_nota_dari_grup")) return NOTA;
	});
});

async function open() {
	const wrapper = mount(AmbilPesananDialog, {
		props: { modelValue: false, posProfile: "Kasir", currency: "IDR" },
		global: { mocks: { __: globalThis.__ } },
	});
	await wrapper.setProps({ modelValue: true });
	await flushPromises();
	return wrapper;
}

async function cari(wrapper, kode = "SOG5") {
	await wrapper.find("input[type=text]").setValue(kode);
	await wrapper
		.findAll("button")
		.find((b) => b.text() === "Cari")
		.trigger("click");
	await flushPromises();
}

const DAFTAR = [
	{
		kode_grup: "SOG5-LAMA",
		customer: "CUST",
		customer_name: "Pak Budi",
		delivery_date: "2026-11-30",
		orders: [{ name: "TXSO5-00009", company: "PT" }],
		total: 1000000,
		uang_muka: 400000,
		sisa: 600000,
	},
	{
		kode_grup: "SOG5-BARU",
		customer: "CUST2",
		customer_name: "Bu Sari",
		delivery_date: null,
		orders: [{ name: "SO5-00010", company: "CV" }],
		total: 200000,
		uang_muka: 0,
		sisa: 200000,
	},
];

describe("AmbilPesananDialog", () => {
	it("menampilkan Sales Order aktif cabang dan membuka grup yang diklik", async () => {
		call.mockImplementation(async (method) => {
			if (method.endsWith("daftar_pesanan_aktif")) return DAFTAR;
			if (method.endsWith("get_pesanan_grup")) return GRUP;
		});
		const wrapper = await open();

		expect(call).toHaveBeenCalledWith("nextend.penjualan_grup.api.daftar_pesanan_aktif", {
			pos_profile: "Kasir",
		});
		expect(wrapper.text()).toContain("SOG5-LAMA");
		expect(wrapper.text()).toContain("Bu Sari");
		expect(wrapper.text()).toContain("600.000");

		// Kotak kode juga menyaring daftar.
		await wrapper.find("input[type=text]").setValue("sari");
		expect(wrapper.text()).not.toContain("SOG5-LAMA");
		expect(wrapper.text()).toContain("SOG5-BARU");

		await wrapper.find("input[type=text]").setValue("");
		await wrapper.findAll("tbody tr")[0].trigger("click");
		await flushPromises();
		expect(call).toHaveBeenCalledWith("nextend.penjualan_grup.api.get_pesanan_grup", {
			kode_grup: "SOG5-LAMA",
		});
		expect(wrapper.text()).toContain("TXSO5-00001");
		expect(wrapper.text()).toContain("Kembali ke daftar Sales Order");
	});

	it("Sales Order yang lunas lewat DP tetap melewati checkout sebelum jadi invoice", async () => {
		const lunas = {
			...GRUP,
			orders: GRUP.orders.map((order) => ({ ...order, uang_muka: order.total, sisa: 0 })),
		};
		call.mockImplementation(async (method) => {
			if (method.endsWith("get_pesanan_grup")) return lunas;
			if (method.endsWith("buat_nota_dari_grup")) return NOTA;
		});
		const wrapper = await open();
		await cari(wrapper);
		await wrapper
			.findAll("button")
			.find((b) => b.text() === "Checkout")
			.trigger("click");
		await flushPromises();

		// Belum ada invoice sebelum kasir mengonfirmasi di checkout.
		const payment = wrapper.find(".stub-payment");
		expect(payment.exists()).toBe(true);
		expect(payment.attributes("data-grand-total")).toBe("0");
		expect(payment.attributes("data-prepaid")).toBe("2000000");
		expect(call).not.toHaveBeenCalledWith(
			"nextend.penjualan_grup.api.buat_nota_dari_grup",
			expect.anything()
		);

		await wrapper
			.findAll("button")
			.find((b) => b.text() === "Selesaikan pembayaran")
			.trigger("click");
		await flushPromises();
		expect(call).toHaveBeenCalledWith("nextend.penjualan_grup.api.buat_nota_dari_grup", {
			kode_grup: "SOG5",
			payments: [],
			pos_profile: "Kasir",
		});
		expect(wrapper.text()).toContain("TXPJR5-00001");
	});

	it("dialog bayar nota dari Sales Order mengunci pilihan ke Invoice", async () => {
		const wrapper = await open();
		await cari(wrapper);
		await wrapper
			.findAll("button")
			.find((b) => b.text() === "Bayar")
			.trigger("click");
		await flushPromises();
		const payment = wrapper.find(".stub-payment");
		expect(payment.attributes("data-locked")).toBe("Sales Invoice");
		// Total SO 2.000.000 = uang muka 1.000.000 + kekurangan 1.000.000
		expect(payment.attributes("data-prepaid")).toBe("1000000");
		expect(payment.attributes("data-grand-total")).toBe("1000000");
		expect(payment.attributes("data-order-total")).toBe("2000000");
	});

	it("menampilkan pesanan grup, uang muka, dan sisa yang belum ditagih", async () => {
		const wrapper = await open();
		await cari(wrapper);

		expect(call).toHaveBeenCalledWith("nextend.penjualan_grup.api.get_pesanan_grup", {
			kode_grup: "SOG5",
		});
		expect(wrapper.text()).toContain("TXSO5-00001");
		expect(wrapper.text()).toContain("PJR5-00001");
		expect(wrapper.text()).toContain("Pail");
		expect(wrapper.text()).toContain("1.500.000");
		expect(wrapper.text()).toContain("500.000");
	});

	it("menampilkan pesan saat kode grup tidak ditemukan", async () => {
		call.mockImplementation(async () => {
			throw new Error("Kode grup SOG-SALAH tidak ditemukan.");
		});
		const wrapper = await open();
		await cari(wrapper, "SOG-SALAH");

		expect(wrapper.text()).toContain("tidak ditemukan");
		expect(showError).toHaveBeenCalled();
		expect(wrapper.text()).not.toContain("TXSO5-00001");
	});

	it("membuka dialog usulan pindah untuk kode grup yang dicari", async () => {
		const wrapper = await open();
		await cari(wrapper);

		await wrapper
			.findAll("button")
			.find((b) => b.text() === "Ajukan pindah")
			.trigger("click");
		await flushPromises();

		expect(wrapper.find(".stub-pindah").exists()).toBe(true);
		expect(wrapper.text()).toContain("Pindah SOG5");
	});

	it("membayar sisa pesanan lewat dialog bayar dan mengirim payload yang benar", async () => {
		const wrapper = await open();
		await cari(wrapper);

		await wrapper
			.findAll("button")
			.find((b) => b.text() === "Bayar")
			.trigger("click");
		await flushPromises();
		await wrapper
			.findAll("button")
			.find((b) => b.text() === "Selesaikan pembayaran")
			.trigger("click");
		await flushPromises();

		expect(call).toHaveBeenCalledWith("nextend.penjualan_grup.api.buat_nota_dari_grup", {
			kode_grup: "SOG5",
			payments: [{ mode_of_payment: "Tunai", amount: 1500000 }],
			pos_profile: "Kasir",
		});
		expect(wrapper.text()).toContain("TXPJR5-00001");
		expect(wrapper.text()).toContain("Cetak PJR5-00001");
		expect(wrapper.text()).not.toContain("Kembalian");
	});

	it("menampilkan kembalian dari server", async () => {
		call.mockImplementation(async (method) => {
			if (method.endsWith("get_pesanan_grup")) return GRUP;
			if (method.endsWith("buat_nota_dari_grup")) return { ...NOTA, change_amount: 50000 };
		});
		const wrapper = await open();
		await cari(wrapper);
		await wrapper
			.findAll("button")
			.find((b) => b.text() === "Bayar")
			.trigger("click");
		await flushPromises();
		await wrapper
			.findAll("button")
			.find((b) => b.text() === "Selesaikan pembayaran")
			.trigger("click");
		await flushPromises();

		expect(wrapper.text()).toContain("Kembalian");
	});
});
