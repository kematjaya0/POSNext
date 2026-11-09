<template>
	<Dialog v-model="show" :options="{ title: __('Pemakaian Tinta'), size: '3xl' }">
		<template #body-content>
			<div class="flex flex-col gap-3 text-start">
				<div class="flex items-center gap-2">
					<select
						v-model="warehouse"
						class="flex-1 h-8 text-sm border border-gray-300 rounded px-2"
						:aria-label="__('Gudang')"
					>
						<option v-for="wh in warehouses" :key="wh" :value="wh">{{ wh }}</option>
					</select>
					<Button variant="subtle" :loading="loadingList" @click="loadUploads">
						{{ __("Refresh") }}
					</Button>
				</div>

				<!-- New upload -->
				<div class="border border-gray-200 rounded-lg p-3 flex flex-col gap-2">
					<div class="text-sm font-semibold text-gray-900">{{ __("Upload Baru") }}</div>
					<div class="flex flex-wrap items-end gap-2">
						<label class="text-xs text-gray-600 flex flex-col gap-1">
							{{ __("Format") }}
							<select
								v-model="format"
								class="h-8 text-sm border border-gray-300 rounded px-2"
								:aria-label="__('Format')"
							>
								<option :value="MANUAL">{{ __("Template Manual") }}</option>
								<option v-for="machine in formats" :key="machine.name" :value="machine.name">
									{{ machine.name }} · {{ machine.jenis_proses }}
								</option>
							</select>
						</label>
						<template v-if="format === MANUAL">
							<label class="text-xs text-gray-600 flex flex-col gap-1">
								{{ __("Brand") }}
								<select
									v-model="brand"
									class="h-8 text-sm border border-gray-300 rounded px-2"
									:aria-label="__('Brand')"
								>
									<option :value="null" disabled>{{ __("Pilih brand") }}</option>
									<option v-for="name in brands" :key="name" :value="name">
										{{ brandLabel(name) }}
									</option>
								</select>
							</label>
							<label class="text-xs text-gray-600 flex flex-col gap-1">
								{{ __("Periode Dari") }}
								<input
									v-model="periodeDari"
									type="date"
									class="h-8 text-sm border border-gray-300 rounded px-2"
								/>
							</label>
							<label class="text-xs text-gray-600 flex flex-col gap-1">
								{{ __("Periode Sampai") }}
								<input
									v-model="periodeSampai"
									type="date"
									class="h-8 text-sm border border-gray-300 rounded px-2"
								/>
							</label>
							<a
								v-if="brand !== null"
								:href="templateUrl"
								class="h-8 inline-flex items-center px-3 text-sm rounded bg-gray-100 hover:bg-gray-200 text-gray-800"
							>
								{{ __("Download Template") }}
							</a>
							<span
								v-else
								class="h-8 inline-flex items-center px-3 text-sm rounded bg-gray-50 text-gray-400"
							>
								{{ __("Download Template") }}
							</span>
						</template>
						<input
							ref="fileInput"
							type="file"
							:accept="format === MANUAL ? '.xlsx,.csv' : '.xlsx,.xls,.csv'"
							class="text-sm"
							@change="onFileChosen"
						/>
					</div>
					<p v-if="format === MANUAL && !brands.length && !loadingList" class="text-xs text-yellow-700">
						{{ __("Belum ada tinta add on yang tercatat di gudang ini.") }}
					</p>
					<p v-if="format === MANUAL" class="text-xs text-gray-500">
						{{
							__(
								"Isi kolom Qty Keluar dengan total pemakaian periode ini dalam satuan di template. Baris kosong dianggap tidak dipakai. Salah qty? Batalkan upload yang masih Diajukan lalu upload ulang; yang sudah disetujui minta dibatalkan Stock Manager."
							)
						}}
					</p>
					<p v-else class="text-xs text-gray-500">
						{{ __("Upload sore saat closing, setelah semua penjualan hari ini masuk.") }}
					</p>
					<p v-if="error" class="text-sm text-red-600">{{ error }}</p>
					<div v-if="previewing" class="text-sm text-gray-500">{{ __("Membaca file...") }}</div>
				</div>

				<!-- Preview: template manual -->
				<div
					v-if="preview && format === MANUAL"
					class="border border-gray-200 rounded-lg p-3 flex flex-col gap-2"
				>
					<div class="flex flex-wrap items-center gap-3 text-sm">
						<span class="font-semibold">{{ __("Preview") }}</span>
						<span class="text-green-700">✓ {{ preview.summary.ok }} OK</span>
						<span class="text-yellow-700">⚠ {{ preview.summary.warning }} {{ __("peringatan") }}</span>
						<span class="text-red-700">✗ {{ preview.summary.error }} error</span>
					</div>
					<ul v-if="preview.errors.length" class="text-sm text-red-600 list-disc ps-5">
						<li v-for="message in preview.errors" :key="message">{{ message }}</li>
					</ul>
					<div v-if="preview.rows.length" class="max-h-72 overflow-y-auto">
						<table class="w-full text-xs">
							<thead class="text-gray-500 border-b border-gray-200">
								<tr>
									<th class="py-1 pe-2 text-start">{{ __("Baris") }}</th>
									<th class="py-1 pe-2 text-start">{{ __("Item") }}</th>
									<th class="py-1 pe-2 text-end">{{ __("Qty") }}</th>
									<th class="py-1 text-start">{{ __("Status") }}</th>
								</tr>
							</thead>
							<tbody>
								<tr
									v-for="row in preview.rows"
									:key="row.row_no"
									class="border-b border-gray-50 align-top"
									:class="ROW_CLASS[row.status]"
								>
									<td class="py-1 pe-2">{{ row.row_no }}</td>
									<td class="py-1 pe-2">
										<div class="font-medium text-gray-900">{{ row.item_code || "-" }}</div>
										<div class="text-gray-500">{{ row.item_name || "" }}</div>
									</td>
									<td class="py-1 pe-2 text-end whitespace-nowrap">
										{{ row.qty === false ? "?" : row.qty }} {{ row.stock_uom || "" }}
									</td>
									<td class="py-1">
										<span v-if="row.status === 'ok'">✓</span>
										<div v-for="message in row.messages" :key="message">
											{{ row.status === "error" ? "✗" : "⚠" }} {{ message }}
										</div>
									</td>
								</tr>
							</tbody>
						</table>
					</div>
					<div class="flex justify-end gap-2">
						<Button variant="subtle" @click="resetUpload">{{ __("Batal") }}</Button>
						<Button
							theme="blue"
							variant="solid"
							:disabled="!preview.can_submit"
							:loading="submitting"
							@click="submitUpload"
						>
							{{ __("Ajukan") }}
						</Button>
					</div>
					<p v-if="!preview.can_submit" class="text-xs text-red-600">
						{{ __("Perbaiki error di file lalu upload ulang.") }}
					</p>
				</div>

				<!-- Preview: file mesin -->
				<div
					v-else-if="preview"
					class="border border-gray-200 rounded-lg p-3 flex flex-col gap-2"
				>
					<div class="flex flex-wrap items-center gap-2 text-sm">
						<span class="font-semibold">{{ __("Preview") }}</span>
						<span class="text-gray-700">{{ preview.format.name }}</span>
						<span class="text-gray-500">
							{{ preview.format.jenis_proses }} · {{ __("versi {0}", [preview.format.versi]) }}
						</span>
					</div>
					<p
						v-if="preview.format.jenis_proses === 'Hanya Riwayat'"
						class="text-xs text-blue-700"
					>
						{{ __("Hanya Riwayat, stok tidak berubah") }}
					</p>
					<ul v-if="preview.errors.length" class="text-sm text-red-600 list-disc ps-5">
						<li v-for="message in preview.errors" :key="message">{{ message }}</li>
					</ul>

					<div class="text-xs">
						<div class="font-semibold text-gray-900 mb-1">{{ __("Kolom file") }}</div>
						<div class="flex flex-wrap gap-x-3 gap-y-1">
							<span v-for="column in preview.columns" :key="column.header">
								<span v-if="column.used" class="text-green-700">
									{{ column.header }} ({{ __("Diproses") }}{{ column.role ? `: ${column.role}` : "" }})
								</span>
								<span v-else class="text-gray-400">
									{{ column.header }} ({{ __("Tidak dipakai") }})
								</span>
							</span>
						</div>
					</div>

					<div v-if="preview.sample.rows.length" class="overflow-x-auto text-xs">
						<div class="font-semibold text-gray-900 mb-1">{{ __("Contoh Baris") }}</div>
						<table class="w-full">
							<thead class="text-gray-500 border-b border-gray-200">
								<tr>
									<th
										v-for="header in preview.sample.headers"
										:key="header"
										class="py-1 pe-2 text-start whitespace-nowrap"
									>
										{{ header }}
									</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="(row, index) in preview.sample.rows" :key="index">
									<td
										v-for="(cell, cellIndex) in row"
										:key="cellIndex"
										class="py-1 pe-2 whitespace-nowrap"
									>
										{{ cell }}
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<div class="flex flex-wrap gap-3 text-sm">
						<span>{{ __("{0} job baru", [preview.counts.baru]) }}</span>
						<span class="text-gray-500">
							{{ __("{0} sudah diimpor", [preview.counts.sudah_diimpor]) }}
						</span>
						<span class="text-gray-500">
							{{ __("{0} sebelum mulai", [preview.counts.sebelum_mulai]) }}
						</span>
						<span v-if="preview.counts.penyesuaian" class="text-gray-500">
							{{ __("{0} penyesuaian", [preview.counts.penyesuaian]) }}
						</span>
						<span
							v-if="preview.periode.dari"
							class="text-gray-500"
						>
							{{ preview.periode.dari }} – {{ preview.periode.sampai }}
						</span>
					</div>

					<div v-if="preview.rows.length" class="max-h-72 overflow-y-auto">
						<table class="w-full text-xs">
							<thead class="text-gray-500 border-b border-gray-200">
								<tr>
									<th class="py-1 pe-2 text-start">{{ __("Kode") }}</th>
									<th class="py-1 pe-2 text-start">{{ __("Item") }}</th>
									<th class="py-1 pe-2 text-end">{{ __("Jumlah Mesin") }}</th>
									<th class="py-1 pe-2 text-end">{{ __("Faktor") }}</th>
									<th class="py-1 pe-2 text-end">{{ __("Qty Stok") }}</th>
									<th class="py-1 text-start">{{ __("Status") }}</th>
								</tr>
							</thead>
							<tbody>
								<tr
									v-for="row in preview.rows"
									:key="row.row_no"
									class="border-b border-gray-50 align-top"
									:class="ROW_CLASS[row.status]"
								>
									<td class="py-1 pe-2">{{ row.kode }}</td>
									<td class="py-1 pe-2">
										<div class="font-medium text-gray-900">{{ row.item_code || "-" }}</div>
										<div class="text-gray-500">{{ row.item_name || "" }}</div>
									</td>
									<td class="py-1 pe-2 text-end whitespace-nowrap">
										{{ row.jumlah_mesin }} {{ row.satuan_mesin || "" }}
									</td>
									<td class="py-1 pe-2 text-end">{{ row.faktor || "-" }}</td>
									<td class="py-1 pe-2 text-end whitespace-nowrap">
										{{ row.qty === null ? "-" : `${row.qty} ${row.stock_uom || ""}` }}
									</td>
									<td class="py-1">
										<span v-if="row.status === 'ok'">✓</span>
										<div v-for="message in row.messages" :key="message">
											{{ row.status === "error" ? "✗" : "⚠" }} {{ message }}
										</div>
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<div v-if="preview.jobs.length" class="max-h-72 overflow-y-auto">
						<div class="font-semibold text-gray-900 mb-1">{{ __("Hasil Cocok dengan Nota") }}</div>
						<table class="w-full text-xs">
							<thead class="text-gray-500 border-b border-gray-200">
								<tr>
									<th class="py-1 pe-2 text-start">{{ __("No. Job") }}</th>
									<th class="py-1 pe-2 text-start">{{ __("Waktu") }}</th>
									<th class="py-1 pe-2 text-start">{{ __("Warna") }}</th>
									<th class="py-1 pe-2 text-start">{{ __("Nota") }}</th>
									<th class="py-1 text-start">{{ __("Status") }}</th>
								</tr>
							</thead>
							<tbody>
								<tr
									v-for="job in preview.jobs"
									:key="job.no_job"
									class="border-b border-gray-50"
									:class="MATCH_CLASS[job.status_cocok] || ''"
								>
									<td class="py-1 pe-2">{{ job.no_job }}</td>
									<td class="py-1 pe-2 whitespace-nowrap">{{ job.waktu }}</td>
									<td class="py-1 pe-2">{{ job.warna }}</td>
									<td class="py-1 pe-2">{{ job.sales_invoice || "-" }}</td>
									<td class="py-1">{{ job.status_cocok }}</td>
								</tr>
							</tbody>
						</table>
					</div>

					<div v-if="preview.nota_kurang.length" class="text-xs">
						<div class="font-semibold text-gray-900 mb-1">{{ __("Nota Belum Terpenuhi") }}</div>
						<div v-for="nota in preview.nota_kurang" :key="nota.sales_invoice">
							{{ nota.sales_invoice }} · {{ nota.no_job }} · {{ __("qty {0}, terisi {1}", [nota.qty, nota.kaleng]) }}
						</div>
					</div>

					<div v-if="preview.nota_tanpa_job.length" class="text-xs">
						<div class="font-semibold text-gray-900 mb-1">{{ __("Nota Tanpa Job di File") }}</div>
						<div v-for="nota in preview.nota_tanpa_job" :key="nota.no_job">
							{{ nota.sales_invoice }} · {{ nota.no_job }} · {{ nota.item_code }} · {{ nota.posting_date }}
						</div>
					</div>

					<div class="flex justify-end gap-2">
						<Button variant="subtle" @click="resetUpload">{{ __("Batal") }}</Button>
						<Button
							theme="blue"
							variant="solid"
							:disabled="!preview.can_submit"
							:loading="submitting"
							@click="submitUpload"
						>
							{{ __("Ajukan") }}
						</Button>
					</div>
					<p v-if="!preview.can_submit" class="text-xs text-red-600">
						{{ __("File belum bisa diajukan - hubungi Stock Manager bila formatnya berubah.") }}
					</p>
				</div>

				<!-- History -->
				<div class="flex flex-col gap-2">
					<div class="text-sm font-semibold text-gray-900">{{ __("Riwayat Upload") }}</div>
					<div v-if="!uploads.length" class="text-sm text-gray-500">
						{{ __("Belum ada upload untuk gudang ini.") }}
					</div>
					<div
						v-for="upload in uploads"
						:key="upload.name"
						class="border border-gray-200 rounded-lg p-2 flex items-start justify-between gap-2"
					>
						<div class="min-w-0">
							<div class="text-sm font-semibold text-gray-900">{{ upload.name }}</div>
							<div class="text-xs text-gray-500">
								{{ brandLabel(upload.brand || "") }} ·
								{{ upload.periode_dari }} – {{ upload.periode_sampai }} ·
								<template v-if="upload.sumber === 'File Mesin'">
									{{ __("{0} job mesin", [upload.rows]) }}
								</template>
								<template v-else>
									{{ __("{0} tinta", [upload.rows]) }}
								</template>
								<template v-if="upload.pending">
									· {{ __("{0} pending", [upload.pending]) }}
								</template>
							</div>
							<div v-if="upload.alasan_tolak" class="text-xs text-red-600">
								{{ upload.alasan_tolak }}
							</div>
						</div>
						<div class="flex flex-col items-end gap-1">
							<span
								class="text-[11px] font-semibold px-2 py-0.5 rounded whitespace-nowrap"
								:class="STATUS_CLASS[upload.status] || 'bg-gray-100 text-gray-700'"
							>
								{{ upload.status }}
							</span>
							<Button
								v-if="upload.can_cancel"
								variant="subtle"
								size="sm"
								:loading="cancelling === upload.name"
								@click="cancelUpload(upload.name)"
							>
								{{ __("Batalkan") }}
							</Button>
						</div>
					</div>
				</div>
			</div>
		</template>
	</Dialog>
</template>

<script setup>
import { call } from "@/utils/apiWrapper";
import { Button, Dialog } from "frappe-ui";
import { computed, ref, watch } from "vue";

const METHOD = "nextend.pemakaian_tinta";
const IMPORT = "nextend.tinting_import.api";
const MANUAL = "__manual__";
const ROW_CLASS = { error: "bg-red-50", warning: "bg-yellow-50", ok: "" };
const MATCH_CLASS = { "Tanpa Nota": "bg-yellow-50", "Selisih Biaya": "bg-yellow-50" };
const STATUS_CLASS = {
	Diajukan: "bg-blue-100 text-blue-700",
	Tercatat: "bg-blue-100 text-blue-700",
	Memproses: "bg-orange-100 text-orange-700",
	"Ada Pending": "bg-yellow-100 text-yellow-800",
	Selesai: "bg-green-100 text-green-700",
	Ditolak: "bg-red-100 text-red-700",
	Gagal: "bg-red-100 text-red-700",
	Dibatalkan: "bg-gray-200 text-gray-600",
};

const props = defineProps({
	modelValue: Boolean,
	warehouses: { type: Array, default: () => [] },
	defaultWarehouse: { type: String, default: "" },
});
const emit = defineEmits(["update:modelValue"]);

const show = ref(props.modelValue);
const warehouse = ref("");
const periodeDari = ref("");
const periodeSampai = ref("");
const fileUrl = ref("");
const fileInput = ref(null);
const preview = ref(null);
const previewing = ref(false);
const submitting = ref(false);
const error = ref("");
const uploads = ref([]);
const loadingList = ref(false);
const cancelling = ref("");
const brands = ref([]);
const formats = ref([]);
// null = not chosen yet; "" = tinta without a brand.
const brand = ref(null);
const format = ref(MANUAL);

const templateUrl = computed(
	() =>
		`/api/method/${METHOD}.download_template?warehouse=${encodeURIComponent(warehouse.value)}` +
		`&brand=${encodeURIComponent(brand.value ?? "")}`
);

watch(
	() => props.modelValue,
	(value) => {
		show.value = value;
		if (value) {
			warehouse.value = props.warehouses.includes(props.defaultWarehouse)
				? props.defaultWarehouse
				: props.warehouses[0] || "";
			resetUpload();
			loadUploads();
		}
	}
);
watch(show, (value) => emit("update:modelValue", value));
watch(warehouse, () => {
	resetUpload();
	loadUploads();
});
watch(format, () => resetUpload());
watch([brand, periodeDari, periodeSampai], () => {
	if (fileUrl.value && brand.value !== null) runPreview();
});

function brandLabel(name) {
	return name || __("(Tanpa Brand)");
}

function messageOf(err) {
	return err?.messages?.join("\n") || err?.message || String(err);
}

async function loadUploads() {
	if (!warehouse.value) return;
	loadingList.value = true;
	try {
		const [list, names, machines] = await Promise.all([
			call(`${METHOD}.list_uploads`, { warehouse: warehouse.value }),
			call(`${METHOD}.get_template_brands`, { warehouse: warehouse.value }),
			call(`${IMPORT}.get_formats`, { warehouse: warehouse.value }),
		]);
		uploads.value = list || [];
		brands.value = names || [];
		formats.value = machines || [];
		if (!formats.value.some((machine) => machine.name === format.value)) format.value = MANUAL;
		if (!brands.value.includes(brand.value)) brand.value = brands.value.length === 1 ? brands.value[0] : null;
	} catch (err) {
		error.value = messageOf(err);
	} finally {
		loadingList.value = false;
	}
}

function resetUpload() {
	fileUrl.value = "";
	preview.value = null;
	error.value = "";
	if (fileInput.value) fileInput.value.value = "";
}

async function uploadFile(file) {
	const form = new FormData();
	form.append("file", file, file.name);
	form.append("is_private", "1");
	const response = await fetch("/api/method/upload_file", {
		method: "POST",
		body: form,
		headers: { "X-Frappe-CSRF-Token": window.csrf_token || "" },
	});
	const data = await response.json();
	if (!response.ok) throw new Error(data?.exception || __("Upload gagal"));
	return data.message.file_url;
}

async function onFileChosen(event) {
	const file = event.target.files?.[0];
	preview.value = null;
	error.value = "";
	if (!file) return;
	if (format.value === MANUAL && (brand.value === null || !periodeDari.value || !periodeSampai.value)) {
		error.value = __("Pilih brand dan isi periode dulu sebelum memilih file.");
		event.target.value = "";
		return;
	}
	previewing.value = true;
	try {
		fileUrl.value = await uploadFile(file);
	} catch (err) {
		error.value = messageOf(err);
		previewing.value = false;
		return;
	}
	await runPreview();
}

async function runPreview() {
	previewing.value = true;
	error.value = "";
	try {
		preview.value =
			format.value === MANUAL
				? await call(`${METHOD}.preview_upload`, {
						warehouse: warehouse.value,
						brand: brand.value,
						periode_dari: periodeDari.value,
						periode_sampai: periodeSampai.value,
						file_url: fileUrl.value,
					})
				: await call(`${IMPORT}.preview`, {
						format_name: format.value,
						warehouse: warehouse.value,
						file_url: fileUrl.value,
					});
	} catch (err) {
		preview.value = null;
		error.value = messageOf(err);
	} finally {
		previewing.value = false;
	}
}

async function submitUpload() {
	submitting.value = true;
	try {
		if (format.value === MANUAL) {
			await call(`${METHOD}.submit_upload`, {
				warehouse: warehouse.value,
				brand: brand.value,
				periode_dari: periodeDari.value,
				periode_sampai: periodeSampai.value,
				file_url: fileUrl.value,
			});
		} else {
			await call(`${IMPORT}.submit`, {
				format_name: format.value,
				warehouse: warehouse.value,
				file_url: fileUrl.value,
			});
		}
		resetUpload();
		periodeDari.value = "";
		periodeSampai.value = "";
		await loadUploads();
	} catch (err) {
		error.value = messageOf(err);
	} finally {
		submitting.value = false;
	}
}

async function cancelUpload(name) {
	if (!window.confirm(__("Batalkan upload {0}? Periodenya bisa diupload ulang.", [name]))) return;
	cancelling.value = name;
	error.value = "";
	try {
		await call(`${METHOD}.cancel_upload`, { name });
		await loadUploads();
	} catch (err) {
		error.value = messageOf(err);
	} finally {
		cancelling.value = "";
	}
}
</script>
