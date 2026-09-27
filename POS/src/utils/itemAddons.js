/**
 * Item add ons (e.g. tinta mixed into a paint base) - rules live in nextend
 * (`nextend.item_addon`). The catalog is fetched while online and kept in
 * IndexedDB so add ons can still be picked offline.
 *
 * In the cart an add on hangs off its base line as `item.addons`
 * ([{ item_code, item_name, amount }]) and is only expanded into separate
 * Sales Invoice rows (carrier item + custom_addon_* fields) on submission.
 */
import { call } from "@/utils/apiWrapper";
import { logger } from "@/utils/logger";
import { getSetting, setSetting } from "@/utils/offline/db";
import { ref } from "vue";

const log = logger.create("ItemAddons");
const CATALOG_KEY = "item_addon_catalog";

const catalog = ref(null);

export async function refreshAddonCatalog() {
	try {
		const data = await call("nextend.item_addon.get_addon_catalog");
		catalog.value = data?.message || data || null;
		await setSetting(CATALOG_KEY, catalog.value);
	} catch (error) {
		log.warn("Add on catalog unavailable, using cached copy", error);
		await loadCachedAddonCatalog();
	}
}

export async function loadCachedAddonCatalog() {
	if (!catalog.value) {
		catalog.value = await getSetting(CATALOG_KEY, null);
	}
}

/** Add ons offered for a cart line, mirroring nextend.item_addon.get_effective_addons. */
export function getAvailableAddons(item) {
	const data = catalog.value;
	if (!data || !item?.item_code || item.is_free_item) return [];

	const codes = new Set();
	for (const rule of data.rules) {
		const bases = rule.bases;
		if (
			bases.Item.includes(item.item_code) ||
			(item.brand && bases.Brand.includes(item.brand)) ||
			(item.item_group && bases["Item Group"].includes(item.item_group))
		) {
			rule.addons.forEach((code) => codes.add(code));
		}
	}
	const override = data.overrides[item.item_code];
	if (override) {
		override.add.forEach((code) => codes.add(code));
		override.exclude.forEach((code) => codes.delete(code));
	}
	codes.delete(item.item_code);

	return [...codes]
		.filter((code) => (data.bins[code] || []).includes(item.warehouse))
		.sort()
		.map((code) => ({ item_code: code, item_name: data.item_names[code] || code }));
}

export function getAddonCarrierItem() {
	return catalog.value?.carrier_item || null;
}
