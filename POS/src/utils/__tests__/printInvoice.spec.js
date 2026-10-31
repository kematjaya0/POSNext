import { describe, it, expect, vi } from "vitest";

globalThis.__ = (s, args = []) => String(s).replace(/\{(\d+)\}/g, (_, i) => args[i]);

vi.mock("@/utils/apiWrapper", () => ({ call: vi.fn() }));
vi.mock("@/utils/offline/offlineReceiptCache", () => ({ getOfflineReceiptPayload: vi.fn() }));
vi.mock("@/utils/offline/sync", () => ({ getOfflineInvoiceByOfflineId: vi.fn() }));
vi.mock("@/utils/offline/workerClient", () => ({ offlineWorker: {} }));
vi.mock("@/utils/qzTray", () => ({ printHTML: vi.fn() }));

import { buildReceiptHTML } from "@/utils/printInvoice";

const invoice = (extra = {}) => ({
	name: "pos_offline_1730000000000",
	company: "CV Tes",
	grand_total: 1000,
	items: [{ item_code: "A", item_name: "A", qty: 1, rate: 1000 }],
	...extra,
});

describe("buildReceiptHTML nota QR", () => {
	it("adds an SVG QR with the receipt number below it", () => {
		const html = buildReceiptHTML(invoice());
		expect(html).toContain("<svg");
		expect(html).toContain("nota-qr");
	});

	it("leaves returns without QR", () => {
		expect(buildReceiptHTML(invoice({ is_return: 1 }))).not.toContain("<svg");
	});
});
