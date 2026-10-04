/**
 * Stock Validation Utility
 * Single source of truth for stock availability checks.
 */

import { call } from "frappe-ui";

/**
 * Determine whether an item requires stock validation.
 * Centralises the skip-logic so every call site uses the same rules.
 *
 * @param {Object} item - Item object (from search API or cart)
 * @returns {boolean} true when stock should be enforced for this item
 */
export function shouldValidateItemStock(item) {
	if (!item) return false;

	// SPG order rows (nextend POS Order): their stock is already reserved for the order
	if (item.pos_order_row) return false;

	// Non-stock items are never validated
	if (item.is_stock_item === 0 || item.is_stock_item === false) return false;

	// Item-level allow_negative_stock bypasses validation
	if (item.allow_negative_stock === 1 || item.allow_negative_stock === true) return false;

	// Batch / serial items have their own dialog-level validation
	if (item.has_serial_no || item.has_batch_no) return false;

	// Must be a stock item or bundle (or have stock data)
	const hasStockData = item.actual_qty !== undefined || item.stock_qty !== undefined;
	return !!(item.is_stock_item || item.is_bundle || hasStockData);
}

/**
 * Check if the requested quantity exceeds available stock.
 *
 * @param {Object}  item       - Item with actual_qty / stock_qty
 * @param {number}  requestedQty - Total quantity to validate against
 * @param {string}  [warehouse]  - Warehouse name (for error message)
 * @returns {{ available: boolean, actualQty: number, error: string|null }}
 */
export function checkStockAvailability(item, requestedQty, warehouse) {
	const actualQty = item.actual_qty ?? item.stock_qty ?? 0;
	const wh = warehouse || item.warehouse || "";

	if (actualQty >= requestedQty) {
		return { available: true, actualQty, error: null };
	}

	return {
		available: false,
		actualQty,
		error: formatStockError(item.item_name, requestedQty, actualQty, wh),
	};
}

/**
 * Stock-UOM quantity of `itemCode` already in the cart.
 *
 * @param {Array}  cartItems - posCart invoiceItems
 * @param {string} itemCode
 * @returns {number}
 */
export function cartStockQty(cartItems, itemCode) {
	return (cartItems || [])
		.filter((row) => row.item_code === itemCode)
		.reduce(
			(sum, row) => sum + (Number(row.quantity) || 0) * (Number(row.conversion_factor) || 1),
			0
		);
}

/**
 * Default warehouse for a cart row by the session's stock tiers: the first
 * branch warehouse (native first) that covers `neededQty` on its own, else the
 * branch warehouse holding the most. "outside" rows are never picked - the
 * cashier chooses those by hand.
 *
 * @param {Array<{warehouse: string, stock_qty: number, tier?: string}>} rows - tier order
 * @param {number} neededQty - Same UOM as the rows' stock_qty
 * @returns {string|null}
 */
export function pickSessionWarehouse(rows, neededQty) {
	const branch = (rows || []).filter((row) => row.tier !== "outside");
	if (!branch.length) return null;
	const covering = branch.find((row) => (Number(row.stock_qty) || 0) >= neededQty);
	if (covering) return covering.warehouse;
	return branch.reduce((best, row) =>
		(Number(row.stock_qty) || 0) > (Number(best.stock_qty) || 0) ? row : best
	).warehouse;
}

/**
 * True when the POS session spans more than one warehouse for this item
 * (nextend Warehouse Group, or stock elsewhere) - the cashier then picks the
 * warehouse in the item dialog instead of the row going straight to the cart.
 *
 * @param {Object} item - Item payload from get_items / get_items_bulk
 * @returns {boolean}
 */
export function hasWarehouseChoice(item) {
	return Object.keys(item?.stock_by_warehouse || {}).length > 1 || (item?.outside_qty || 0) > 0;
}

/**
 * Get item stock from Frappe API
 * @param {string} itemCode - Item code
 * @param {string} warehouse - Warehouse
 * @returns {Promise<number>} - Available quantity
 */
export async function getItemStock(itemCode, warehouse) {
	try {
		const result = await call("frappe.client.get_value", {
			doctype: "Bin",
			filters: {
				item_code: itemCode,
				warehouse: warehouse,
			},
			fieldname: "actual_qty",
		});

		return Number.parseFloat(result?.actual_qty || 0);
	} catch (error) {
		console.warn("Failed to fetch stock:", error);
		return 0;
	}
}

/**
 * Format stock error message for user
 * @param {string} itemName - Item name
 * @param {number} requested - Requested quantity
 * @param {number} available - Available quantity
 * @param {string} warehouse - Warehouse name
 * @returns {string} - Formatted error message
 */
export function formatStockError(itemName, requested, available, warehouse) {
	if (available <= 0) {
		return `"${itemName}" is out of stock in warehouse "${warehouse}".`;
	}

	const unit = requested === 1 ? "unit" : "units";
	const availableUnit = available === 1 ? "unit" : "units";
	return `Not enough stock for "${itemName}".\n\nYou requested ${requested} ${unit}, but only ${available} ${availableUnit} available in "${warehouse}".`;
}
