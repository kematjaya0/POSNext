<template>
	<div v-if="showList" class="mb-4">
		<label class="block text-sm font-medium text-gray-700 mb-2 text-start">
			{{ __("Warehouse") }}
			<span v-if="uom" class="font-normal text-gray-400">{{
				__("(stock in {0})", [uom])
			}}</span>
		</label>
		<template v-for="section in sections" :key="section.key">
			<div
				v-if="section.key === 'outside'"
				class="flex items-baseline justify-between gap-2 mt-3 mb-1.5"
			>
				<span class="text-xs font-semibold text-gray-600">{{
					__("Other Warehouses")
				}}</span>
				<span
					class="text-[11px]"
					:class="outsideAllowed ? 'text-orange-600' : 'text-gray-400'"
				>
					{{
						outsideAllowed
							? __("Branch stock is short - pick up from the warehouse")
							: __("Only when branch stock is short ({0})", [formatQty(branchStock)])
					}}
				</span>
			</div>
			<div class="flex flex-col gap-2">
				<button
					v-for="row in section.rows"
					:key="row.warehouse"
					type="button"
					:disabled="isDisabled(row)"
					@click="select(row)"
					:class="[
						'rounded-xl px-3 py-2.5 flex items-center justify-between gap-2.5 text-start transition-colors touch-manipulation',
						row.warehouse === modelValue
							? 'bg-blue-600 text-white shadow-lg ring-2 ring-blue-300'
							: isDisabled(row)
							? 'bg-gray-50 text-gray-400 cursor-not-allowed'
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
						<span class="font-semibold text-sm truncate">{{
							row.warehouse_name
						}}</span>
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
		</template>
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
 * Rows come in session tiers (pos_next.api.items.get_session_scope): the
 * branch (native warehouse + rest of its Warehouse Group) first, then the
 * branch companies' other warehouses - only selectable while the branch's
 * total stock is below `qty`.
 *
 * `autoSelect` (add dialog): the selection follows the tier rule
 * (pickSessionWarehouse) for the current `qty` until the cashier picks a row
 * by hand. Without it (edit dialog) the row's own warehouse is kept.
 *
 * Self-hiding: renders nothing when the cashier has no more than one
 * candidate warehouse (no nextend Warehouse Group) - falls back to today's
 * single-warehouse behavior.
 */
import { call } from "@/utils/apiWrapper";
import { pickSessionWarehouse } from "@/utils/stockValidator";
import { computed, ref, watch } from "vue";

const props = defineProps({
	itemCode: { type: String, default: "" },
	uom: { type: String, default: "" },
	posProfile: { type: String, default: "" },
	modelValue: { type: String, default: "" },
	// Requested quantity in `uom` - gates the "outside" tier
	qty: { type: Number, default: 0 },
	autoSelect: { type: Boolean, default: false },
});

const emit = defineEmits(["update:modelValue", "warehouse-stock", "picked-by-hand"]);

const warehouses = ref([]);
const loading = ref(false);
const pickedByHand = ref(false);
watch(pickedByHand, (value) => emit("picked-by-hand", value), { immediate: true });

const showList = computed(() => warehouses.value.length > 1);

const sections = computed(() =>
	[
		{ key: "branch", rows: warehouses.value.filter((w) => w.tier !== "outside") },
		{ key: "outside", rows: warehouses.value.filter((w) => w.tier === "outside") },
	].filter((section) => section.rows.length)
);

const branchStock = computed(() =>
	warehouses.value
		.filter((w) => w.tier !== "outside")
		.reduce((sum, w) => sum + (Number(w.stock_qty) || 0), 0)
);

const outsideAllowed = computed(() => branchStock.value < props.qty);

const isDisabled = (row) => row.tier === "outside" && !outsideAllowed.value;

const selectedRow = computed(
	() => warehouses.value.find((w) => w.warehouse === props.modelValue) || null
);

const selectedCrossCompany = computed(() =>
	selectedRow.value && !selectedRow.value.is_native_company ? selectedRow.value : null
);

watch(selectedRow, (row) => emit("warehouse-stock", row), { immediate: true });

function autoSelect() {
	if (!props.autoSelect || pickedByHand.value) return;
	const warehouse = pickSessionWarehouse(warehouses.value, props.qty);
	if (warehouse && warehouse !== props.modelValue) emit("update:modelValue", warehouse);
}

watch(() => props.qty, autoSelect);

// Qty went back within branch stock: an outside pick is no longer allowed
watch(outsideAllowed, (allowed) => {
	if (!allowed && selectedRow.value?.tier === "outside" && warehouses.value.length) {
		emit("update:modelValue", warehouses.value[0].warehouse);
	}
});

function formatQty(qty) {
	const num = Number(qty) || 0;
	return num % 1 === 0 ? String(num) : num.toFixed(2);
}

function select(row) {
	if (isDisabled(row)) return;
	pickedByHand.value = true;
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
		autoSelect();
	} catch (err) {
		console.error("Error loading warehouse stock:", err);
		warehouses.value = [];
	} finally {
		loading.value = false;
	}
}

watch(
	() => [props.itemCode, props.uom, props.posProfile],
	([itemCode], previous) => {
		if (itemCode !== previous?.[0]) pickedByHand.value = false;
		load();
	},
	{ immediate: true }
);

defineExpose({ warehouses, load });
</script>
