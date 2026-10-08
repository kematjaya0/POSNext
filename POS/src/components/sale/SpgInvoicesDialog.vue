<template>
	<Dialog v-model="show" :options="{ title: __('Invoice History'), size: 'lg' }">
		<template #body-content>
			<div class="flex flex-col gap-3">
				<div class="flex items-center gap-2">
					<Input v-model="date" type="date" class="flex-1" />
					<Button variant="subtle" :loading="loading" @click="loadInvoices">
						{{ __("Refresh") }}
					</Button>
				</div>

				<div class="bg-teal-50 border border-teal-200 rounded-lg p-3">
					<div class="text-xs text-teal-700">
						{{ __("Omset netto (tanpa pajak, setelah retur)") }}
					</div>
					<div class="text-lg font-semibold text-gray-900">
						{{ formatCurrency(netTotal, currency) }}
					</div>
					<div class="text-xs text-gray-500">
						{{ __("{0} invoice", [invoices.length]) }}
					</div>
				</div>

				<div v-if="loading" class="text-center py-6 text-sm text-gray-500">
					{{ __("Memuat invoice...") }}
				</div>

				<div v-else-if="!salesPerson" class="text-center py-6 text-sm text-gray-500">
					{{ __("User ini belum terhubung ke Sales Person") }}
				</div>

				<div
					v-else-if="invoices.length === 0"
					class="text-center py-6 text-sm text-gray-500"
				>
					{{ __("Belum ada invoice di tanggal ini") }}
				</div>

				<div v-else class="flex flex-col gap-2 max-h-96 overflow-y-auto">
					<div
						v-for="invoice in invoices"
						:key="invoice.name"
						class="bg-white border border-gray-200 rounded-lg p-3 flex items-start justify-between gap-2"
					>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="text-sm font-semibold text-gray-900">
									{{ invoice.name }}
								</span>
								<span
									v-if="invoice.is_return"
									class="text-[10px] font-semibold bg-red-100 text-red-700 px-1.5 py-0.5 rounded"
								>
									{{ __("Retur") }}
								</span>
							</div>
							<div class="text-xs text-gray-500 mt-0.5">
								{{ invoice.customer_name }} ·
								{{ String(invoice.posting_time || "").slice(0, 5) }}
								<template v-if="invoice.custom_pos_order">
									· {{ invoice.custom_pos_order }}
								</template>
							</div>
							<div class="text-xs text-gray-400 mt-0.5">{{ invoice.company }}</div>
						</div>
						<div class="flex flex-col items-end gap-1 shrink-0">
							<span class="text-sm font-semibold text-gray-900">
								{{ formatCurrency(invoice.grand_total, currency) }}
							</span>
							<Button size="sm" @click="emit('view-invoice', invoice)">
								{{ __("Lihat") }}
							</Button>
						</div>
					</div>
				</div>
			</div>
		</template>
	</Dialog>
</template>

<script setup>
import { useToast } from "@/composables/useToast";
import { call } from "@/utils/apiWrapper";
import { DEFAULT_CURRENCY, formatCurrency } from "@/utils/currency";
import { Button, Dialog, Input } from "frappe-ui";
import { computed, ref, watch } from "vue";

const props = defineProps({
	modelValue: Boolean,
	currency: {
		type: String,
		default: DEFAULT_CURRENCY,
	},
});

const emit = defineEmits(["update:modelValue", "view-invoice"]);

const { showError } = useToast();

const show = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});

function today() {
	const now = new Date();
	now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
	return now.toISOString().slice(0, 10);
}

const date = ref(today());
const invoices = ref([]);
const netTotal = ref(0);
const salesPerson = ref(true);
const loading = ref(false);

async function loadInvoices() {
	loading.value = true;
	try {
		const result = await call("nextend.pos_order.get_my_invoices", { date: date.value });
		invoices.value = result?.invoices || [];
		netTotal.value = result?.net_total || 0;
		salesPerson.value = Boolean(result?.sales_person);
	} catch (error) {
		showError(error?.messages?.[0] || error?.message || __("Gagal memuat invoice"));
	} finally {
		loading.value = false;
	}
}

watch(show, (value) => {
	if (!value) return;
	const day = today();
	// A changed date reloads through the watcher below
	if (date.value !== day) date.value = day;
	else loadInvoices();
});

watch(date, () => {
	if (show.value && date.value) loadInvoices();
});
</script>
