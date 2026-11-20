import qrcode from "qrcode-generator";
import { call } from "@/utils/apiWrapper";
import { logger } from "@/utils/logger";
import { getOfflineReceiptPayload } from "@/utils/offline/offlineReceiptCache";
import { getOfflineInvoiceByOfflineId } from "@/utils/offline/sync";
import { offlineWorker } from "@/utils/offline/workerClient";
import { printHTML as qzPrintHTML } from "@/utils/qzTray";
import thermalReceiptStyles from "../../../pos_next/templates/includes/thermal_receipt.css?raw";

const log = logger.create("PrintInvoice");

const DEFAULT_PRINT_FORMAT = "POS Next Receipt";
const THERMAL_RECEIPT_OPTIONS = {
	usePrinterPageSize: true,
	printableWidth: 72,
	scaleContent: false,
};

async function printWhenReady(printWindow) {
	await printWindow.document.fonts?.ready;
	if (!printWindow.closed) printWindow.print();
}

// ============================================================================
// Shared helpers
// ============================================================================

// Receipt amounts as "Rp 251.004" - same as the POS Next Receipt print format
const receiptNumber = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

function formatCurrency(amount) {
	return `Rp ${receiptNumber.format(Math.round(Number.parseFloat(amount || 0)))}`;
}

/**
 * Fall back to summing payment rows when paid_amount is not set —
 * offline invoices lack paid_amount until server submission.
 */
function derivePaidAmount(invoiceData) {
	if (invoiceData.paid_amount != null) return invoiceData.paid_amount;
	if (!Array.isArray(invoiceData.payments)) return 0;
	return invoiceData.payments.reduce((sum, p) => sum + (Number.parseFloat(p.amount) || 0), 0);
}

/** Sales Invoices not yet on the server (offline queue / local receipt id). */
export function isLocalOnlyInvoiceName(name) {
	return (
		typeof name === "string" &&
		(name.startsWith("OFFLINE-") || name.startsWith("pos_offline_"))
	);
}

/**
 * Fire-and-forget: flag the queued invoice as printed so a later edit
 * can warn the cashier a physical receipt is already in the customer's hands.
 * Silently no-ops for synced / server-side invoices.
 */
function flagOfflineInvoicePrinted(invoiceName) {
	if (!isLocalOnlyInvoiceName(invoiceName)) return;
	// Don't await — printing should never block on this bookkeeping call.
	offlineWorker.markOfflineInvoicePrinted(invoiceName).catch((err) => {
		log.warn("Failed to mark offline invoice printed:", err?.message || err);
	});
}

/**
 * Build a minimal printable receipt doc from a raw queued invoice payload
 * (the dict stored in IndexedDB invoice_queue.data). Used when sessionStorage
 * has been wiped but the invoice is still in the local queue.
 */
function receiptDocFromQueuedInvoice(offlineId, raw) {
	const items = Array.isArray(raw.items) ? raw.items : [];
	const payments = Array.isArray(raw.payments) ? raw.payments : [];
	const grandTotal = Number.parseFloat(raw.grand_total) || 0;
	const paidAmount = payments.reduce((sum, p) => sum + (Number.parseFloat(p.amount) || 0), 0);
	return {
		name: offlineId,
		doctype: "Sales Invoice",
		is_offline: true,
		pos_profile: raw.pos_profile,
		posting_date: raw.posting_date || new Date().toISOString().slice(0, 10),
		company: raw.company,
		customer_name: raw.customer,
		items: items.map((item) => ({
			...item,
			quantity: item.quantity ?? item.qty,
		})),
		grand_total: grandTotal,
		total_taxes_and_charges: Number.parseFloat(raw.total_tax) || 0,
		discount_amount: Number.parseFloat(raw.total_discount) || 0,
		payments,
		paid_amount: paidAmount,
		change_amount: Number.parseFloat(raw.change_amount) || 0,
		outstanding_amount: Math.max(0, grandTotal - paidAmount),
		status: grandTotal - paidAmount < 0.01 ? "Paid" : "Unpaid",
		docstatus: 0,
	};
}

/**
 * Hydrate a local-only invoice from cache. Checks sessionStorage first
 * (fast path, survives within the tab), then falls back to IndexedDB
 * (survives page reloads while the invoice is still in the offline queue).
 * Prevents server print / get_invoice for synthetic pos_offline_* ids.
 */
export async function hydrateLocalOnlyInvoice(invoiceData) {
	if (!invoiceData?.name || !isLocalOnlyInvoiceName(invoiceData.name)) return invoiceData;
	if (invoiceData.items?.length > 0) return invoiceData;

	const cached = getOfflineReceiptPayload(invoiceData.name);
	if (cached?.items?.length > 0) return cached;

	// sessionStorage wiped (page reload) — rebuild from IndexedDB queue.
	try {
		const queued = await getOfflineInvoiceByOfflineId(invoiceData.name);
		if (queued?.items?.length > 0) {
			return receiptDocFromQueuedInvoice(invoiceData.name, queued);
		}
	} catch (err) {
		log.warn("IndexedDB hydrate fallback failed:", err?.message || err);
	}

	return invoiceData;
}

const RECEIPT_STYLES = thermalReceiptStyles;

/**
 * Inner receipt HTML (no shell). Used for local/offline invoices and QZ Tray.
 */
/**
 * Receipt rows with add ons (tinta) folded into their base line's price, as
 * nextend's Sales Invoice before_print does for server-rendered prints.
 */
function foldAddonRows(items) {
	const addonTotal = {};
	for (const item of items) {
		if (!item.custom_addon_parent_key) continue;
		const qty = Number(item.quantity || item.qty) || 1;
		const amount = Number(item.amount ?? (Number(item.rate) || 0) * qty) || 0;
		addonTotal[item.custom_addon_parent_key] =
			(addonTotal[item.custom_addon_parent_key] || 0) + amount;
	}
	return items
		.filter((item) => !item.custom_addon_parent_key)
		.map((item) => {
			const extra = item.custom_addon_key ? addonTotal[item.custom_addon_key] : 0;
			const qty = Number(item.quantity || item.qty) || 0;
			if (!extra || !qty) return item;
			const perUnit = extra / qty;
			const rate = (Number(item.rate) || 0) + perUnit;
			const priceListRate = item.price_list_rate
				? Number(item.price_list_rate) + perUnit
				: item.price_list_rate;
			return {
				...item,
				amount: item.amount != null ? Number(item.amount) + extra : undefined,
				rate,
				price_list_rate: priceListRate,
				discount_percentage:
					item.discount_percentage && priceListRate
						? (1 - rate / priceListRate) * 100
						: item.discount_percentage,
			};
		});
}

/**
 * SVG QR of the receipt number (plain text, so hardware scanners typing into
 * the search box read it too). Empty for returns, same as the server print.
 */
function receiptQrHTML(invoiceData) {
	if (!invoiceData.name || invoiceData.is_return) return "";
	const qr = qrcode(0, "L");
	qr.addData(String(invoiceData.name));
	qr.make();
	const svg = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
	const name = String(invoiceData.name).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
	return `
				<div class="nota-qr" style="text-align: center; margin-top: 8px;">
					<div style="width: 30mm; margin: 0 auto;">${svg}</div>
					<div style="font-size: 9px;">${name}</div>
				</div>`;
}

function escapeReceiptText(value) {
	return String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function buildReceiptHTML(invoiceData) {
	const items = foldAddonRows(invoiceData.items || []);
	const paidAmount = derivePaidAmount(invoiceData);
	const taxTotal = Number(invoiceData.total_taxes_and_charges) || 0;
	const additionalDiscount = Math.abs(Number(invoiceData.discount_amount) || 0);
	const itemsHtml = items.map((item) => {
		const qty = item.quantity ?? item.qty ?? 0;
		const isFree = item.is_free_item;
		const displayRate = Number(item.price_list_rate || item.rate) || 0;
		// amount/rate already include the item discount. net_amount may also
		// include invoice-wide discounts, so it must not be used here.
		const amount = isFree ? 0 : Number(item.amount ?? (Number(item.rate ?? displayRate) * qty));
		const discount = Math.max(0, Math.abs(qty * displayRate) - Math.abs(amount));
		const percentage = Number(Number(item.discount_percentage || 0).toFixed(2));
		const warehouseName = String(item.warehouse || "").replace(/-[^-]*$/, "").trim();
		const warehouse = warehouseName
			? `<span class="item-warehouse">[${escapeReceiptText(warehouseName)}]</span> ` : "";
		return `<div class="item-row">
			<div class="item-name">${warehouse}${escapeReceiptText(item.item_name || item.item_code)}${isFree ? ' <span class="item-free">(GRATIS)</span>' : ""}</div>
			<div class="receipt-row item-details"><span>${escapeReceiptText(qty)} × ${isFree ? "GRATIS" : formatCurrency(displayRate)}</span><span>${formatCurrency(amount)}</span></div>
			${!isFree && discount > 0 ? `<div class="receipt-row item-discount"><span>Diskon${percentage ? ` ${percentage}%` : ""}</span><span>-${formatCurrency(discount)}</span></div>` : ""}
			${item.serial_no ? `<div class="item-serials">Serial No: ${escapeReceiptText(String(item.serial_no).replace(/\n/g, ", "))}</div>` : ""}
		</div>`;
	}).join("");
	const postingDate = invoiceData.posting_date || new Date().toLocaleDateString("id-ID");
	const postingTime = invoiceData.posting_time ? ` ${String(invoiceData.posting_time).split(".")[0]}` : "";
	const customer = invoiceData.customer_name || invoiceData.customer;
	const partlyPaid = invoiceData.status === "Partly Paid" ||
		(invoiceData.outstanding_amount > 0 && invoiceData.outstanding_amount < invoiceData.grand_total);

	return `<div class="receipt">
		<div class="header">
			<div class="company-name">${escapeReceiptText(invoiceData.company || "POS Next")}</div>
			<div class="receipt-title">${escapeReceiptText(invoiceData.header || "Nota Penjualan")}</div>
		</div>
		${invoiceData.is_offline ? '<div class="offline-badge">OFFLINE — PENDING SYNC</div>' : ""}
		<div class="receipt-meta">
			<div class="receipt-meta-row"><span class="receipt-meta-label">No. nota</span><span class="receipt-meta-value">${escapeReceiptText(invoiceData.name)}</span></div>
			<div class="receipt-meta-row"><span class="receipt-meta-label">Tanggal</span><span class="receipt-meta-value">${escapeReceiptText(postingDate + postingTime)}</span></div>
			${customer ? `<div class="receipt-meta-row"><span class="receipt-meta-label">Pelanggan</span><span class="receipt-meta-value">${escapeReceiptText(customer)}</span></div>` : ""}
			${partlyPaid ? '<div class="receipt-meta-row"><span class="receipt-meta-label">Status</span><span class="receipt-meta-value">Pembayaran sebagian</span></div>' : ""}
		</div>
		<div class="receipt-items">${itemsHtml}</div>
		<div class="receipt-totals">
			<div class="receipt-row"><span>Subtotal</span><span>${formatCurrency((Number(invoiceData.grand_total) || 0) - taxTotal + additionalDiscount)}</span></div>
			${taxTotal ? `<div class="receipt-row"><span>Pajak</span><span>${formatCurrency(taxTotal)}</span></div>` : ""}
			${additionalDiscount ? `<div class="receipt-row invoice-discount"><span>Diskon tambahan${invoiceData.additional_discount_percentage ? ` ${Number(invoiceData.additional_discount_percentage)}%` : ""}</span><span>-${formatCurrency(additionalDiscount)}</span></div>` : ""}
			<div class="receipt-row grand-total"><span>TOTAL</span><span>${formatCurrency(invoiceData.grand_total)}</span></div>
		</div>
		${invoiceData.payments?.length ? `<div class="receipt-payments">
			${invoiceData.payments.map((p) => `<div class="receipt-row payment-row"><span>${escapeReceiptText(p.mode_of_payment)}</span><span>${formatCurrency(p.amount)}</span></div>`).join("")}
			<div class="receipt-row total-paid"><span>Total bayar</span><span>${formatCurrency(paidAmount)}</span></div>
			${invoiceData.change_amount > 0 ? `<div class="receipt-row"><span>Kembalian</span><span>${formatCurrency(invoiceData.change_amount)}</span></div>` : ""}
			${invoiceData.outstanding_amount > 0 ? `<div class="receipt-row outstanding-row"><span>Sisa tagihan</span><span>${formatCurrency(invoiceData.outstanding_amount)}</span></div>` : ""}
		</div>` : ""}
		<div class="footer">
			<div class="receipt-thanks">Terima kasih atas kepercayaan anda.</div>
			<div class="receipt-policy">Barang yang sudah dibeli dapat ditukar di hari yang sama dan tidak bisa dikembalikan.</div>
		</div>
		${receiptQrHTML(invoiceData)}
	</div>`;
}

function buildReceiptDocumentHTML(invoiceData, { includeControls = false } = {}) {
	const controls = includeControls
		? `
			<div class="no-print" style="text-align: center; margin-top: 20px;">
				<button onclick="window.print()" style="padding: 10px 20px; font-size: 14px; cursor: pointer;">${__(
					"Print Receipt"
				)}</button>
				<button onclick="window.close()" style="padding: 10px 20px; font-size: 14px; cursor: pointer; margin-left: 10px;">${__(
					"Close"
				)}</button>
			</div>`
		: "";
	return `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
			<title>${__("Invoice - {0}", [invoiceData.name])}</title>
			<style>${RECEIPT_STYLES}</style>
		</head>
		<body>
			${buildReceiptHTML(invoiceData)}
			${controls}
		</body>
		</html>`;
}

/**
 * Resolve print format & letterhead from a POS Profile.
 * Returns defaults when the profile lookup fails so callers always get a value.
 */
async function resolvePrintSettings(posProfile, printFormat, letterhead) {
	if (printFormat) return { printFormat, letterhead };

	if (posProfile) {
		try {
			const doc = await call("frappe.client.get", {
				doctype: "POS Profile",
				name: posProfile,
			});
			if (doc) {
				return {
					printFormat: doc.print_format || DEFAULT_PRINT_FORMAT,
					letterhead: letterhead || doc.letter_head || null,
				};
			}
		} catch (err) {
			log.warn("Could not fetch POS Profile print settings:", err);
		}
	}

	return { printFormat: DEFAULT_PRINT_FORMAT, letterhead };
}

// ============================================================================
// Browser printing (opens /printview in a new window)
// ============================================================================

/**
 * Open Frappe's /printview in a new browser window.
 * The thermal template waits for load/fonts itself. Other formats use Frappe's trigger.
 * Falls back to the hardcoded receipt template if the popup is blocked.
 */
export async function printInvoice(invoiceData, printFormat = null, letterhead = null) {
	try {
		if (!invoiceData?.name) throw new Error("Invalid invoice data");

		invoiceData = await hydrateLocalOnlyInvoice(invoiceData);

		// Pending offline / local IDs are not in ERPNext — use embedded receipt HTML.
		if (isLocalOnlyInvoiceName(invoiceData.name)) {
			if (invoiceData.items?.length > 0) return printInvoiceCustom(invoiceData);
			throw new Error(
				__(
					"This offline receipt is no longer in browser storage. Sync the invoice, then print from history."
				)
			);
		}

		const doctype = invoiceData.doctype || "Sales Invoice";
		const format = printFormat || DEFAULT_PRINT_FORMAT;

		const params = new URLSearchParams({
			doctype,
			name: invoiceData.name,
			format,
			no_letterhead: letterhead ? 0 : 1,
			_lang: "en",
			trigger_print: format === DEFAULT_PRINT_FORMAT ? 0 : 1,
			_t: Date.now(),
		});
		if (letterhead) params.append("letterhead", letterhead);

		const printWindow = window.open(`/printview?${params}`, "_blank", "width=800,height=600");
		if (!printWindow) {
			throw new Error("Popup blocked — check your browser settings.");
		}
		return true;
	} catch (error) {
		log.error("Browser print failed:", error);
		if (isLocalOnlyInvoiceName(invoiceData?.name) && !(invoiceData.items?.length > 0)) {
			throw error;
		}
		return printInvoiceCustom(invoiceData);
	}
}

/**
 * Fetch an invoice by name, resolve its POS Profile print settings,
 * then open the browser print window.
 */
export async function printInvoiceByName(invoiceName, printFormat = null, letterhead = null) {
	if (isLocalOnlyInvoiceName(invoiceName)) {
		const localDoc = await hydrateLocalOnlyInvoice({ name: invoiceName });
		if (!localDoc.items?.length) {
			throw new Error(
				__(
					"This offline receipt is no longer in browser storage. Complete checkout again or sync, then print from history."
				)
			);
		}
		const settings = await resolvePrintSettings(localDoc.pos_profile, printFormat, letterhead);
		return printInvoice(localDoc, settings.printFormat, settings.letterhead);
	}
	const invoiceDoc = await call("pos_next.api.invoices.get_invoice", {
		invoice_name: invoiceName,
	});
	if (!invoiceDoc) throw new Error("Invoice not found");

	const settings = await resolvePrintSettings(invoiceDoc.pos_profile, printFormat, letterhead);
	return printInvoice(invoiceDoc, settings.printFormat, settings.letterhead);
}

// ============================================================================
// Silent printing (QZ Tray — no browser dialog)
// ============================================================================

export async function silentPrintDoc(doctype, name, printFormat) {
	const result = await call("frappe.www.printview.get_html_and_style", {
		doc: doctype,
		name,
		print_format: printFormat,
		no_letterhead: 1,
	});

	const html = result?.html || result?.message?.html;
	const style = result?.style || result?.message?.style || "";
	if (!html) throw new Error("Failed to get print HTML from server");

	const fullHTML = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>${style}</style></head>
<body>${html}</body>
</html>`;

	if (printFormat === DEFAULT_PRINT_FORMAT) {
		await qzPrintHTML(fullHTML, undefined, THERMAL_RECEIPT_OPTIONS);
	} else {
		await qzPrintHTML(fullHTML);
	}
	return true;
}

/**
 * Fetch the server-rendered print HTML and send it to a thermal printer
 * via QZ Tray. Uses Frappe's get_html_and_style API which returns the
 * print format HTML + its inline styles (standard.css, print style, custom CSS).
 * Note: print.bundle.css (Bootstrap grid/tables) is NOT included — print
 * formats that rely on Bootstrap layout classes may render differently.
 * Paper size and margins are controlled by the QZ Tray config in qzTray.js.
 */
export async function silentPrintInvoice(invoiceName, printFormat = null) {
	if (isLocalOnlyInvoiceName(invoiceName)) {
		const doc = await hydrateLocalOnlyInvoice({ name: invoiceName });
		if (doc.items?.length > 0) return silentPrintInvoiceFromDoc(doc);
		throw new Error(
			__(
				"This offline receipt is no longer in browser storage. Use browser print from the success dialog after checkout."
			)
		);
	}
	const format = printFormat || DEFAULT_PRINT_FORMAT;

	await silentPrintDoc("Sales Invoice", invoiceName, format);
	log.info(`Silent print sent for ${invoiceName}`);
	return true;
}

/**
 * Silent-print a full invoice dict using the same HTML as the offline receipt fallback.
 */
export async function silentPrintInvoiceFromDoc(invoiceData) {
	const fullHTML = buildReceiptDocumentHTML(invoiceData, { includeControls: false });
	await qzPrintHTML(fullHTML, undefined, THERMAL_RECEIPT_OPTIONS);
	log.info(`Silent print (local receipt) for ${invoiceData?.name}`);
	flagOfflineInvoicePrinted(invoiceData?.name);
	return true;
}

/**
 * Try silent print, fall back to browser print on failure.
 * silentPrintInvoice → qzPrintHTML → connect() handles auto-reconnect
 * internally, so no separate connection logic is needed here.
 */
export async function printWithSilentFallback(invoiceData, printFormat = null) {
	invoiceData = await hydrateLocalOnlyInvoice(invoiceData);
	const invoiceName = invoiceData?.name;
	if (!invoiceName) throw new Error("Invalid invoice data — missing name");

	if (isLocalOnlyInvoiceName(invoiceName) && invoiceData.items?.length > 0) {
		try {
			await silentPrintInvoiceFromDoc(invoiceData);
			return { method: "silent", success: true };
		} catch (err) {
			log.warn("Silent local receipt failed, falling back to browser:", err?.message || err);
		}
		try {
			printInvoiceCustom(invoiceData);
			return { method: "browser", success: true };
		} catch (err) {
			log.error("Browser print for local receipt failed:", err);
			return { method: "browser", success: false };
		}
	}

	try {
		await silentPrintInvoice(invoiceName, printFormat);
		return { method: "silent", success: true };
	} catch (err) {
		log.warn("Silent print failed, falling back to browser:", err?.message || err);
	}

	try {
		await printInvoiceByName(invoiceName, printFormat);
		return { method: "browser", success: true };
	} catch (err) {
		log.error("Browser print fallback also failed:", err);
		return { method: "browser", success: false };
	}
}

// ============================================================================
// Hardcoded receipt fallback (used only when /printview popup is blocked)
// ============================================================================

/**
 * Renders the receipt locally in a popup window. Used offline, for pending
 * local-only invoices, and as the fallback when /printview is unavailable.
 */
export function printInvoiceCustom(invoiceData) {
	const printWindow = window.open("", "_blank", "width=350,height=600");
	if (!printWindow) {
		log.error("Cannot open print window — popup blocked.");
		throw new Error(__("Popup blocked — check your browser settings."));
	}

	const printContent = buildReceiptDocumentHTML(invoiceData, { includeControls: true });

	printWindow.document.write(printContent);
	printWindow.onload = () => printWhenReady(printWindow);
	printWindow.document.close();
	flagOfflineInvoicePrinted(invoiceData?.name);
	return true;
}
