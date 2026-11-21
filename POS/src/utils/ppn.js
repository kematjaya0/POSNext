/**
 * PPN badge of the item list. An item is PPN when the stock it would sell is
 * billed to a company whose sales template charges tax (a PKP company, e.g.
 * the PT) - the same rule the cart taxes rows by (useInvoice.rowTaxShares).
 */

/**
 * Companies the branch stock of `item` belongs to. Without stock the sale
 * draws on the session warehouse (allocateQty puts the shortfall there).
 * @param {{stock_by_company?: Object<string, number>}} item - stock per company abbr
 * @param {import("./saleSplit").SaleScope} scope
 * @returns {string[]}
 */
export function stockCompanies(item, scope) {
	const byWarehouse = scope?.companyByWarehouse || {};
	const companyByAbbr = {};
	for (const info of Object.values(byWarehouse)) {
		if (info?.abbr) companyByAbbr[info.abbr] = info.company;
	}
	const companies = Object.entries(item?.stock_by_company || {})
		.filter(([abbr, qty]) => Number(qty) > 0 && companyByAbbr[abbr])
		.map(([abbr]) => companyByAbbr[abbr]);
	if (companies.length) return companies;
	const native = byWarehouse[scope?.native]?.company || scope?.company;
	return native ? [native] : [];
}

/**
 * @param {Object} item - item list entry
 * @param {import("./saleSplit").SaleScope} scope
 * @param {(company: string) => boolean} isTaxedCompany
 */
export function itemHasPpn(item, scope, isTaxedCompany) {
	return stockCompanies(item, scope).some(isTaxedCompany);
}
