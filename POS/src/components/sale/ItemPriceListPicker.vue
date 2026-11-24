<template>
	<div v-if="context?.enabled || item.custom_selling_price_list || error" class="mt-1.5 text-xs">
		<template v-if="editable && context?.enabled">
			<label class="block text-sm font-medium text-gray-700 mb-2" for="item-price-list">{{ __("Price List") }}</label>
			<select
				id="item-price-list"
				:value="reference?.price_list || item.custom_selling_price_list || context.normal_price_list"
				:disabled="disabled || loading || isOffline()"
				@change="selectPrice($event.target.value)"
				class="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
				:aria-label="__('Price List Item')"
			>
				<option v-for="option in context.options || []" :key="option.price_list" :value="option.price_list">
					{{ option.price_list }}{{ option.rate == null ? '' : ' · ' + formatCurrency(option.rate, currency) }}
				</option>
			</select>
			<p class="mt-2 text-gray-500">{{ __("Harga akhir per unit") }}: {{ formatCurrency(effectiveRate ?? item.rate ?? 0, currency) }}</p>
		</template>
		<p v-else class="text-slate-500" data-testid="price-list-label">
			{{ reference?.price_list || item.custom_selling_price_list || context?.normal_price_list }}<template v-if="territory"> — {{ territory }}</template>
		</p>
		<p v-if="selection.belowAll && context?.enabled" class="mt-1 text-amber-700">{{ __("Di bawah semua acuan harga; perlu approval tertinggi.") }}</p>
		<p v-if="loading && editable" class="mt-1 text-gray-500">{{ __("Memuat pilihan harga...") }}</p>
		<p v-if="error" class="mt-1 text-red-700" role="alert">{{ error }}</p>
	</div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { createResource } from "frappe-ui";
import { isOffline } from "@/utils/offline";
import { formatCurrency } from "@/utils/currency";
import { pricingContextKey, selectPriceReference } from "@/utils/itemPricing";

const props = defineProps({ item: Object, posProfile: String, currency: String, editable: Boolean, disabled: Boolean, effectiveRate: {type: Number, default: null} });
const emit = defineEmits(["select-price", "reference-change", "context-change", "loading-change"]);
const context = ref(null);
const error = ref("");
const loading = ref(false);
const resource = createResource({url: "nextend.sales_approval.pricing.get_pricing_context", auto: false});
const selection = computed(() => selectPriceReference(context.value?.options, props.effectiveRate ?? props.item.rate ?? 0));
const reference = computed(() => selection.value.option);
const territory = computed(() => context.value?.territory || props.item.pricing_territory);
let revision = 0;
onBeforeUnmount(() => { revision++; });
watch(loading, (value) => emit("loading-change", value), {flush: "sync", immediate: true});
watch(() => [reference.value?.price_list, props.item.custom_selling_price_list], () => {
	if (context.value?.enabled && reference.value && reference.value.price_list !== props.item.custom_selling_price_list) {
		emit("reference-change", reference.value);
	}
});
function selectPrice(name) {
	if (props.disabled || loading.value || isOffline()) return;
	const option = context.value?.options.find((row) => row.price_list === name);
	if (option) emit("select-price", option);
}
watch(
	() => pricingContextKey(props.posProfile, props.item, props.currency),
	async (key) => {
		const current = ++revision;
		const cached = props.item.pricing_context;
		context.value = cached?.key === key ? cached : null;
		error.value = "";
		loading.value = false;
		if (isOffline() || !props.posProfile) return;
		loading.value = true;
		try {
			const result = await resource.submit({pos_profile: props.posProfile, item_code: props.item.item_code, uom: props.item.uom, currency: props.currency, batch_no: props.item.batch_no || null});
			if (current !== revision) return;
			context.value = {...(result?.message ?? result), key};
			emit("context-change", context.value);
		} catch (e) {
			if (current === revision) error.value = e.message || __("Kebijakan harga belum tersedia.");
		} finally {
			if (current === revision) loading.value = false;
		}
	},
	{immediate: true},
);
</script>
