/* Bicycle Line Studio — motore prezzi.
 * Funzione pura, identica alla versione SQL (supabase/01_schema.sql → bl_compute_order).
 * Se modifichi una regola qui, modificala anche lì: i test in tests/ confrontano le due versioni.
 */
(function (root) {
  'use strict';

  // Arrotondamento al centesimo, metà per eccesso (come round(numeric,2) di Postgres per valori positivi)
  const r2 = (x) => {
    const n = Number(x) || 0;
    const s = n < 0 ? -1 : 1;
    return (s * Math.round(+(Math.abs(n) * 100).toFixed(6))) / 100;
  };

  const DEFAULT_RULES = {
    tier_basis: 'product',            // 'product' = fascia per singolo articolo, 'order' = sul totale pezzi dell'ordine
    surcharge: {                      // maggiorazioni sotto la prima fascia (moltiplicatori sul prezzo base)
      new: [{ max: 1, mult: 2 }, { max: 4, mult: 1.5 }, { max: 9, mult: 1.25 }],
      reorder: [{ max: 1, mult: 1.5 }, { max: 4, mult: 1.25 }]
    },
    setup_fee: { new: 150, modified: 80, reorder: 0 },
    setup_free_over: 1500,            // impianto gratuito se merce > soglia (0 = mai gratuito)
    extras: [],
    discount_mode: 'cascade',         // 'cascade' = sconto sponsor sul netto dopo sconto commerciale; 'sum' = entrambi sul lordo
    discount_options: [0, 5, 10, 15],
    sponsor_options: [0, 5, 10, 15],
    shipping: { it: 15, eu: 25, extra: 25 }, // trasporto per zona di consegna (Italia / UE / extra UE)
    free_shipping_over: 3000,         // 0 = mai gratuito
    vat: 22,
    deposit: 50
  };

  const EU = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'];
  /** Zona di spedizione dal paese del cliente: 'it' (anche vuoto, San Marino, Vaticano) | 'eu' | 'extra' */
  function shippingZone(country) {
    const c = String(country || '').trim().toUpperCase();
    if (!c || c === 'IT' || c === 'SM' || c === 'VA') return 'it';
    return EU.includes(c) ? 'eu' : 'extra';
  }
  /** Tariffe per zona; accetta anche il vecchio formato (un solo numero per tutte le zone). */
  function shippingTable(s) {
    if (s && typeof s === 'object') return { it: Number(s.it) || 0, eu: Number(s.eu) || 0, extra: Number(s.extra ?? s.eu) || 0 };
    const n = Number(s); return { it: n || 0, eu: n || 0, extra: n || 0 };
  }

  function rulesWithDefaults(r) {
    const out = Object.assign({}, DEFAULT_RULES, r || {});
    out.surcharge = Object.assign({}, DEFAULT_RULES.surcharge, (r && r.surcharge) || {});
    out.setup_fee = Object.assign({}, DEFAULT_RULES.setup_fee, (r && r.setup_fee) || {});
    out.shipping = shippingTable(r && r.shipping !== undefined ? r.shipping : DEFAULT_RULES.shipping);
    return out;
  }

  /** Prezzo unitario per una quantità di riferimento. */
  function unitPrice(product, tierQty, orderType, rules) {
    const tiers = (product.tiers || []).filter(t => Number(t.price) > 0).slice().sort((a, b) => a.min - b.min);
    if (!tiers.length || tierQty <= 0) return { price: 0, mult: 1, tier: null };
    let chosen = null;
    for (const t of tiers) if (tierQty >= Number(t.min)) chosen = t;
    if (chosen) return { price: r2(chosen.price), mult: 1, tier: chosen };
    // sotto la prima fascia: maggiorazione
    const table = (orderType === 'reorder' ? rules.surcharge.reorder : rules.surcharge.new) || [];
    let mult = 1;
    for (const s of table.slice().sort((a, b) => a.max - b.max)) {
      if (tierQty <= Number(s.max)) { mult = Number(s.mult); break; }
    }
    return { price: r2(Number(tiers[0].price) * mult), mult, tier: tiers[0] };
  }

  /**
   * Calcola un ordine.
   * order: { order_type, lines:[{product_id, group, size, qty}], options:{discount, sponsor, extras:{id:qty}, shipping}, }
   * products: array prodotti dello sport. rules: regole dello sport. vatRegime: 'it' | 'eu_reverse' | 'extra_eu'
   * country: paese di consegna del cliente (determina la tariffa di trasporto)
   */
  function computeOrder(order, products, rawRules, vatRegime, country) {
    const rules = rulesWithDefaults(rawRules);
    const type = order.order_type || 'new';
    const opt = order.options || {};
    const byId = new Map(products.map(p => [p.id, p]));

    // raggruppa righe per prodotto
    const groups = new Map();
    for (const l of order.lines || []) {
      const q = Math.max(0, Math.floor(Number(l.qty) || 0));
      if (!q || !byId.has(l.product_id)) continue;
      if (!groups.has(l.product_id)) groups.set(l.product_id, []);
      groups.get(l.product_id).push({ group: l.group || 'U', size: l.size, qty: q });
    }
    const totalQty = [...groups.values()].flat().reduce((a, x) => a + x.qty, 0);

    const lines = [];
    let goods = 0;
    for (const p of products) {           // ordine stabile = ordine catalogo
      const items = groups.get(p.id);
      if (!items) continue;
      const qty = items.reduce((a, x) => a + x.qty, 0);
      const tierQty = rules.tier_basis === 'order' ? totalQty : qty;
      const u = unitPrice(p, tierQty, type, rules);
      const total = r2(u.price * qty);
      goods = r2(goods + total);
      lines.push({ product_id: p.id, sku: p.sku || '', name: p.name, qty, unit: u.price, mult: u.mult, total, sizes: items });
    }

    let setup = totalQty > 0 ? Number(rules.setup_fee[type] || 0) : 0;
    const setupWaived = setup > 0 && Number(rules.setup_free_over) > 0 && goods > Number(rules.setup_free_over);
    if (setupWaived) setup = 0;

    const extrasLines = [];
    let extras = 0;
    for (const e of rules.extras || []) {
      const q = Math.max(0, Math.floor(Number((opt.extras || {})[e.id]) || 0));
      if (!q) continue;
      const t = r2(Number(e.price) * q);
      extras = r2(extras + t);
      extrasLines.push({ id: e.id, name: e.name, qty: q, unit: Number(e.price), total: t });
    }

    const gross = r2(goods + setup + extras);
    const dPct = Math.min(100, Math.max(0, Number(opt.discount) || 0));
    const sPct = Math.min(100, Math.max(0, Number(opt.sponsor) || 0));
    const discount = r2(gross * dPct / 100);
    const sponsor = rules.discount_mode === 'sum' ? r2(gross * sPct / 100) : r2((gross - discount) * sPct / 100);
    const net = Math.max(0, r2(gross - discount - sponsor));

    const zone = shippingZone(country);
    const baseShipping = (opt.shipping === undefined || opt.shipping === null || opt.shipping === '') ? rules.shipping[zone] : Math.max(0, Number(opt.shipping) || 0);
    const freeOver = Number(rules.free_shipping_over) || 0;
    const shippingFree = net > 0 && freeOver > 0 && net > freeOver;
    const shipping = net > 0 && !shippingFree ? r2(baseShipping) : 0;

    const taxable = r2(net + shipping);
    const vatRate = (vatRegime || 'it') === 'it' ? Number(rules.vat) : 0;
    const vat = r2(taxable * vatRate / 100);
    const total = r2(taxable + vat);
    const deposit = r2(total * Number(rules.deposit) / 100);

    return {
      lines, extras_lines: extrasLines, qty: totalQty,
      goods, setup, setup_waived: setupWaived, extras, gross,
      discount_pct: dPct, discount, sponsor_pct: sPct, sponsor, net,
      shipping, shipping_free: shippingFree, shipping_zone: zone, taxable,
      vat_rate: vatRate, vat, total, deposit_pct: Number(rules.deposit), deposit
    };
  }

  const api = { r2, computeOrder, unitPrice, rulesWithDefaults, shippingZone, shippingTable, EU, DEFAULT_RULES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BLPricing = api;
})(typeof window !== 'undefined' ? window : globalThis);
