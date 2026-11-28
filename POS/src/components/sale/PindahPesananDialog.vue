<template>
	<Dialog v-model="show" :options="{ title: __('Ajukan Pindah Pesanan'), size: '4xl' }">
		<template #body-content>
			<div class="flex flex-col gap-3 text-start">
				<p class="text-xs text-gray-600">
					{{
						__(
							"Barang yang sebelumnya masuk company utama karena stok kurang. Centang qty yang kini sudah tersedia di company lain, lalu ajukan ke kepala toko."
						)
					}}
				</p>
				<p
					v-if="error"
					class="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5"
				>
					{{ error }}
				</p>
				<div v-if="loading" class="text-xs text-gray-500">{{ __("Memuat usulan…") }}</div>
				<p v-else-if="!rows.length" class="text-xs text-gray-500">
					{{ __("Tidak ada barang yang bisa dipindah untuk grup ini.") }}
				</p>
				<table v-else class="w-full text-xs">
					<thead class="text-gray-500 border-b border-gray-200">
						<tr>
							<th class="text-start py-1">{{ __("Barang") }}</th>
							<th class="text-start py-1">{{ __("Dari SO") }}</th>
							<th class="text-start py-1">{{ __("Ke SO") }}</th>
							<th class="text-end py-1">{{ __("Qty") }}</th>
							<th class="text-end py-1"></th>
						</tr>
					</thead>
					<tbody>
						<tr
							v-for="row in rows"
							:key="barisKunci(row)"
							class="border-b border-gray-100"
						>
							<td class="py-2 font-medium">{{ row.item_code }}</td>
							<td class="py-2 font-mono">{{ row.dari_so }}</td>
							<td class="py-2 font-mono">{{ row.ke_so }}</td>
							<td class="py-2 text-end">
								<input
									v-model.number="qty[rowKey(row)]"
									type="number"
									min="0.01"
									:max="row.qty"
									step="0.01"
									class="h-8 w-20 border border-gray-300 rounded px-2 text-end"
								/>
							</td>
							<td class="py-2 text-end">
								<Button
									variant="subtle"
									:disabled="saving || Number(qty[rowKey(row)]) <= 0"
									:loading="saving && mengirim === rowKey(row)"
									@click="ajukan(row)"
								>
									{{ __("Ajukan pindah") }}
								</Button>
							</td>
						</tr>
					</tbody>
				</table>
			</div>
		</template>
	</Dialog>
</template>

<script setup>
import { call } from "@/utils/apiWrapper";
import { useToast } from "@/composables/useToast";
import { Button, Dialog } from "frappe-ui";
import { computed, reactive, ref, watch } from "vue";

const METHOD = "nextend.penjualan_grup.pindah";

const props = defineProps({
	modelValue: Boolean,
	kodeGrup: { type: String, default: "" },
});
const emit = defineEmits(["update:modelValue", "submitted"]);
const show = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});
const { showError, showSuccess } = useToast();

const rows = ref([]);
const qty = reactive({});
const error = ref("");
const loading = ref(false);
const saving = ref(false);
const mengirim = ref("");

const rowKey = (row) => `${row.dari_so}:${row.ke_so}:${row.item_code}`;
const barisKunci = rowKey;

watch(show, (open) => {
	if (open) muat();
});

async function muat() {
	error.value = "";
	rows.value = [];
	loading.value = true;
	try {
		rows.value = (await call(`${METHOD}.usulan_pindah`, { kode_grup: props.kodeGrup })) || [];
		for (const row of rows.value) qty[rowKey(row)] = Number(row.qty);
	} catch (err) {
		error.value = err.message || __("Usulan pindah tidak dapat dimuat.");
		showError(error.value);
	} finally {
		loading.value = false;
	}
}

async function ajukan(row) {
	const key = rowKey(row);
	const jumlah = Number(qty[key]);
	if (saving.value || !(jumlah > 0)) return;
	saving.value = true;
	mengirim.value = key;
	error.value = "";
	try {
		await call(`${METHOD}.ajukan`, {
			kode_grup: props.kodeGrup,
			item_code: row.item_code,
			qty: jumlah,
			dari_so: row.dari_so,
			ke_so: row.ke_so,
		});
		showSuccess(__("Usulan pindah dikirim ke kepala toko."));
		emit("submitted");
		show.value = false;
	} catch (err) {
		error.value = err.message || __("Usulan pindah gagal dikirim.");
		showError(error.value);
	} finally {
		saving.value = false;
		mengirim.value = "";
	}
}
</script>
