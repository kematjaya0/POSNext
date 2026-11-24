import { call } from "@/utils/apiWrapper";
import { isOffline } from "@/utils/offline";

/** Resolve a selected layer before changing the cart row's UOM. */
export async function getSelectedUomPrice(item, posProfile, uom, currency) {
	if (!item.custom_selling_price_list) return null;
	if (isOffline()) {
		throw new Error(__("Hubungkan internet untuk memuat harga satuan ini."));
	}
	const response = await call("nextend.sales_approval.pricing.get_pricing_context", {
		pos_profile: posProfile,
		item_code: item.item_code,
		uom,
		currency,
		batch_no: item.batch_no || null,
	});
	const context = response?.message ?? response;
	if (!context?.enabled) return null;
	const option = context.options?.find((row) => row.price_list === item.custom_selling_price_list);
	// A normal list without a reference price still supports manual/open pricing.
	if (option && option.rate == null && option.price_list === context.normal_price_list) return null;
	if (!option || option.rate == null) {
		throw new Error(__("Price List ini tidak memiliki harga untuk UOM yang dipilih."));
	}
	return { rate: option.rate, price_list_rate: option.rate };
}

/** Same comparison tolerance and tier order as the server approval engine. */
export function selectPriceReference(options, effectiveRate) {
	const available = [...(options || [])]
		.filter((row) => row.rate != null)
		.sort((a, b) => a.tier_level - b.tier_level);
	const covered = available.find((row) => Number(effectiveRate) >= Number(row.rate) - 0.005);
	return { option: covered || available.at(-1) || options?.find((row) => !row.tier_level), belowAll: !covered };
}

export function pricingDiscountFactor(total, discount) {
	return total > 0 ? Math.max(0, 1 - Math.max(0, Number(discount) || 0) / total) : 1;
}

export function pricingContextKey(profile, item, currency) {
	return JSON.stringify([profile, item.item_code, item.uom, currency, item.batch_no || null]);
}
