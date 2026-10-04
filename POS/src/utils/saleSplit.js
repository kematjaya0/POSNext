/**
 * Preview of how a basket splits across the branch's warehouses and companies.
 *
 * The server decides the final allocation when the sale is submitted
 * (pos_next/api/split_invoice.py); this mirrors it closely enough for the cart
 * to show where each row ships from and how many invoices the sale becomes.
 * The one difference: the server orders the non-session warehouses by oldest
 * restock, the preview by most stock.
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
	if (row.warehouse_manual || row.pos_order_row) return false;
	if (row.batch_no || row.serial_no) return false;
	return !row.warehouse || row.warehouse in (scope.companyByWarehouse || {});
}

function warehouseOrder(stockByWarehouse, scope) {
	const branch = Object.keys(scope.companyByWarehouse || {});
	const others = branch
		.filter((wh) => wh !== scope.native)
		.sort((a, b) => (Number(stockByWarehouse[b]) || 0) - (Number(stockByWarehouse[a]) || 0));
	return branch.includes(scope.native) ? [scope.native, ...others] : others;
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
 * @returns {{
 *   rows: Map<string, Array<{warehouse: string, qty: number, company: string, abbr: string}>>,
 *   groups: Array<{company: string, abbr: string, amount: number}>,
 *   company: string
 * }} `company` is the session's own (POS Profile) company
 */
export function previewSaleSplit(rows, scope, stockOf) {
	const companyByWarehouse = scope?.companyByWarehouse || {};
	const result = { rows: new Map(), groups: [], company: scope?.company || null };
	if (!rows?.length || Object.keys(companyByWarehouse).length < 2) return result;

	const remaining = {};
	const groups = new Map();

	for (const row of rows) {
		const qty = Number(row.quantity ?? row.qty) || 0;
		const factor = Number(row.conversion_factor) || 1;
		let chunks;
		if (qty > 0 && isAutoAllocated(row, scope)) {
			if (!remaining[row.item_code])
				remaining[row.item_code] = { ...(stockOf(row.item_code) || {}) };
			chunks = allocateQty(
				qty,
				factor,
				warehouseOrder(remaining[row.item_code], scope),
				remaining[row.item_code]
			);
		} else {
			chunks = [{ warehouse: row.warehouse, qty }];
		}

		const amount = Number(row.amount) || 0;
		// Add ons bill with the row's first chunk, as on the server.
		const addons = (row.addons || []).reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
		const withCompany = chunks.map((chunk, index) => {
			const info = companyByWarehouse[chunk.warehouse] || {
				company: scope.company,
				abbr: companyByWarehouse[scope.native]?.abbr || "",
			};
			const group = groups.get(info.company) || { ...info, amount: 0 };
			group.amount += (qty ? (amount * chunk.qty) / qty : 0) + (index ? 0 : addons);
			groups.set(info.company, group);
			return { ...chunk, ...info };
		});
		result.rows.set(saleRowKey(row), withCompany);
	}

	result.groups = [...groups.values()].sort(
		(a, b) => (a.company !== scope.company) - (b.company !== scope.company)
	);
	return result;
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

	for (const row of items || []) {
		if (row.custom_addon_parent_key) continue;
		const qty = Number(row.qty) || 0;
		const chunks = split.rows.get(saleRowKey(row)) || [
			{ company: split.company, abbr: sessionAbbr, warehouse: row.warehouse, qty },
		];
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
