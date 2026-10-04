<template>
	<Dialog v-model="show" :options="{ title: __('Add On'), size: 'lg' }">
		<template #body-content>
			<div v-if="item" class="flex flex-col gap-3">
				<div class="text-sm text-gray-700 text-start">
					<span class="font-bold">{{ item.item_name }}</span>
					<span class="text-gray-500"> · {{ item.warehouse }}</span>
				</div>

				<Input
					v-model="search"
					type="text"
					:placeholder="__('Search add on...')"
					class="w-full"
				/>

				<div
					v-if="filteredRows.length"
					class="max-h-80 overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100"
				>
					<label
						v-for="row in filteredRows"
						:key="row.item_code"
						class="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-gray-50"
					>
						<input v-model="row.selected" type="checkbox" class="h-4 w-4" />
						<span class="flex-1 min-w-0 text-sm text-start truncate">
							{{ row.item_name }}
							<span class="text-xs text-gray-400">{{ row.item_code }}</span>
						</span>
						<input
							v-model="row.amount"
							type="number"
							min="0"
							inputmode="decimal"
							:disabled="!row.selected"
							:aria-label="__('Add on price')"
							class="w-28 h-8 text-end text-sm border border-gray-300 rounded px-2 disabled:bg-gray-100"
							@click.stop
						/>
					</label>
				</div>
				<p v-else class="text-sm text-gray-500 text-start">
					{{ __("No add on available for this item in this warehouse.") }}
				</p>

				<div class="flex items-center justify-between text-sm">
					<span class="text-gray-600">{{ __("Add on total") }}</span>
					<span class="font-bold">{{ formatCurrency(selectedTotal) }}</span>
				</div>
			</div>
		</template>
		<template #actions>
			<div class="flex justify-end gap-2">
				<Button variant="subtle" @click="show = false">{{ __("Cancel") }}</Button>
				<Button theme="blue" variant="solid" @click="save">{{ __("Save") }}</Button>
			</div>
		</template>
	</Dialog>
</template>

<script setup>
import { formatCurrency as formatCurrencyUtil } from "@/utils/currency";
import { getAvailableAddons } from "@/utils/itemAddons";
import { Button, Dialog, Input } from "frappe-ui";
import { computed, ref, watch } from "vue";

const props = defineProps({
	modelValue: Boolean,
	item: { type: Object, default: null },
	currency: { type: String, default: "" },
});

const emit = defineEmits(["update:modelValue", "save"]);

const show = ref(props.modelValue);
const search = ref("");
const rows = ref([]);

watch(
	() => props.modelValue,
	(value) => {
		show.value = value;
		if (value) loadRows();
	}
);
watch(show, (value) => emit("update:modelValue", value));

function loadRows() {
	search.value = "";
	const current = new Map((props.item?.addons || []).map((a) => [a.item_code, a.amount]));
	rows.value = getAvailableAddons(props.item).map((addon) => ({
		...addon,
		selected: current.has(addon.item_code),
		amount: current.get(addon.item_code) ?? 0,
	}));
}

const filteredRows = computed(() => {
	const term = search.value.trim().toLowerCase();
	if (!term) return rows.value;
	return rows.value.filter(
		(row) =>
			row.selected ||
			row.item_name.toLowerCase().includes(term) ||
			row.item_code.toLowerCase().includes(term)
	);
});

const selectedTotal = computed(() =>
	rows.value
		.filter((row) => row.selected)
		.reduce((sum, row) => sum + (Number.parseFloat(row.amount) || 0), 0)
);

function formatCurrency(amount) {
	return formatCurrencyUtil(Number.parseFloat(amount || 0), props.currency);
}

function save() {
	const addons = rows.value
		.filter((row) => row.selected)
		.map((row) => ({
			item_code: row.item_code,
			item_name: row.item_name,
			amount: Math.max(0, Number.parseFloat(row.amount) || 0),
		}));
	emit("save", addons);
	show.value = false;
}
</script>
