<template>
	<Dialog v-model="show" :options="{ title: __('Pengeluaran Kas'), size: 'xl' }">
		<template #body-content>
			<div class="flex flex-col gap-3 text-start">
				<p v-if="offline" class="text-sm text-red-600">
					{{ __("Pengeluaran Kas hanya bisa dicatat saat online.") }}
				</p>
				<p v-else-if="!context.allowed && loaded" class="text-sm text-red-600">
					{{ __("Tidak ada shift kasir yang terbuka.") }}
				</p>

				<template v-else>
					<div class="grid grid-cols-2 gap-2">
						<label class="text-xs text-gray-600 flex flex-col gap-1">
							{{ __("Tanggal") }}
							<input
								v-model="form.posting_date"
								type="date"
								class="h-8 text-sm border border-gray-300 rounded px-2"
							/>
						</label>
						<label class="text-xs text-gray-600 flex flex-col gap-1">
							{{ __("Sumber Dana") }}
							<select
								v-model="form.sumber_dana"
								class="h-8 text-sm border border-gray-300 rounded px-2"
								:aria-label="__('Sumber Dana')"
							>
								<option v-for="s in context.sumber_dana" :key="s" :value="s">{{ s }}</option>
							</select>
						</label>
						<label class="text-xs text-gray-600 flex flex-col gap-1">
							{{ __("Metode Bayar") }}
							<select
								v-model="form.mode_of_payment"
								class="h-8 text-sm border border-gray-300 rounded px-2"
								:aria-label="__('Metode Bayar')"
							>
								<option value="" disabled>{{ __("Pilih metode") }}</option>
								<option v-for="m in modeOptions" :key="m" :value="m">{{ m }}</option>
							</select>
						</label>
						<label class="text-xs text-gray-600 flex flex-col gap-1">
							{{ __("Jenis Biaya") }}
							<select
								v-model="form.jenis"
								class="h-8 text-sm border border-gray-300 rounded px-2"
								:aria-label="__('Jenis Biaya')"
							>
								<option value="" disabled>{{ __("Pilih jenis") }}</option>
								<option v-for="j in context.jenis" :key="j" :value="j">{{ j }}</option>
							</select>
						</label>
						<label class="text-xs text-gray-600 flex flex-col gap-1">
							{{ __("Total") }}
							<input
								ref="totalInput"
								:value="totalShown"
								type="text"
								inputmode="numeric"
								autocomplete="off"
								class="h-8 text-sm border border-gray-300 rounded px-2 text-end"
								:aria-label="__('Total')"
								@input="onTotalInput"
							/>
						</label>
						<label class="text-xs text-gray-600 flex flex-col gap-1">
							{{ __("Penerima") }}
							<input
								v-model="form.penerima"
								type="text"
								class="h-8 text-sm border border-gray-300 rounded px-2"
								:aria-label="__('Penerima')"
							/>
						</label>
					</div>
					<label class="text-xs text-gray-600 flex flex-col gap-1">
						{{ __("Keterangan") }}
						<textarea
							v-model="form.keterangan"
							rows="2"
							class="text-sm border border-gray-300 rounded px-2 py-1"
							:aria-label="__('Keterangan')"
						/>
					</label>
					<label class="text-xs text-gray-600 flex flex-col gap-1">
						{{ __("Foto Bukti") }}
						<input
							ref="fileInput"
							type="file"
							accept="image/*"
							capture="environment"
							class="text-sm"
							@change="onFileChosen"
						/>
					</label>

					<p v-if="context.sisa_shift !== null && context.sisa_shift !== undefined" class="text-xs text-gray-600">
						{{ __("Sisa batas shift: {0}", [formatNumber(context.sisa_shift)]) }}
					</p>
					<p v-if="context.batas_per_transaksi" class="text-xs text-gray-600">
						{{ __("Batas per transaksi: {0}", [formatNumber(context.batas_per_transaksi)]) }}
					</p>
					<p v-if="error" class="text-sm text-red-600 whitespace-pre-line">{{ error }}</p>

					<div class="flex justify-end gap-2">
						<Button variant="subtle" @click="show = false">{{ __("Batal") }}</Button>
						<Button
							theme="blue"
							variant="solid"
							:disabled="!canSave"
							:loading="saving"
							@click="save"
						>
							{{ __("Simpan & Minta Persetujuan") }}
						</Button>
					</div>

					<div class="flex flex-col gap-1">
						<div class="text-sm font-semibold text-gray-900">{{ __("Pengeluaran Shift Ini") }}</div>
						<div v-if="!history.rows.length" class="text-sm text-gray-500">
							{{ __("Belum ada pengeluaran dari laci.") }}
						</div>
						<div
							v-for="row in history.rows"
							:key="row.name"
							class="flex justify-between gap-2 text-xs border-b border-gray-100 py-1"
						>
							<span>{{ row.jenis }} · {{ row.penerima }}</span>
							<span class="font-medium">{{ formatNumber(row.total) }}</span>
						</div>
					</div>
				</template>
			</div>
		</template>
	</Dialog>
</template>

<script setup>
import { useAuthorization } from "@/composables/useAuthorization";
import { call } from "@/utils/apiWrapper";
import { Button, Dialog } from "frappe-ui";
import { computed, reactive, ref, watch } from "vue";

const METHOD = "nextend.pengeluaran_kas";
const ACTION = "Cash Expense";

const props = defineProps({
	modelValue: Boolean,
	offline: { type: Boolean, default: false },
});
const emit = defineEmits(["update:modelValue", "saved"]);

const { requireAuthorization, isAuthorizationRequired } = useAuthorization();

const show = ref(props.modelValue);
const context = ref({ allowed: false, sumber_dana: [], mode_of_payment: [], jenis: [], cash_mode: "" });
const loaded = ref(false);
const history = ref({ rows: [] });
const fileInput = ref(null);
const totalInput = ref(null);
const saving = ref(false);
const uploading = ref(false);
const error = ref("");

const form = reactive(emptyForm());

function emptyForm() {
	return {
		posting_date: new Date().toISOString().slice(0, 10),
		sumber_dana: "Laci Kasir",
		mode_of_payment: "",
		jenis: "",
		total: null,
		penerima: "",
		keterangan: "",
		bukti: "",
	};
}

const modeOptions = computed(() => {
	const modes = context.value.mode_of_payment || [];
	const cash = context.value.cash_mode;
	if (!cash) return modes;
	return form.sumber_dana === "Non-Tunai" ? modes.filter((m) => m !== cash) : modes.filter((m) => m === cash);
});

watch(
	() => form.sumber_dana,
	() => {
		if (!modeOptions.value.includes(form.mode_of_payment)) {
			form.mode_of_payment = modeOptions.value.length === 1 ? modeOptions.value[0] : "";
		}
	}
);

const canSave = computed(
	() =>
		!props.offline &&
		!uploading.value &&
		context.value.allowed &&
		form.mode_of_payment &&
		form.jenis &&
		Number(form.total) > 0 &&
		form.penerima.trim() &&
		form.keterangan.trim() &&
		form.bukti
);

watch(
	() => props.modelValue,
	(value) => {
		show.value = value;
		if (value) open();
	}
);
watch(show, (value) => emit("update:modelValue", value));

const nf = new Intl.NumberFormat("id-ID");
// Batas aman Number: lebih dari ini angkanya mulai dibulatkan sendiri.
const MAX_DIGITS = 15;

function formatNumber(value) {
	return nf.format(Number(value) || 0);
}

const totalShown = computed(() => (form.total == null ? "" : nf.format(form.total)));

function onTotalInput(event) {
	const input = event.target;
	const before = input.value.slice(0, input.selectionStart).replace(/\D/g, "").length;
	const digits = input.value.replace(/\D/g, "").slice(0, MAX_DIGITS);
	const text = digits ? nf.format(Number(digits)) : "";
	input.value = text;
	putCaret(input, text, before);
	form.total = digits ? Number(digits) : null;
}

function putCaret(input, text, digitsBefore) {
	let at = 0;
	let seen = 0;
	while (seen < digitsBefore && at < text.length) {
		if (text[at] >= "0" && text[at] <= "9") seen += 1;
		at += 1;
	}
	input.setSelectionRange(at, at);
}

function messageOf(err) {
	return err?.messages?.join("\n") || err?.message || String(err);
}

async function open() {
	Object.assign(form, emptyForm());
	error.value = "";
	if (fileInput.value) fileInput.value.value = "";
	if (props.offline) return;
	await refresh();
}

async function refresh() {
	try {
		context.value = (await call(`${METHOD}.get_context`)) || { allowed: false };
		if (modeOptions.value.length === 1) form.mode_of_payment = modeOptions.value[0];
		if (context.value.allowed) {
			history.value = await call(`${METHOD}.shift_expenses`, {
				pos_opening_shift: context.value.pos_opening_shift,
			});
		}
	} catch (err) {
		context.value = { allowed: false };
		error.value = messageOf(err);
	} finally {
		loaded.value = true;
	}
}

async function uploadFile(file) {
	const body = new FormData();
	body.append("file", file, file.name);
	body.append("is_private", "0");
	const response = await fetch("/api/method/upload_file", {
		method: "POST",
		body,
		headers: { "X-Frappe-CSRF-Token": window.csrf_token || "" },
	});
	const data = await response.json();
	if (!response.ok) throw new Error(data?.exception || __("Upload gagal"));
	return data.message.file_url;
}

async function onFileChosen(event) {
	const file = event.target.files?.[0];
	form.bukti = "";
	if (!file) return;
	uploading.value = true;
	try {
		form.bukti = await uploadFile(file);
	} catch (err) {
		error.value = messageOf(err);
	} finally {
		uploading.value = false;
	}
}

async function save() {
	error.value = "";
	// authorization_policy ikut payload bootstrap: sesi POS yang dibuka sebelum POS
	// Authorization Rule dibuat tidak akan memunculkan dialog PIN, dan server pasti
	// menolak simpanan tanpa PIN. Lebih baik bilang "muat ulang" daripada gagal submit.
	if (context.value.butuh_pin && !isAuthorizationRequired(ACTION)) {
		error.value = __("Dialog PIN belum aktif di sesi POS ini. Muat ulang halaman POS, lalu coba lagi.");
		return;
	}
	saving.value = true;
	try {
		// PIN kepala toko dulu; tanpa grant tidak ada yang dikirim ke server.
		const grant = await requireAuthorization(ACTION, {
			pos_profile: context.value.pos_profile,
			amount: Number(form.total),
		});
		if (!grant) return;
		await call(`${METHOD}.create`, {
			payload: JSON.stringify({ ...form, pos_opening_shift: context.value.pos_opening_shift }),
			token: grant.grant_token,
		});
		emit("saved");
		Object.assign(form, emptyForm());
		if (fileInput.value) fileInput.value.value = "";
		await refresh();
	} catch (err) {
		error.value = messageOf(err);
	} finally {
		saving.value = false;
	}
}
</script>
