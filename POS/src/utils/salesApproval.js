/**
 * Labels for the reasons nextend's sales approval gives for holding a line
 * (nextend/sales_approval/engine.py REASON_*). The cashier is told why, never
 * the HPP itself.
 */
export function approvalReasonLabel(reason) {
	if (reason === "special_price_list") return __("Menggunakan Price List khusus");
	if (reason === "below_price_list") return __("Harga di bawah batas Price List");
	if (reason === "hpp_unknown") return __("HPP belum diketahui (stok tanpa lot pembelian)");
	if (reason === "below_hpp") return __("Harga di bawah HPP");
	if (reason === "low_margin") return __("Margin di bawah minimum");
	return __("Perlu approval");
}
