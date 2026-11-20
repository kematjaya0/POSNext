import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import lifecycle from "../../../../pos_next/templates/includes/receipt_print_lifecycle.js?raw";

describe("receipt window print lifecycle", () => {
	let popup;
	let media;
	const emit = (name) => popup.dispatchEvent(new Event(name));
	function changeMedia(matches) {
		media.matches = matches;
		media.dispatchEvent(Object.assign(new Event("change"), { matches }));
	}

	beforeEach(() => {
		vi.useFakeTimers();
		media = Object.assign(new EventTarget(), { matches: false });
		popup = Object.assign(new EventTarget(), {
			opener: {},
			matchMedia: () => media,
			setTimeout,
			close: vi.fn(),
		});
		new Function("window", lifecycle)(popup);
	});
	afterEach(() => vi.useRealTimers());

	it("defers closing until after the afterprint event has finished", () => {
		emit("beforeprint");
		emit("afterprint");
		expect(popup.close).not.toHaveBeenCalled();
		vi.runAllTimers();
		expect(popup.close).toHaveBeenCalledOnce();
		emit("afterprint");
		changeMedia(false);
		vi.runAllTimers();
		expect(popup.close).toHaveBeenCalledOnce();
	});

	it("closes on leaving print media even without afterprint", () => {
		changeMedia(true);
		vi.runAllTimers();
		expect(popup.close).not.toHaveBeenCalled();
		changeMedia(false);
		vi.runAllTimers();
		expect(popup.close).toHaveBeenCalledOnce();
	});

	it("closes on focus returning from a print dialog that omitted afterprint", () => {
		emit("beforeprint");
		emit("blur");
		vi.runAllTimers();
		expect(popup.close).not.toHaveBeenCalled();
		emit("focus");
		vi.runAllTimers();
		expect(popup.close).toHaveBeenCalledOnce();
	});

	it("does not close a loading/error preview or one that has never lost focus", () => {
		emit("blur");
		emit("focus");
		changeMedia(false);
		emit("beforeprint");
		emit("focus");
		vi.runAllTimers();
		expect(popup.close).not.toHaveBeenCalled();
	});

	it("keeps the window while print media is active, even after an early event", () => {
		emit("beforeprint");
		changeMedia(true);
		emit("blur");
		emit("focus");
		emit("afterprint");
		vi.runAllTimers();
		expect(popup.close).not.toHaveBeenCalled();
		changeMedia(false);
		vi.runAllTimers();
		expect(popup.close).toHaveBeenCalledOnce();
	});

	it("also handles a browser without matchMedia", () => {
		const target = Object.assign(new EventTarget(), { opener: {}, setTimeout, close: vi.fn() });
		new Function("window", lifecycle)(target);
		target.dispatchEvent(new Event("afterprint"));
		vi.runAllTimers();
		expect(target.close).toHaveBeenCalledOnce();
	});

	it("does not auto-close a standalone preview or PDF renderer", () => {
		const target = Object.assign(new EventTarget(), { opener: null, setTimeout, close: vi.fn() });
		new Function("window", lifecycle)(target);
		target.dispatchEvent(new Event("afterprint"));
		vi.runAllTimers();
		expect(target.close).not.toHaveBeenCalled();
	});
});
