// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const call = vi.fn();
vi.mock("@/utils/apiWrapper", () => ({ call: (...args) => call(...args) }));
vi.mock("frappe-ui", () => ({
	Dialog: { template: "<div><slot name='body-content' /></div>" },
	Button: {
		props: ["disabled", "loading"],
		template: "<button :disabled=\"disabled\" @click=\"$emit('click')\"><slot /></button>",
		emits: ["click"],
	},
}));
globalThis.__ = (s, args = []) => String(s).replace(/\{(\d+)\}/g, (_, i) => args[i]);

import PemakaianTintaDialog from "@/components/sale/PemakaianTintaDialog.vue";

const PREVIEW_OK = {
	errors: [],
	rows: [
		{ row_no: 2, item_code: "PRP-YEL", item_name: "Yellow", qty: 3, stock_uom: "Liter", status: "ok", messages: [] },
		{ row_no: 3, item_code: "PRP-RED", item_name: "Red", qty: 9, stock_uom: "Liter", status: "warning",
			messages: ["Stok saat ini 2 Liter, kurang dari pemakaian - akan Pending."] },
	],
	summary: { ok: 1, warning: 1, error: 0 },
	can_submit: true,
};
const PREVIEW_BAD = {
	errors: ["Periode beririsan dengan upload lain di gudang ini: PMT-0001"],
	rows: [{ row_no: 2, item_code: "XX", qty: false, status: "error", messages: ["Item XX tidak ditemukan."] }],
	summary: { ok: 0, warning: 0, error: 1 },
	can_submit: false,
};

const MACHINE_FORMAT = {
	name: "Dulux Colorlab",
	brand: "DULUX",
	jenis_proses: "Potong Stok",
	satuan_mesin: "Shot Dulux",
};
const MACHINE_OK = {
	can_submit: true,
	errors: [],
	format: { name: "Dulux Colorlab", brand: "DULUX", jenis_proses: "Potong Stok", versi: 1, satuan_mesin: "Shot Dulux" },
	columns: [
		{ header: "DeliveryId", role: "No. Job", used: true },
		{ header: "Rgb", role: "", used: false },
	],
	sample: { headers: ["DeliveryId", "ColorName"], rows: [["826248", "Light Charcoal"]] },
	counts: { baru: 5, sudah_diimpor: 0, sebelum_mulai: 1, penyesuaian: 0 },
	periode: { dari: "2026-10-12", sampai: "2026-10-14" },
	rows: [
		{
			row_no: 1,
			kode: "NO1",
			item_code: "IMT-NO1",
			item_name: "Tinta NO1",
			jumlah_mesin: 605.61,
			satuan_mesin: "Shot Dulux",
			faktor: 0.4620937,
			qty: 279.849,
			stock_uom: "Mililiter",
			status: "ok",
			messages: [],
		},
	],
	summary: { ok: 1, warning: 0, error: 0 },
	jobs: [
		{ no_job: "826248", waktu: "2026-10-14 15:36:01", warna: "Light Charcoal", biaya: 18460.99,
			status_cocok: "Tanpa Nota", sales_invoice: null, hpp_nota: 0, selisih_biaya: 0, job_induk: null },
	],
	jobs_total: 5,
	nota_kurang: [],
	nota_tanpa_job: [],
};

function respond(preview, brands = ["NIPPON", "PROPAN", ""], machines = [MACHINE_FORMAT]) {
	call.mockImplementation(async (method) => {
		if (method.endsWith("list_uploads"))
			return [
				{ name: "PMT-0001", brand: "PROPAN", status: "Ada Pending", rows: 2, pending: 1, can_cancel: false },
				{ name: "PMT-0002", status: "Diajukan", rows: 1, pending: 0, can_cancel: true },
			];
		if (method.endsWith("get_template_brands")) return brands;
		if (method.endsWith("tinting_import.api.get_formats")) return machines;
		if (method.endsWith("preview_upload")) return preview;
		if (method.endsWith("submit_upload")) return "PMT-0003";
		if (method.endsWith("tinting_import.api.preview")) return preview;
		if (method.endsWith("tinting_import.api.submit")) return "IMT-2610-0001";
	});
}

async function open() {
	const wrapper = mount(PemakaianTintaDialog, {
		props: { modelValue: false, warehouses: ["WH A", "WH B"], defaultWarehouse: "WH B" },
		global: { mocks: { __: globalThis.__ } },
	});
	await wrapper.setProps({ modelValue: true });
	await flushPromises();
	return wrapper;
}

function formatSelect(wrapper) {
	return wrapper.find('select[aria-label="Format"]');
}

function brandSelect(wrapper) {
	return wrapper.find('select[aria-label="Brand"]');
}

async function pickFile(wrapper) {
	const input = wrapper.find("input[type=file]");
	Object.defineProperty(input.element, "files", {
		value: [new File(["x"], "pakai.xlsx")],
		configurable: true,
	});
	await input.trigger("change");
	await flushPromises();
}

async function chooseFile(wrapper, { periode = true, brand = "PROPAN" } = {}) {
	if (brand !== null) await brandSelect(wrapper).setValue(brand);
	const dates = wrapper.findAll("input[type=date]");
	if (periode) {
		await dates[0].setValue("2026-09-01");
		await dates[1].setValue("2026-09-30");
	}
	await pickFile(wrapper);
}

async function chooseMachineFile(wrapper, format = "Dulux Colorlab") {
	await formatSelect(wrapper).setValue(format);
	await pickFile(wrapper);
}

function batalkan(wrapper) {
	return wrapper.findAll("button").filter((b) => b.text() === "Batalkan");
}

function ajukan(wrapper) {
	return wrapper.findAll("button").find((b) => b.text() === "Ajukan");
}

describe("PemakaianTintaDialog", () => {
	beforeEach(() => {
		call.mockReset();
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({ message: { file_url: "/private/files/pakai.xlsx" } }),
		}));
	});

	it("opens on the shift warehouse with its upload history and template link", async () => {
		respond(PREVIEW_OK);
		const wrapper = await open();
		expect(wrapper.find("select").element.value).toBe("WH B");
		expect(call).toHaveBeenCalledWith("nextend.pemakaian_tinta.list_uploads", { warehouse: "WH B" });
		expect(wrapper.text()).toContain("PMT-0001");
		expect(wrapper.text()).toContain("1 pending");
		expect(wrapper.text()).toContain("PROPAN ·");
		expect(wrapper.text()).toContain("(Tanpa Brand) ·");
	});

	it("lists the warehouse brands and needs one before the template downloads", async () => {
		respond(PREVIEW_OK);
		const wrapper = await open();
		expect(call).toHaveBeenCalledWith("nextend.pemakaian_tinta.get_template_brands", { warehouse: "WH B" });
		const options = brandSelect(wrapper).findAll("option").map((o) => o.text());
		expect(options).toEqual(["Pilih brand", "NIPPON", "PROPAN", "(Tanpa Brand)"]);
		expect(wrapper.find("a").exists()).toBe(false);

		await brandSelect(wrapper).setValue("NIPPON");
		expect(wrapper.find("a").attributes("href")).toContain("download_template?warehouse=WH%20B&brand=NIPPON");
		await brandSelect(wrapper).setValue("");
		expect(wrapper.find("a").attributes("href")).toMatch(/&brand=$/);
	});

	it("picks the only brand by itself", async () => {
		respond(PREVIEW_OK, ["AVIAN"]);
		const wrapper = await open();
		expect(wrapper.find("a").attributes("href")).toContain("&brand=AVIAN");
	});

	it("says when the warehouse has no tinta", async () => {
		respond(PREVIEW_OK, []);
		const wrapper = await open();
		expect(wrapper.text()).toContain("Belum ada tinta add on");
	});

	it("asks for the period before reading a file", async () => {
		respond(PREVIEW_OK);
		const wrapper = await open();
		await chooseFile(wrapper, { periode: false });
		expect(globalThis.fetch).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain("Pilih brand dan isi periode");
	});

	it("asks for the brand before reading a file", async () => {
		respond(PREVIEW_OK);
		const wrapper = await open();
		await chooseFile(wrapper, { brand: null });
		expect(globalThis.fetch).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain("Pilih brand dan isi periode");
	});

	it("previews the file and submits it", async () => {
		respond(PREVIEW_OK);
		const wrapper = await open();
		await chooseFile(wrapper);

		expect(call).toHaveBeenCalledWith("nextend.pemakaian_tinta.preview_upload", {
			warehouse: "WH B",
			brand: "PROPAN",
			periode_dari: "2026-09-01",
			periode_sampai: "2026-09-30",
			file_url: "/private/files/pakai.xlsx",
		});
		expect(wrapper.text()).toContain("akan Pending");
		expect(ajukan(wrapper).element.disabled).toBe(false);

		await ajukan(wrapper).trigger("click");
		await flushPromises();
		expect(call).toHaveBeenCalledWith("nextend.pemakaian_tinta.submit_upload", expect.objectContaining({
			file_url: "/private/files/pakai.xlsx",
		}));
		expect(ajukan(wrapper)).toBeUndefined(); // preview cleared
	});

	it("blocks submitting while the preview has errors", async () => {
		respond(PREVIEW_BAD);
		const wrapper = await open();
		await chooseFile(wrapper);
		expect(wrapper.text()).toContain("Periode beririsan");
		expect(wrapper.text()).toContain("tidak ditemukan");
		expect(ajukan(wrapper).element.disabled).toBe(true);
	});

	it("shows a failed upload instead of a preview", async () => {
		respond(PREVIEW_OK);
		globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({ exception: "Too big" }) }));
		const wrapper = await open();
		await chooseFile(wrapper);
		expect(wrapper.text()).toContain("Too big");
		expect(ajukan(wrapper)).toBeUndefined();
	});

	it("offers Batalkan only on uploads the server allows to withdraw", async () => {
		respond(PREVIEW_OK);
		const wrapper = await open();
		expect(batalkan(wrapper)).toHaveLength(1);

		globalThis.confirm = vi.fn(() => false);
		await batalkan(wrapper)[0].trigger("click");
		expect(call).not.toHaveBeenCalledWith("nextend.pemakaian_tinta.cancel_upload", expect.anything());

		globalThis.confirm = vi.fn(() => true);
		call.mockClear();
		await batalkan(wrapper)[0].trigger("click");
		await flushPromises();
		expect(call.mock.calls.map(([m]) => m)).toEqual([
			"nextend.pemakaian_tinta.cancel_upload",
			"nextend.pemakaian_tinta.list_uploads",
			"nextend.pemakaian_tinta.get_template_brands",
			"nextend.tinting_import.api.get_formats",
		]);
		expect(call).toHaveBeenCalledWith("nextend.pemakaian_tinta.cancel_upload", { name: "PMT-0002" });
	});

	it("shows why a withdraw failed", async () => {
		respond(PREVIEW_OK);
		const wrapper = await open();
		call.mockImplementation(async () => {
			throw new Error("Hanya upload berstatus Diajukan yang bisa dibatalkan dari POS.");
		});
		globalThis.confirm = vi.fn(() => true);
		await batalkan(wrapper)[0].trigger("click");
		await flushPromises();
		expect(wrapper.text()).toContain("Hanya upload berstatus Diajukan");
	});

	// -- mesin tinting ------------------------------------------------------

	it("defaults to Template Manual with brand, period and template download", async () => {
		respond(PREVIEW_OK);
		const wrapper = await open();
		const options = formatSelect(wrapper).findAll("option").map((o) => o.text());
		expect(options[0]).toBe("Template Manual");
		expect(wrapper.text()).toContain("Download Template");
		expect(wrapper.findAll("input[type=date]")).toHaveLength(2);

		await chooseFile(wrapper);
		expect(call).toHaveBeenCalledWith("nextend.pemakaian_tinta.preview_upload", expect.anything());
		expect(call).not.toHaveBeenCalledWith("nextend.tinting_import.api.preview", expect.anything());
	});

	it("reads a machine file without brand or period", async () => {
		respond(MACHINE_OK);
		const wrapper = await open();
		await chooseMachineFile(wrapper);

		expect(wrapper.text()).not.toContain("Download Template");
		expect(wrapper.findAll("input[type=date]")).toHaveLength(0);
		expect(call).toHaveBeenCalledWith("nextend.tinting_import.api.preview", {
			format_name: "Dulux Colorlab",
			warehouse: "WH B",
			file_url: "/private/files/pakai.xlsx",
		});
	});

	it("shows machine and stock units with the conversion factor", async () => {
		respond(MACHINE_OK);
		const wrapper = await open();
		await chooseMachineFile(wrapper);

		expect(wrapper.text()).toContain("605.61 Shot Dulux");
		expect(wrapper.text()).toContain("0.4620937");
		expect(wrapper.text()).toContain("279.849 Mililiter");
	});

	it("marks every file column as used or not", async () => {
		respond(MACHINE_OK);
		const wrapper = await open();
		await chooseMachineFile(wrapper);

		expect(wrapper.text()).toContain("DeliveryId (Diproses: No. Job)");
		expect(wrapper.text()).toContain("Rgb (Tidak dipakai)");
	});

	it("blocks a machine file whose rows have errors", async () => {
		respond({ ...MACHINE_OK, can_submit: false, errors: ["Format file tidak sesuai"] });
		const wrapper = await open();
		await chooseMachineFile(wrapper);

		expect(wrapper.text()).toContain("Format file tidak sesuai");
		expect(ajukan(wrapper).element.disabled).toBe(true);
	});

	it("shows a job without nota but still allows submitting", async () => {
		respond(MACHINE_OK);
		const wrapper = await open();
		await chooseMachineFile(wrapper);

		expect(wrapper.text()).toContain("Tanpa Nota");
		expect(ajukan(wrapper).element.disabled).toBe(false);

		await ajukan(wrapper).trigger("click");
		await flushPromises();
		expect(call).toHaveBeenCalledWith("nextend.tinting_import.api.submit", {
			format_name: "Dulux Colorlab",
			warehouse: "WH B",
			file_url: "/private/files/pakai.xlsx",
		});
	});

	it("says a history-only format does not change stock", async () => {
		respond({
			...MACHINE_OK,
			format: { ...MACHINE_OK.format, name: "Avian Dispense", jenis_proses: "Hanya Riwayat" },
		});
		const wrapper = await open();
		await chooseMachineFile(wrapper, "Dulux Colorlab");

		expect(wrapper.text()).toContain("Hanya Riwayat, stok tidak berubah");
	});

	it("lists a history-only upload without a Batalkan button", async () => {
		respond(MACHINE_OK);
		call.mockImplementation(async (method) => {
			if (method.endsWith("list_uploads"))
				return [
					{ name: "IMT-2610-0001", brand: "AVIAN", status: "Tercatat", rows: 2, pending: 0,
						can_cancel: false, sumber: "File Mesin", periode_dari: "2026-10-14", periode_sampai: "2026-10-14" },
				];
			if (method.endsWith("get_template_brands")) return [];
			if (method.endsWith("tinting_import.api.get_formats")) return [];
		});
		const wrapper = await open();

		expect(wrapper.text()).toContain("IMT-2610-0001");
		expect(wrapper.text()).toContain("Tercatat");
		expect(wrapper.text()).toContain("2 job mesin");
		expect(batalkan(wrapper)).toHaveLength(0);
	});
});
