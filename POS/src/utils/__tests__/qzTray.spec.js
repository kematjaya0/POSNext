import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/apiWrapper", () => ({ call: vi.fn() }));
vi.mock("qz-tray", () => ({
	default: {
		websocket: { isActive: () => true },
		configs: { create: vi.fn((printer, options) => ({ printer, options })) },
		print: vi.fn().mockResolvedValue(),
	},
}));

import qz from "qz-tray";
import { printHTML } from "@/utils/qzTray";

describe("QZ HTML geometry", () => {
	beforeEach(() => vi.clearAllMocks());

	it("uses the existing page defaults for other print formats", async () => {
		await printHTML("<p>Test</p>", "Other Printer");
		expect(qz.configs.create).toHaveBeenCalledWith("Other Printer", expect.objectContaining({
			size: { width: 80, height: null },
			scaleContent: true,
			rasterize: false,
		}));
	});

	it("keeps thermal HTML vector and uses 72mm content on the driver's page", async () => {
		await printHTML("<p>Test</p>", "Epson", {
			usePrinterPageSize: true, printableWidth: 72, scaleContent: false,
		});
		const [config, data] = qz.print.mock.calls[0];
		expect(config.options).toMatchObject({
			size: null, units: "mm", rasterize: false, scaleContent: false,
			margins: { top: 0, right: 0, bottom: 0, left: 0 },
		});
		expect(config.options).not.toHaveProperty("density");
		expect(data).toEqual([{
			type: "pixel", format: "html", flavor: "plain", data: "<p>Test</p>",
			options: { pageWidth: 72 },
		}]);
	});

	it("preserves explicit paper widths and orientation", async () => {
		await printHTML("<p>Test</p>", "58mm Printer", {
			width: 58, orientation: "landscape", usePrinterPageSize: true,
		});
		expect(qz.configs.create).toHaveBeenCalledWith("58mm Printer", expect.objectContaining({
			size: { width: 58, height: null }, orientation: "landscape",
		}));
	});
});
