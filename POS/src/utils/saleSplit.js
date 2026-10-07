/**
 * Preview of how a basket splits across the branch's warehouses and companies.
 *
 * The server decides the allocation (pos_next/api/split_invoice.py). Online
 * the cart shows the server's own answer (preview_allocation) and the sale is
 * refused if it changed by the time it is paid; the local allocation here
 * only fills the gap until that answer arrives, or while offline. It differs
 * from the server in one way: the server orders the non-session warehouses by
 * oldest restock, this by most stock.
 */

/**
 * @typedef {Object} SaleScope
 * @property {string} native - Session warehouse (POS Profile.warehouse)
 * @property {string} company - POS Profile company
 * @property {Object<string, {company: string, abbr: string}>} companyByWarehouse - Branch warehouses
 */

/** Cart line key - one row per item + UOM, plus its free-item row. */
export function saleRowKey(row) {
	return `${row.item_code}|${row.uom || row.stock_uom || ""}|${row.is_free_item ? 1 : 0}`;
}

/**
 * Whether the server may re-allocate this cart row (mirrors _is_auto_allocated).
 * @param {Object} row - posCart invoice item
 * @param {SaleScope} scope
 */
export function isAutoAllocated(row, scope) {
	if (row.pos_order_row) return false;
	if (row.batch_no || row.serial_no) return false;
	// A warehouse outside the branch only comes in when the cashier picked it
	return (
		!row.warehouse ||
		row.warehouse in (scope.companyByWarehouse || {}) ||
		Boolean(row.warehouse_manual)
	);
}

/**
 * Whether the cart can ship from more than one warehouse: the branch has
 * several, or the cashier picked one outside it - mirrors _allocate_rows.
 */
export function needsAllocation(rows, scope) {
	const branch = scope?.companyByWarehouse || {};
	if (!rows?.length) return false;
	return (
		Object.keys(branch).length > 1 ||
		rows.some((row) => row.warehouse_manual && row.warehouse && !(row.warehouse in branch))
	);
}

/**
 * Session warehouse first, then the rest by stock. A warehouse the cashier
 * picked by hand goes in front when `pickedFirst` (store_stock_first off); one
 * outside the branch otherwise joins the end - mirrors _allocate_rows.
 */
function warehouseOrder(stockByWarehouse, scope, picked = null, pickedFirst = false) {
	const branch = Object.keys(scope.companyByWarehouse || {});
	const others = branch
		.filter((wh) => wh !== scope.native)
		.sort((a, b) => (Number(stockByWarehouse[b]) || 0) - (Number(stockByWarehouse[a]) || 0));
	const order = branch.includes(scope.native) ? [scope.native, ...others] : others;
	if (!picked) return order;
	const withPicked = order.includes(picked) ? order : [...order, picked];
	return pickedFirst ? [picked, ...withPicked.filter((wh) => wh !== picked)] : withPicked;
}

/**
 * Split `qty` (row UOM) over warehouses in order, drawing from `remaining`
 * (stock UOM, mutated). Shortfall stays on the first warehouse.
 * @returns {Array<{warehouse: string, qty: number}>}
 */
export function allocateQty(qty, factor, warehouses, remaining) {
	const chunks = [];
	let left = qty;
	for (const warehouse of warehouses) {
		if (left <= 0) break;
		const take = Math.min(left, Math.max(0, (Number(remaining[warehouse]) || 0) / factor));
		if (take <= 0) continue;
		chunks.push({ warehouse, qty: take });
		remaining[warehouse] = (Number(remaining[warehouse]) || 0) - take * factor;
		left -= take;
	}
	if (left > 0 && warehouses.length) {
		const first = chunks.find((chunk) => chunk.warehouse === warehouses[0]);
		if (first) first.qty += left;
		else chunks.unshift({ warehouse: warehouses[0], qty: left });
		remaining[warehouses[0]] = (Number(remaining[warehouses[0]]) || 0) - left * factor;
	}
	return chunks;
}

/**
 * @param {Array<Object>} rows - posCart invoiceItems
 * @param {SaleScope} scope
 * @param {(itemCode: string) => Object<string, number>} stockOf - stock UOM per branch warehouse
 * @param {{storeStockFirst?: boolean, allocation?: Array<Array<{warehouse: string, qty: number}>>}} [options]
 *   POS Settings.store_stock_first, and the server's allocation per row of `rows`
 * @returns {{
 *   rows: Map<string, Array<{warehouse: string, qty: number, company: string, abbr: string}>>,
 *   groups: Array<{company: string, abbr: string, amount: number}>,
 *   company: string,
 *   native: string
 * }} `company` / `native` are the session's own (POS Profile) company / warehouse
 */
export function previewSaleSplit(
	rows,
	scope,
	stockOf,
	{ storeStockFirst = false, allocation = null } = {}
) {
	const companyByWarehouse = scope?.companyByWarehouse || {};
	const result = {
		rows: new Map(),
		groups: [],
		company: scope?.company || null,
		native: scope?.native || null,
	};
	if (!needsAllocation(rows, scope)) return result;

	const remaining = {};
	const groups = new Map();

	rows.forEach((row, index) => {
		const qty = Number(row.quantity ?? row.qty) || 0;
		const factor = Number(row.conversion_factor) || 1;
		let chunks;
		if (allocation?.[index]?.length) {
			chunks = allocation[index];
		} else if (qty > 0 && isAutoAllocated(row, scope)) {
			if (!remaining[row.item_code])
				remaining[row.item_code] = { ...(stockOf(row.item_code) || {}) };
			const picked = row.warehouse_manual ? row.warehouse : null;
			// Outside the branch: its own stock is checked on submit, as on the server
			if (picked && !(picked in remaining[row.item_code]))
				remaining[row.item_code][picked] = Number.POSITIVE_INFINITY;
			chunks = allocateQty(
				qty,
				factor,
				warehouseOrder(remaining[row.item_code], scope, picked, !storeStockFirst),
				remaining[row.item_code]
			);
		} else {
			// An SPG order row keeps the split the order locked (loadPosOrder)
			chunks = row.pos_order_chunks || [{ warehouse: row.warehouse, qty }];
		}

		const amount = Number(row.amount) || 0;
		// Add ons bill with the row's first chunk, as on the server.
		const addons = (row.addons || []).reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
		const withCompany = chunks.map((chunk, index) => {
			const info = companyByWarehouse[chunk.warehouse] ||
				(chunk.company && { company: chunk.company, abbr: chunk.abbr || "" }) || {
					company: scope.company,
					abbr: companyByWarehouse[scope.native]?.abbr || "",
				};
			const group = groups.get(info.company) || { ...info, amount: 0 };
			group.amount += (qty ? (amount * chunk.qty) / qty : 0) + (index ? 0 : addons);
			groups.set(info.company, group);
			return { ...chunk, ...info };
		});
		result.rows.set(saleRowKey(row), withCompany);
	});

	result.groups = [...groups.values()].sort(
		(a, b) => (a.company !== scope.company) - (b.company !== scope.company)
	);
	return result;
}

/**
 * What the cart shows a sale ships from, as `[[item_code, warehouse, stock_qty]]`
 * - the server refuses the sale when its allocation differs (check_allocation).
 * Null when the session sells from one warehouse only.
 */
export function expectedAllocation(rows, split) {
	if (!split.rows.size) return null;
	return rows.flatMap((row) => {
		const factor = Number(row.conversion_factor) || 1;
		return (split.rows.get(saleRowKey(row)) || [])
			.filter((chunk) => chunk.qty > 0)
			.map((chunk) => [row.item_code, chunk.warehouse, chunk.qty * factor]);
	});
}

/**
 * Submission rows (formatItemsForSubmission) grouped per company of a
 * previewSaleSplit result - for the temporary receipts printed offline.
 * Add on rows follow their base row's first chunk, as on the server.
 *
 * @returns {Array<{company: string, abbr: string, items: Array<Object>}>} session company first
 */
export function splitSubmissionItems(items, split) {
	const groups = new Map();
	const sessionAbbr = split.groups.find((g) => g.company === split.company)?.abbr || "";
	const push = (company, abbr, row) => {
		if (!groups.has(company)) groups.set(company, { company, abbr, items: [] });
		groups.get(company).items.push(row);
	};
	const baseOf = {};
	const rowsPerKey = new Map();
	for (const row of items || []) {
		if (row.custom_addon_parent_key) continue;
		rowsPerKey.set(saleRowKey(row), (rowsPerKey.get(saleRowKey(row)) || 0) + 1);
	}

	for (const row of items || []) {
		if (row.custom_addon_parent_key) continue;
		const qty = Number(row.qty) || 0;
		const fallback = [
			{ company: split.company, abbr: sessionAbbr, warehouse: row.warehouse, qty },
		];
		let chunks = split.rows.get(saleRowKey(row)) || fallback;
		// An SPG order line is submitted as one row per warehouse already
		if (rowsPerKey.get(saleRowKey(row)) > 1) {
			const own = chunks.find((chunk) => chunk.warehouse === row.warehouse);
			chunks = own ? [{ ...own, qty }] : fallback;
		}
		// Chunks follow the cart quantity; a bundled free qty is billed on its own row
		const chunkTotal = chunks.reduce((sum, c) => sum + c.qty, 0) || 1;
		chunks.forEach((chunk, index) => {
			const share = chunk.qty / chunkTotal;
			push(chunk.company, chunk.abbr, {
				...row,
				warehouse: chunk.warehouse,
				qty: qty * share,
				discount_amount: (Number(row.discount_amount) || 0) * share,
			});
			if (index === 0 && row.custom_addon_key) baseOf[row.custom_addon_key] = chunk;
		});
	}
	for (const row of items || []) {
		if (!row.custom_addon_parent_key) continue;
		const base = baseOf[row.custom_addon_parent_key] || {
			company: split.company,
			abbr: sessionAbbr,
		};
		push(base.company, base.abbr, row);
	}

	return [...groups.values()].sort(
		(a, b) => (a.company !== split.company) - (b.company !== split.company)
	);
}
