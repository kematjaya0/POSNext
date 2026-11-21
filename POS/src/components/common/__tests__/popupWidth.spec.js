import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Lebar semua popup /pos (keputusan user 2026-11-21). CSS tidak dihitung di
// jsdom, jadi yang diuji adalah aturannya dan bahwa setiap modal buatan sendiri memakainya.
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("lebar popup POS", () => {
	it("frappe-ui Dialog dan modal sendiri: 71% layar maks 1050px, di HP 95%", () => {
		const css = read("../../../index.css");
		expect(css).toMatch(
			/\.dialog-content,\s*\.pos-popup\s*\{\s*max-width: min\(95vw, 1050px\) !important;/
		);
		expect(css).toMatch(
			/@media \(min-width: 768px\) \{\s*\.dialog-content,\s*\.pos-popup\s*\{\s*max-width: min\(71vw, 1050px\) !important;/
		);
	});

	it.each([
		"../../partials/PartialPayments.vue",
		"../../settings/POSSettings.vue",
		"../AuthorizationDialog.vue",
	])("%s memakai pos-popup", (path) => {
		expect(read(path)).toMatch(/class="pos-popup w-full/);
	});

	it("EditItemDialog ikut lewat class dialog-content", () => {
		expect(read("../../sale/EditItemDialog.vue")).toMatch(/max-w-md[^"]*dialog-content/);
	});
});
