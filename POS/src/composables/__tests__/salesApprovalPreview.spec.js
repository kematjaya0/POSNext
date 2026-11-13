import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import { effectScope, nextTick, reactive } from "vue"

const { submit, offline } = vi.hoisted(() => ({
	submit: vi.fn(),
	offline: { value: false },
}))
vi.mock("frappe-ui", () => ({
	createResource: () => ({ submit, fetch: vi.fn() }),
}))
vi.mock("@/utils/offline", () => ({
	isOffline: () => offline.value,
	getCachedItem: vi.fn(),
}))
vi.mock("@/utils/offline/uuid", () => ({ generateUUID: () => "uuid" }))
vi.mock("@/utils/offline/db", () => ({ db: {} }))
globalThis.__ = (s) => s

import { useInvoice } from "@/composables/useInvoice"
import { useSalesApprovalPreview } from "@/composables/useSalesApprovalPreview"

let scope
let props
let preview

async function tick() {
	await nextTick()
	await vi.advanceTimersByTimeAsync(400)
}

beforeEach(() => {
	vi.useFakeTimers()
	submit.mockReset().mockResolvedValue({
		needs_approval: true,
		required_role: "CEO",
		lines: [],
	})
	offline.value = false
	setActivePinia(createPinia())
	scope = effectScope()
	scope.run(() => {
		const invoice = useInvoice()
		props = reactive({
			items: [
				{
					item_code: "A",
					quantity: 1,
					price_list_rate: 100000,
					rate: 100000,
					amount: 100000,
				},
				{
					item_code: "B",
					quantity: 1,
					price_list_rate: 40000,
					rate: 40000,
					amount: 36000,
					discount_amount: 4000,
					discount_percentage: 10,
				},
			],
			additionalDiscount: 0,
			discountAmount: 4000, // The summary also includes B's discount.
			posProfile: "Kasir",
		})
		preview = useSalesApprovalPreview(props, invoice.formatItemsForSubmission)
	})
})

afterEach(() => {
	scope.stop()
	vi.useRealTimers()
})

describe("sales approval preview", () => {
	it("keeps B's Rp4.000 discount on B using the actual submit formatter", async () => {
		await tick()
		const payload = submit.mock.calls[0][0]
		expect(
			JSON.parse(payload.items).map((row) => [row.item_code, row.rate]),
		).toEqual([
			["A", 100000],
			["B", 36000],
		])
		expect(payload.additional_discount).toBe(0)
		expect(preview.value.required_role).toBe("CEO")
	})

	it("sends only the separate nota discount, also in SPG mode", async () => {
		props.posProfile = "SPG"
		props.additionalDiscount = 2000
		props.discountAmount = 6000
		await tick()
		expect(submit.mock.calls[0][0]).toMatchObject({
			pos_profile: "SPG",
			additional_discount: 2000,
		})
	})

	it("rechecks a discount edit when the displayed rate stays the same", async () => {
		await tick()
		props.items[1].amount = 35000
		props.items[1].discount_amount = 5000
		await tick()
		expect(JSON.parse(submit.mock.calls[1][0].items)[1].rate).toBe(35000)
	})

	it("ignores an older response after a price edit", async () => {
		let resolveOld
		submit.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveOld = resolve
				}),
		)
		await tick()
		props.items[1].amount = 35000
		await tick()
		resolveOld({ required_role: "Manager Pembelian", lines: [] })
		await Promise.resolve()
		expect(preview.value.required_role).toBe("CEO")
	})

	it("does not request a preview while offline", async () => {
		offline.value = true
		await tick()
		expect(submit).not.toHaveBeenCalled()
		expect(preview.value.needs_approval).toBe(false)
	})

	it("clears the hint for an empty cart", async () => {
		await tick()
		props.items = []
		await tick()
		expect(preview.value.needs_approval).toBe(false)
		expect(submit).toHaveBeenCalledTimes(1)
	})
})
