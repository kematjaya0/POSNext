import { computed, onScopeDispose, ref, watch } from "vue"
import { createResource } from "frappe-ui"
import { isOffline } from "@/utils/offline"
import { logger } from "@/utils/logger"

const log = logger.create("SalesApprovalPreview")
const emptyPreview = () => ({
	needs_approval: false,
	lines: [],
	required_role: "",
})
const DEBOUNCE_MS = 400

export function useSalesApprovalPreview(props, formatItems) {
	// Cart rates are display prices. The submit formatter applies each row's
	// discount and includes its UOM, warehouse, add ons and tinta cost.
	const items = computed(() => formatItems(props.items || []))
	const preview = ref(emptyPreview())
	const resource = createResource({
		url: "nextend.sales_approval.pos_next_bridge.check_cart_approval",
		auto: false,
	})
	let timer = null
	let revision = 0

	async function check(current) {
		if (!items.value.length || isOffline()) {
			preview.value = emptyPreview()
			return
		}
		try {
			const result = await resource.submit({
				items: JSON.stringify(items.value),
				pos_profile: props.posProfile,
				// totalDiscount also includes line discounts already in the rates.
				additional_discount: props.additionalDiscount || 0,
			})
			if (current === revision)
				preview.value = result?.message || result || emptyPreview()
		} catch (error) {
			log.debug("Sales approval pre-check failed:", error)
			if (current === revision) preview.value = emptyPreview()
		}
	}

	watch(
		() => [
			JSON.stringify(items.value),
			props.additionalDiscount,
			props.posProfile,
		],
		() => {
			clearTimeout(timer)
			const current = ++revision
			timer = setTimeout(() => check(current), DEBOUNCE_MS)
		},
		{ immediate: true },
	)
	onScopeDispose(() => {
		clearTimeout(timer)
		revision++
	})
	return preview
}
