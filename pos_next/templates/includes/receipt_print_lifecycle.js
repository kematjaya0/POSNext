// Install inside the receipt document, after navigation/document.write.
// The POS window must not own these listeners: the receipt owns its print dialog.
(() => {
	// Leave direct print previews and PDF generation alone.
	if (!window.opener) return;
	const printMedia = window.matchMedia?.("print");
	let printing = false;
	let lostFocus = false;
	let closing = false;

	function closeAfterPrint() {
		if (closing) return;
		closing = true;
		// Let the browser finish unwinding its print event before closing the tab.
		window.setTimeout(() => {
			if (printMedia?.matches) {
				closing = false;
				return;
			}
			window.removeEventListener("beforeprint", beforePrint);
			window.removeEventListener("afterprint", closeAfterPrint);
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("focus", onFocus);
			printMedia?.removeEventListener("change", onPrintMediaChange);
			window.close();
		}, 0);
	}

	function beforePrint() {
		printing = true;
	}
	function onPrintMediaChange(event) {
		if (event.matches) printing = true;
		else if (printing) closeAfterPrint();
	}
	function onBlur() {
		if (printing) lostFocus = true;
	}
	function onFocus() {
		// Some system print dialogs omit afterprint. Only accept a focus return
		// after printing started and the receipt actually lost focus.
		if (printing && lostFocus && !printMedia?.matches) closeAfterPrint();
	}

	window.addEventListener("beforeprint", beforePrint);
	window.addEventListener("afterprint", closeAfterPrint);
	window.addEventListener("blur", onBlur);
	window.addEventListener("focus", onFocus);
	printMedia?.addEventListener("change", onPrintMediaChange);
})();
