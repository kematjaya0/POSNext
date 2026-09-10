<template>
	<div v-if="showList" class="mb-4">
		<label class="block text-sm font-medium text-gray-700 mb-2 text-start">
			{{ __("Warehouse") }}
			<span v-if="uom" class="font-normal text-gray-400">{{
				__("(stock in {0})", [uom])
			}}</span>
		</label>
		<div class="flex flex-col gap-2">
			<button
				v-for="row in warehouses"
				:key="row.warehouse"
				type="button"
				@click="select(row)"
				:class="[
					'rounded-xl px-3 py-2.5 flex items-center justify-between gap-2.5 text-start transition-colors touch-manipulation',
					row.warehouse === modelValue
						? 'bg-blue-600 text-white shadow-lg ring-2 ring-blue-300'
						: 'bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300',
				]"
			>
				<div class="flex items-center gap-2 min-w-0">
					<span
						class="w-4 h-4 rounded-full border-2 flex-shrink-0"
						:class="
							row.warehouse === modelValue
								? 'border-white bg-white'
								: 'border-gray-300'
						"
					/>
					<span class="font-semibold text-sm truncate">{{ row.warehouse_name }}</span>
					<span
						v-if="row.company_abbr"
						class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0"
						:class="
							row.warehouse === modelValue
								? 'bg-white/25'
								: 'bg-blue-100 text-blue-700'
						"
					>
						{{ row.company_abbr }}
					</span>
					<span
						v-if="row.is_own"
						class="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
						:class="
							row.warehouse === modelValue
								? 'bg-white text-green-700'
								: 'bg-green-100 text-green-700'
						"
					>
						{{ __("Your Branch") }}
					</span>
				</div>
				<span
					class="text-sm font-bold flex-shrink-0"
					:class="
						row.stock_qty <= 0
							? row.warehouse === modelValue
								? 'text-red-100'
								: 'text-red-600'
							: ''
					"
				>
					{{ formatQty(row.stock_qty) }}{{ uom ? " " + uom : "" }}
				</span>
			</button>
		</div>
		<p
			v-if="selectedCrossCompany"
			class="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg p-2 mt-2 flex items-center gap-1.5"
		>
			<svg
				class="w-4 h-4 flex-shrink-0"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
				/>
			</svg>
			{{
				__(
					"Different company from your session ({0}) - this sale will split into 2 receipts.",
					[selectedCrossCompany.company]
				)
			}}
		</p>
	</div>
</template>

<script setup>
/**
 * Warehouse + stock picker for the item add/edit dialogs.
 *
 * Reused by ItemSelectionDialog (mode 'uom') and EditItemDialog - a single
 * source of truth for "which warehouse, with what stock, should this cart
 * row come from". POS Settings' own warehouse picker is unrelated to this
 * component and always stays locked to POS Profile.warehouse.
 *
 * Self-hiding: renders nothing when the cashier has no more than one
 * candidate warehouse (no nextend Warehouse Group, or item only exists in
 * one place) - falls back to today's single-warehouse behavior.
 */
import { call } from "@/utils/apiWrapper";
import { computed, ref, watch } from "vue";

const props = defineProps({
	itemCode: { type: String, default: "" },
	uom: { type: String, default: "" },
	posProfile: { type: String, default: "" },
	modelValue: { type: String, default: "" },
});

const emit = defineEmits(["update:modelValue", "warehouse-stock"]);

const warehouses = ref([]);
const loading = ref(false);

const showList = computed(() => warehouses.value.length > 1);

const selectedRow = computed(
	() => warehouses.value.find((w) => w.warehouse === props.modelValue) || null
);

const selectedCrossCompany = computed(() =>
	selectedRow.value && !selectedRow.value.is_native_company ? selectedRow.value : null
);

watch(selectedRow, (row) => emit("warehouse-stock", row), { immediate: true });

function formatQty(qty) {
	const num = Number(qty) || 0;
	return num % 1 === 0 ? String(num) : num.toFixed(2);
}

function select(row) {
	emit("update:modelValue", row.warehouse);
}

async function load() {
	if (!props.itemCode || !props.posProfile) {
		warehouses.value = [];
		return;
	}

	loading.value = true;
	try {
		const response = await call("pos_next.api.items.get_item_warehouse_stock", {
			item_code: props.itemCode,
			uom: props.uom,
			pos_profile: props.posProfile,
		});
		warehouses.value = response || [];

		const hasCurrentSelection = warehouses.value.some((w) => w.warehouse === props.modelValue);
		if (!hasCurrentSelection && warehouses.value.length > 0) {
			emit("update:modelValue", warehouses.value[0].warehouse);
		}
	} catch (err) {
		console.error("Error loading warehouse stock:", err);
		warehouses.value = [];
	} finally {
		loading.value = false;
	}
}

watch(
	() => [props.itemCode, props.uom, props.posProfile],
	() => load(),
	{ immediate: true }
);

defineExpose({ warehouses, load });
</script>
