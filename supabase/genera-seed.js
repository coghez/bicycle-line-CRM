// Genera supabase/02_seed.sql dai dati in js/seed.js
const path = require('path'); global.window = {};
require(path.resolve('js/catalog-data.js'));
require(path.resolve('js/seed.js'));
const S = window.BLSeed;
const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const j = (v) => q(JSON.stringify(v)) + '::jsonb';
let out = `-- BICYCLE LINE STUDIO — dati iniziali: 5 sport con regole commerciali + catalogo prodotti dei 5 sport (con foto) e prezzi Running 2027.
-- Sicuro da rieseguire: non sovrascrive sport/prodotti già esistenti.\n\n`;
for (const s of S.SPORTS) out += `insert into public.sports (id, name, code, color, season, sort, active, rules) values (${q(s.id)}, ${j(s.name)}, ${q(s.code)}, ${q(s.color)}, ${q(s.season)}, ${s.sort}, true, ${j(s.rules)}) on conflict (id) do nothing;\n`;
out += '\n';
for (const p of S.PRODUCTS) out += `insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values (${q(p.sport_id)}, ${q(p.sku)}, ${j(p.name)}, ${q(p.category)}, ${q(p.gender)}, ${p.kids}, ${j(p.sizes)}, ${j(p.tiers)}, true, ${p.sort}, ${q(p.image || '')}, ${q(p.notes || '')}) on conflict (sport_id, lower(sku)) do nothing;\n`;
require('fs').writeFileSync('supabase/02_seed.sql', out);
console.log('ok', S.SPORTS.length, S.PRODUCTS.length);

// impostazioni aziendali iniziali (solo se non già compilate)
require('fs').appendFileSync('supabase/02_seed.sql', `\nupdate public.app_settings set data = data || ${j(Object.fromEntries(Object.entries(S.SETTINGS).filter(([k, v]) => v !== '' && k !== 'logo')))} where id = 1 and coalesce(data->>'company_address', '') = '';\n`);
