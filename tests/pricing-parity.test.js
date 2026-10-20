// Confronta il motore prezzi JS (js/pricing.js) con quello SQL (bl_compute_order) su casi casuali.
// Uso: node tests/pricing-parity.test.js "<comando psql>"
const { execSync } = require('child_process');
const crypto = require('crypto');
const P = require('../js/pricing.js');
const PSQL = process.argv[2];
let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[ri(0, arr.length - 1)];
const money = () => Math.round((10 + rnd() * 90) * 100) / 100;
const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const cases = []; let sql = 'begin;\n';
for (let i = 0; i < 400; i++) {
  const sid = 'tst_' + i;
  const rules = {
    tier_basis: pick(['product', 'order']),
    surcharge: { new: [{ max: 1, mult: pick([2, 1.8]) }, { max: 4, mult: 1.5 }, { max: ri(5, 12), mult: pick([1.25, 1.1, 1.33]) }], reorder: pick([[], [{ max: 1, mult: 1.5 }, { max: 4, mult: 1.25 }]]) },
    setup_fee: { new: pick([150, 0, 99.99]), modified: 80, reorder: pick([0, 25]) },
    setup_free_over: pick([1500, 0, 800]),
    extras: [{ id: 'a', name: { it: 'A' }, price: 30 }, { id: 'b', name: { it: 'B' }, price: 49.9 }],
    discount_mode: pick(['cascade', 'sum']), shipping: pick([25, 0, 12.5, { it: 15, eu: 25, extra: 40 }, { it: 15, eu: 25 }]), free_shipping_over: pick([3000, 0, 500]),
    vat: pick([22, 10, 0]), deposit: pick([50, 30, 100])
  };
  const products = [];
  for (let k = 0; k < ri(1, 5); k++) {
    const t1 = money();
    products.push({ id: crypto.randomUUID(), sport_id: sid, sku: 'S' + i + '-' + k, name: { it: 'P' + k }, sort: k, tiers: pick([[{ min: 10, price: t1 }, { min: 30, price: Math.round(t1 * 95) / 100 }, { min: 60, price: Math.round(t1 * 92) / 100 }], [{ min: 1, price: t1 }], [{ min: 5, price: t1 }, { min: 25, price: Math.round(t1 * 90) / 100 }]]) });
  }
  const lines = [];
  for (let k = 0; k < ri(0, 8); k++) lines.push({ product_id: pick(products).id, group: pick(['M', 'W', 'U']), size: pick(['S', 'M', 'L']), qty: pick([0, 1, 2, 3, 4, 5, 7, 9, 10, 11, 29, 30, 45, 60, 120, '3', -2]) });
  if (rnd() < .1) lines.push({ product_id: crypto.randomUUID(), group: 'M', size: 'M', qty: 5 }); // prodotto inesistente
  const options = { discount: pick([0, 5, 10, 15, 12.5]), sponsor: pick([0, 5, 10]), extras: { a: ri(0, 3), b: ri(0, 2) } };
  if (rnd() < .3) options.shipping = pick([0, 40, 17.35, null]);
  const type = pick(['new', 'reorder', 'modified']); const regime = pick(['it', 'eu_reverse', 'extra_eu']); const country = pick(['IT', '', 'DE', 'FR', 'CH', 'US', 'sm', 'GB']);
  cases.push({ sid, rules, products, lines, options, type, regime, country });
  sql += `insert into sports(id, rules) values (${q(sid)}, ${q(JSON.stringify(rules))}::jsonb);\n`;
  for (const p of products) sql += `insert into products(id, sport_id, sku, name, tiers, sort) values (${q(p.id)}, ${q(sid)}, ${q(p.sku)}, ${q(JSON.stringify(p.name))}::jsonb, ${q(JSON.stringify(p.tiers))}::jsonb, ${p.sort});\n`;
}
sql += 'select json_agg(r order by n) from (' + cases.map((c, n) => `select ${n} n, bl_compute_order(${q(JSON.stringify(c.lines))}::jsonb, ${q(JSON.stringify(c.options))}::jsonb, ${q(c.type)}, ${q(c.sid)}, ${q(c.regime)}, ${q(c.country)}) r`).join(' union all ') + ') x;\nrollback;\n';
require('fs').writeFileSync('/tmp/blpg/parity.sql', sql);
const out = execSync(`${PSQL} -Atq -f /tmp/blpg/parity.sql`, { maxBuffer: 1e8 }).toString().trim().split('\n').filter(l => l.startsWith('['))[0];
const res = JSON.parse(out);
const KEYS = ['shipping_zone', 'qty', 'goods', 'setup', 'setup_waived', 'extras', 'gross', 'discount', 'sponsor', 'net', 'shipping', 'shipping_free', 'taxable', 'vat_rate', 'vat', 'total', 'deposit'];
let bad = 0;
cases.forEach((c, n) => {
  const js = P.computeOrder({ order_type: c.type, lines: c.lines, options: c.options }, c.products, c.rules, c.regime, c.country);
  const db = res[n];
  const diffs = KEYS.filter(k => k === 'shipping_zone' ? js[k] !== db[k] : Number(js[k]) !== Number(db[k]));
  const lineDiff = js.lines.length !== db.lines.length || js.lines.some((l, i) => l.product_id !== db.lines[i].product_id || l.qty !== db.lines[i].qty || l.unit !== Number(db.lines[i].unit) || l.total !== Number(db.lines[i].total) || l.mult !== Number(db.lines[i].mult));
  if (diffs.length || lineDiff) { bad++; if (bad < 5) console.log('DIFF case', n, diffs, diffs.map(k => [js[k], db[k]]), lineDiff ? { js: js.lines, db: db.lines } : ''); }
});
console.log(`casi: ${cases.length}, con importo > 0: ${res.filter(r => r.total > 0).length}, con maggiorazione: ${res.filter(r => r.lines.some(l => l.mult != 1)).length}, differenze: ${bad}`);
process.exit(bad ? 1 : 0);
