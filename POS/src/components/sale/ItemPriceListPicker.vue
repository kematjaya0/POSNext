<template>
	<div v-if="context?.enabled || error" class="mt-1.5 text-xs" @click.stop>
		<label class="flex flex-wrap items-center gap-2">
			<span class="text-slate-500">{{ context?.territory || __("Wilayah Harga") }}</span>
			<select
				:value="item.custom_selling_price_list || context?.normal_price_list"
				:disabled="loading || isOffline()"
				@change="selectPrice($event.target.value)"
				class="max-w-full rounded border border-slate-300 bg-white px-2 py-1"
				:aria-label="__('Price List Item')"
			>
				<option
					v-for="option in context?.options || []"
					:key="option.price_list"
					:value="option.price_list"
				>
					{{ option.price_list
					}}{{ option.tier_level ? " · " + __("Perlu approval") : "" }}
				</option>
			</select>
		</label>
		<p v-if="error" class="mt-1 text-red-700" role="alert">{{ error }}</p>
	</div>
</template>

<script setup>
import { ref, watch } from "vue";
import { createResource } from "frappe-ui";
import { usePOSCartStore } from "@/stores/posCart";
import { isOffline } from "@/utils/offline";

const props = defineProps({ item: Object, posProfile: String, currency: String });
const context = ref(null);
const error = ref("");
const loading = ref(false);
const cart = usePOSCartStore();
const resource = createResource({
	url: "nextend.sales_approval.pricing.get_pricing_context",
	auto: false,
});
let revision = 0;
async function selectPrice(name) {
	const option = context.value?.options.find((p) => p.price_list === name);
	if (!option) return;
	const updates = { custom_selling_price_list: name };
	if (option.rate != null)
		Object.assign(updates, {
			rate: option.rate,
			price_list_rate: option.rate,
			discount_amount: 0,
			discount_percentage: 0,
			original_rate: option.rate,
			is_rate_manually_edited: 0,
		});
	await cart.updateItemDetails(props.item.item_code, updates, props.item.uom);
}
watch(
	() => [props.posProfile, props.item.item_code, props.item.uom, props.currency],
	async (params, previous) => {
		const current = ++revision;
		if (isOffline()) return;
		loading.value = true;
		error.value = "";
		try {
			const result = await resource.submit({
				pos_profile: props.posProfile,
				item_code: props.item.item_code,
				uom: props.item.uom,
				currency: props.currency,
			});
			if (current !== revision) return;
			context.value = result?.message || result;
			// Catalog rates already come from the branch policy. Preserve existing discounts.
			if (context.value?.enabled && !props.item.custom_selling_price_list)
				await cart.updateItemDetails(
					props.item.item_code,
					{ custom_selling_price_list: context.value.normal_price_list },
					props.item.uom,
				);
			else if (context.value?.enabled && previous && params[2] !== previous[2]) {
				if (
					context.value.options.some(
						(p) => p.price_list === props.item.custom_selling_price_list,
					)
				)
					await selectPrice(props.item.custom_selling_price_list);
				else
					error.value = __(
						"Price List ini tidak memiliki harga untuk UOM yang dipilih.",
					);
			}
		} catch (e) {
			if (current === revision)
				error.value = e.message || __("Kebijakan harga belum tersedia.");
		} finally {
			if (current === revision) loading.value = false;
		}
	},
	{ immediate: true },
);
</script>
