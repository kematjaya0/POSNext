<template>
	<Dialog v-model="show" :options="{ title: __('Ambil Pesanan'), size: '4xl' }">
		<template #body-content>
			<div class="flex flex-col gap-3 text-start">
				<p class="text-xs text-gray-600">
					{{
						__(
							"Masukkan atau pindai kode grup pesanan. Kasir menagih sisa pesanan PT dan CV sekaligus; uang muka sudah dikurangi otomatis."
						)
					}}
				</p>

				<!-- Selesai -->
				<div
					v-if="hasil"
					class="rounded-lg bg-green-50 border border-green-200 p-3 flex flex-col gap-2"
				>
					<div class="text-sm font-semibold text-green-800">
						{{ __("Nota untuk grup {0} sudah dibuat.", [hasil.kode_grup]) }}
					</div>
					<div v-if="Number(hasil.change_amount) > 0" class="text-sm text-green-800">
						{{ __("Kembalian {0}", [formatCurrency(hasil.change_amount)]) }}
					</div>
					<div class="flex flex-wrap gap-2">
						<Button
							v-for="invoice in hasil.invoices"
							:key="invoice.name"
							variant="subtle"
							@click="emit('print-invoice', invoice.name)"
						>
							{{ __("Cetak {0}", [invoice.name]) }}
						</Button>
						<Button variant="solid" @click="reset">{{
							__("Ambil pesanan lain")
						}}</Button>
					</div>
				</div>

				<template v-else>
					<!-- Kode grup -->
					<div class="flex flex-col gap-1">
						<label class="text-xs font-semibold text-gray-700" for="ap-kode">
							{{ __("Kode grup pesanan") }}
						</label>
						<div class="flex gap-2">
							<input
								id="ap-kode"
								v-model="kode"
								type="text"
								class="h-10 flex-1 text-sm border border-gray-300 rounded px-3 font-mono"
								:placeholder="__('Contoh: SOG5-ABC123')"
								:disabled="loading"
								@keyup.enter="cari"
							/>
							<Button
								variant="solid"
								:loading="loading"
								:disabled="!kode.trim() || loading"
								@click="cari"
							>
								{{ __("Cari") }}
							</Button>
						</div>
						<p
							v-if="error"
							class="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5"
						>
							{{ error }}
						</p>
					</div>

					<!-- Pesanan dalam grup -->
					<template v-if="grup">
						<div
							class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 rounded bg-gray-50 border border-gray-200 px-3 py-2"
						>
							<span
								>{{ __("Customer") }}:
								<b class="text-gray-900">{{ customer }}</b></span
							>
							<span
								>{{ __("Total sisa") }}:
								<b class="text-gray-900">{{ formatCurrency(totalSisa) }}</b></span
							>
							<span
								>{{ __("Sudah uang muka") }}:
								<b class="text-gray-900">{{
									formatCurrency(totalUangMuka)
								}}</b></span
							>
						</div>

						<section
							v-for="order in grup.orders"
							:key="order.name"
							class="rounded-lg border border-gray-200 p-3 flex flex-col gap-2"
						>
							<div class="flex flex-wrap items-center justify-between gap-2">
								<div class="flex flex-wrap items-center gap-2">
									<span class="font-mono text-sm font-semibold">{{
										order.name
									}}</span>
									<span
										class="text-[11px] font-bold rounded-full px-2 bg-gray-100 text-gray-700"
										>{{ order.company }}</span
									>
								</div>
								<span class="text-sm font-semibold">
									{{ __("Sisa {0}", [formatCurrency(order.sisa)]) }}
								</span>
							</div>
							<table class="w-full text-xs">
								<thead class="text-gray-500 border-b border-gray-200">
									<tr>
										<th class="text-start py-1">{{ __("Barang") }}</th>
										<th class="text-end py-1">{{ __("Qty") }}</th>
										<th class="text-end py-1">{{ __("Harga") }}</th>
									</tr>
								</thead>
								<tbody>
									<tr
										v-for="item in order.items"
										:key="item.so_detail"
										class="border-b border-gray-100 last:border-0"
									>
										<td class="py-1">
											{{ item.item_name || item.item_code }}
										</td>
										<td class="text-end py-1">{{ item.sisa_qty }}</td>
										<td class="text-end py-1">
											{{ formatCurrency(item.rate) }}
										</td>
									</tr>
								</tbody>
							</table>
							<p class="text-[11px] text-gray-500">
								{{
									__("Total {0} · uang muka {1}", [
										formatCurrency(order.total),
										formatCurrency(order.uang_muka),
									])
								}}
							</p>
						</section>

						<div class="flex flex-wrap gap-2">
							<Button variant="subtle" size="lg" @click="showPindah = true">
								{{ __("Ajukan pindah") }}
							</Button>
							<Button
								variant="solid"
								size="lg"
								:loading="saving"
								@click="showPayment = true"
							>
								{{ __("Bayar") }}
							</Button>
						</div>
					</template>
				</template>
			</div>
		</template>
	</Dialog>

	<!-- Dialog bayar POS yang sama dipakai untuk melunasi sisa pesanan grup. -->
	<PaymentDialog
		v-model="showPayment"
		:grand-total="totalSisa"
		:subtotal="totalSisa"
		:pos-profile="posProfile"
		:currency="currency"
		:customer="customer"
		:company="firstCompany"
		:items="paymentItems"
		:target-doctype="'Sales Invoice'"
		:allow-partial-payment="false"
		:allow-credit-sale="false"
		:allow-delivery="false"
		:allow-customer-credit-payment="false"
		:allow-write-off="false"
		@payment-completed="bayar"
	/>

	<PindahPesananDialog
		v-model="showPindah"
		:kode-grup="grup?.kode_grup || kode"
		@submitted="cari"
	/>
</template>

<script setup>
import { call } from "@/utils/apiWrapper";
import { formatCurrency as formatCurrencyUtil } from "@/utils/currency";
import { useToast } from "@/composables/useToast";
import { Button, Dialog } from "frappe-ui";
import { computed, ref, watch } from "vue";
import PaymentDialog from "@/components/sale/PaymentDialog.vue";
import PindahPesananDialog from "@/components/sale/PindahPesananDialog.vue";

const METHOD = "nextend.penjualan_grup.api";

const props = defineProps({
	modelValue: Boolean,
	posProfile: { type: String, default: "" },
	currency: { type: String, default: "IDR" },
});
const emit = defineEmits(["update:modelValue", "print-invoice"]);
const show = computed({
	get: () => props.modelValue,
	set: (v) => emit("update:modelValue", v),
});
const { showError, showSuccess } = useToast();

const kode = ref("");
const grup = ref(null);
const hasil = ref(null);
const error = ref("");
const loading = ref(false);
const saving = ref(false);
const showPayment = ref(false);
const showPindah = ref(false);

const formatCurrency = (value) => formatCurrencyUtil(Number(value || 0), props.currency);
const orders = computed(() => grup.value?.orders || []);
const customer = computed(() => orders.value[0]?.customer || null);
const firstCompany = computed(() => orders.value[0]?.company || "");
const totalSisa = computed(() =>
	orders.value.reduce((sum, order) => sum + Number(order.sisa || 0), 0)
);
const totalUangMuka = computed(() =>
	orders.value.reduce((sum, order) => sum + Number(order.uang_muka || 0), 0)
);
const paymentItems = computed(() =>
	orders.value.flatMap((order) =>
		order.items.map((item) => ({
			item_code: item.item_code,
			item_name: item.item_name,
			qty: item.sisa_qty,
			rate: item.rate,
			warehouse: item.warehouse,
		}))
	)
);

watch(show, (open) => {
	if (!open) return;
	reset();
});

function reset() {
	kode.value = "";
	grup.value = null;
	hasil.value = null;
	error.value = "";
	loading.value = false;
	saving.value = false;
	showPayment.value = false;
	showPindah.value = false;
}

async function cari() {
	const kodeGrup = kode.value.trim();
	if (!kodeGrup || loading.value) return;
	loading.value = true;
	error.value = "";
	grup.value = null;
	try {
		grup.value = await call(`${METHOD}.get_pesanan_grup`, { kode_grup: kodeGrup });
	} catch (err) {
		error.value = err.message || __("Kode grup tidak ditemukan.");
		showError(error.value);
	} finally {
		loading.value = false;
	}
}

async function bayar(paymentData) {
	if (!grup.value || saving.value) return;
	const payments = (paymentData?.payments || []).filter((row) => Number(row.amount) > 0);
	if (!payments.length) {
		error.value = __("Pilih metode bayar dulu.");
		showError(error.value);
		return;
	}
	saving.value = true;
	error.value = "";
	try {
		hasil.value = await call(`${METHOD}.buat_nota_dari_grup`, {
			kode_grup: grup.value.kode_grup,
			payments,
			pos_profile: props.posProfile,
		});
		showPayment.value = false;
		showSuccess(__("Nota pesanan grup tersimpan."));
	} catch (err) {
		error.value = err.message || __("Nota pesanan grup gagal dibuat.");
		showError(error.value);
	} finally {
		saving.value = false;
	}
}
</script>
