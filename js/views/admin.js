/* Amministrazione: prodotti e prezzi, regole commerciali, utenti, impostazioni */
(function () {
  'use strict';
  const { t, esc, ic, fmt, S, store } = BL;
  const LANG_IDS = () => BL.LANGS.map(l => l.id);
  const GENDERS = ['both', 'men', 'women', 'unisex'];
  const SIZE_PRESETS = {
    adult: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'],
    women: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
    kids: ['4A', '6A', '8A', '10A', '12A', '14A'],
    junior: ['XS', 'S', 'M', 'L', 'XL'],
    one: ['TU']
  };
  const reload = async () => { await BL.loadAll(); BL.render(); };

  // ================= PRODOTTI E PREZZI =================
  // ---------- Listino TEAM 2027 (js/listino-2027.js): stessi prezzi del preventivatore ----------
  const SPORT_LABEL = { cycling: 'Ciclismo', running: 'Running', triathlon: 'Triathlon', speed_skating: 'Pattinaggio', rowing: 'Canottaggio' };
  const eurSigned = (a) => (a >= 0 ? '+' : '−') + fmt.eur(Math.abs(a));
  const tiersKey = (tt) => JSON.stringify((tt || []).filter(x => Number(x.price) > 0).map(x => ({ min: Number(x.min), price: Math.round(Number(x.price) * 100) / 100 })).sort((a, b) => a.min - b.min));
  function listinoNote(e, oldNotes) {
    const keep = String(oldNotes || '').split('\n').filter(l => l.trim() && !/^Listino TEAM 2027/i.test(l.trim()) && !/^Prezzi dal listino Excel/i.test(l.trim()));
    const opts = (e.options || []).length ? ' Supplementi: ' + e.options.map(o => o.label + ' ' + eurSigned(o.amount)).join('; ') + '.' : '';
    return ['Listino TEAM 2027 (' + e.source + ').' + opts, ...keep].join('\n');
  }
  function listinoChanges() {
    const L = window.BLListino2027; if (!L) return [];
    const out = [];
    for (const e of L.items) {
      const p = S.products.find(x => x.sport_id === e.sport_id && String(x.sku).toUpperCase() === e.sku);
      if (!p) { if (e.create && S.sports.some(x => x.id === e.sport_id)) out.push({ kind: 'new', e }); continue; }
      if (tiersKey(p.tiers) !== tiersKey(e.tiers)) out.push({ kind: 'price', e, p });
    }
    return out;
  }
  BL.listinoChanges = listinoChanges;
  function listinoBanner() {
    const L = window.BLListino2027; if (!L) return '';
    const ch = listinoChanges();
    if (!ch.length) return `<div class="hint" style="margin:0 0 12px">${ic('check')} Prezzi allineati al <b>listino TEAM ${esc(L.season)}</b> e al preventivatore (${L.items.length} articoli). Canottaggio: prezzi non ancora presenti nei listini.</div>`;
    const nP = ch.filter(x => x.kind === 'price').length, nN = ch.length - nP;
    return `<div class="card" style="margin-bottom:14px;border-color:var(--warn)"><div class="card-b row wrap" style="gap:12px">
      <div class="grow"><b>Listino TEAM ${esc(L.season)}</b><div class="hint">${nP ? nP + ' prodotti con prezzi diversi o mancanti' : ''}${nP && nN ? ' · ' : ''}${nN ? nN + ' articoli del preventivatore da aggiungere' : ''}. Dopo l'allineamento, CRM e preventivatore usano gli stessi prezzi.</div></div>
      <button class="btn" data-act="listino">${ic('check')}Controlla e allinea</button></div></div>`;
  }
  // Applicazione automatica: al primo accesso di un amministratore dopo l'aggiornamento il CRM scrive da solo
  // i prezzi del listino nei Prodotti. Lo fa una volta per versione del listino (segno in app_settings),
  // così le modifiche manuali fatte dopo nei Prodotti restano.
  let autoRunning = false, autoFailed = false;
  async function applyListinoChanges(ch) {
    for (const x of ch) {
      const tiers = x.e.tiers.map(tr => ({ min: tr.min, price: tr.price }));
      if (x.kind === 'price') await store.saveProduct(Object.assign({}, x.p, { tiers, notes: listinoNote(x.e, x.p.notes) }));
      else await store.saveProduct(Object.assign({ sport_id: x.e.sport_id, sku: x.e.sku, active: true, notes: listinoNote(x.e, '') }, JSON.parse(JSON.stringify(x.e.create)), { tiers }));
    }
  }
  BL.autoListino = async () => {
    const L = window.BLListino2027;
    if (!L || autoRunning || autoFailed || !BL.isAdmin() || (S.settings || {}).listino_applied === L.version) return;
    autoRunning = true;
    try {
      const ch = listinoChanges();
      if (ch.length) { BL.toast('Aggiornamento prezzi listino TEAM ' + L.season + ' in corso…'); await applyListinoChanges(ch); }
      await store.saveSettings(Object.assign({}, S.settings, { listino_applied: L.version }));
      await BL.loadAll(); BL.render();
      if (ch.length) BL.toast('Prezzi listino TEAM ' + L.season + ' applicati: ' + ch.length + ' prodotti aggiornati');
    } catch (e) { autoFailed = true; console.warn('Listino automatico non applicato', e); BL.toast('Prezzi listino non applicati automaticamente: usa «Controlla e allinea» in Prodotti e prezzi.'); }
    finally { autoRunning = false; }
  };
  // Numerazione preventivi: se sul database manca la funzione, l'amministratore vede un riquadro con lo script
  // già pronto da copiare in Supabase (una sola volta).
  let numChecked = false;
  BL.checkQuoteNumbering = async (force) => {
    if (!BL.isAdmin() || !store.hasQuoteNumbering || (numChecked && !force)) return;
    numChecked = true;
    let okNum = true; try { okNum = await store.hasQuoteNumbering(); } catch (e) { return; }
    document.getElementById('bl-num-setup')?.remove();
    if (okNum) return;
    const ref = (() => { try { return new URL(window.BL_CONFIG.supabaseUrl).hostname.split('.')[0]; } catch (e) { return ''; } })();
    const box = document.createElement('div');
    box.id = 'bl-num-setup';
    box.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:9000;max-width:430px;background:#fff;border:1px solid #e6c47a;box-shadow:0 10px 40px #0002;border-radius:12px;padding:16px 18px;font-size:13px;line-height:1.5';
    box.innerHTML = `<b>Numero preventivo automatico (01.26, 02.26…)</b>
      <div class="hint" style="margin:6px 0 10px">Per attivarlo serve un piccolo aggiornamento del database, una volta sola:<br>
      1) premi <b>Copia script</b> · 2) premi <b>Apri Supabase</b> · 3) incolla (Ctrl+V) e premi <b>Run</b> · 4) torna qui e premi <b>Fatto</b>.</div>
      <div class="row wrap" style="gap:6px"><button class="btn sm" data-n="copy">Copia script</button>
      <a class="btn sm ghost" target="_blank" rel="noopener" href="https://supabase.com/dashboard/project/${esc(ref)}/sql/new">Apri Supabase</a>
      <button class="btn sm ghost" data-n="done">Fatto</button><button class="btn sm ghost" data-n="later">Più tardi</button></div>`;
    document.body.appendChild(box);
    box.querySelector('[data-n=copy]').onclick = async () => {
      try { await navigator.clipboard.writeText(window.BL_SQL_NUMERI || ''); BL.toast('Script copiato: incollalo in Supabase e premi Run'); }
      catch (e) { prompt('Copia tutto il testo:', window.BL_SQL_NUMERI || ''); }
    };
    box.querySelector('[data-n=later]').onclick = () => box.remove();
    box.querySelector('[data-n=done]').onclick = async () => {
      const ok2 = await store.hasQuoteNumbering().catch(() => false);
      if (ok2) { box.remove(); BL.toast('Numerazione preventivi attiva: il prossimo sarà assegnato al salvataggio'); }
      else BL.toast('Non ancora attiva: controlla di aver premuto Run in Supabase (deve dire «Success»)');
    };
  };

  function openListinoSync() {
    const ch = listinoChanges();
    const tierTxt = (tt) => (tt || []).length ? `<div class="tiers">${tt.slice().sort((a, b) => a.min - b.min).map(x => `<span class="tier">${x.min}+ ${fmt.eur(x.price)}</span>`).join('')}</div>` : `<span class="noprice">${esc(t('catalog.priceTbd'))}</span>`;
    BL.openOverlay({
      kind: 'modal', wide: true, title: 'Allinea prezzi al listino TEAM 2027',
      sub: 'Fonte: listini Excel 2027 (ciclismo, running, triathlon, pattinaggio) = prezzi del preventivatore',
      body: `<div class="tablewrap"><table class="t"><thead><tr><th>Sport</th><th>SKU</th><th>${esc(t('orders.article'))}</th><th>Attuale</th><th>Listino 2027</th><th></th></tr></thead><tbody>${ch.map(x => `<tr><td>${esc(SPORT_LABEL[x.e.sport_id] || x.e.sport_id)}</td><td class="mono">${esc(x.e.sku)}</td><td>${esc(x.p ? BL.pname(x.p, 'it') : x.e.create.name.it)}<div class="cell-sub">${esc(x.e.desc)}</div></td><td>${x.p ? tierTxt(x.p.tiers) : '—'}</td><td>${tierTxt(x.e.tiers)}</td><td>${x.kind === 'new' ? `<span class="pill plain st-shipped">${esc(t('admin.new'))}</span>` : `<span class="pill plain st-submitted">${esc(t('admin.update'))}</span>`}</td></tr>`).join('')}</tbody></table></div>`,
      foot: `<button class="btn ghost" data-close>${esc(t('common.cancel'))}</button><button class="btn" data-act="go">${ic('check')}Aggiorna ${ch.length} prodotti</button>`,
      onMount: (o) => o.el.querySelector('[data-act=go]').addEventListener('click', async () => {
        const b = o.el.querySelector('[data-act=go]'); b.disabled = true;
        let n = 0;
        try {
          for (const x of ch) {
            b.textContent = 'Aggiornamento ' + (++n) + '/' + ch.length + '…';
            const tiers = x.e.tiers.map(tr => ({ min: tr.min, price: tr.price }));
            if (x.kind === 'price') await store.saveProduct(Object.assign({}, x.p, { tiers, notes: listinoNote(x.e, x.p.notes) }));
            else await store.saveProduct(Object.assign({ sport_id: x.e.sport_id, sku: x.e.sku, active: true, notes: listinoNote(x.e, '') }, JSON.parse(JSON.stringify(x.e.create)), { tiers }));
          }
          o.close(); BL.toast('Listino 2027 applicato: ' + ch.length + ' prodotti aggiornati'); await reload();
        } catch (e) { b.disabled = false; b.textContent = 'Riprova'; BL.fail(e); await BL.loadAll(); }
      })
    });
  }

  BL.route('/admin/products', ({ query }) => {
    const sid = query.sport || 'running';
    const s = BL.sport(sid) || S.sports[0];
    let q = '', bulk = false, draft = null, onlyNoPrice = false;
    const DEF_MINS = [10, 30, 60];
    const all = () => S.products.filter(p => p.sport_id === s.id);
    const missingLangs = (p) => LANG_IDS().filter(l => !(p.name && p.name[l]));

    const rows = () => {
      const list = all().filter(p => (!q || (BL.pname(p) + ' ' + p.sku).toLowerCase().includes(q)) && (!onlyNoPrice || !BL.hasPrice(p)));
      if (!list.length) return `<tr><td colspan="9"><div class="empty"><b>${esc(t('catalog.empty'))}</b>${esc(t('admin.emptyHelp'))}<div class="row mt" style="justify-content:center"><button class="btn" data-act="new">${ic('plus')}${esc(t('admin.newProduct'))}</button><button class="btn ghost" data-act="import">${ic('up')}${esc(t('admin.importCsv'))}</button></div></div></td></tr>`;
      return list.map((p, i) => {
        const miss = missingLangs(p);
        const tiers = p.tiers.slice().sort((a, b) => a.min - b.min);
        const tiersCell = bulk
          ? `<div class="row wrap" style="gap:6px">${draft[p.id].map((x, ti) => `<label class="sz">${x.min}+<input class="price-in" type="number" step="0.01" min="0" data-bulk="${esc(p.id)}" data-ti="${ti}" value="${x.price === '' ? '' : x.price}" placeholder="€"></label>`).join('')}</div>`
          : (tiers.length ? `<div class="tiers">${tiers.map(x => `<span class="tier">${x.min}+ ${fmt.eur(x.price)}</span>`).join('')}</div>` : `<span class="noprice" title="${esc(t('admin.noPriceHint'))}">${esc(t('catalog.priceTbd'))}</span>`);
        return `<tr data-id="${esc(p.id)}" style="${p.active === false ? 'opacity:.55' : ''}">
          <td style="width:30px"><div style="display:grid">${q ? '' : `<button class="x" style="padding:2px" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="su">${ic('arrowup')}</button><button class="x" style="padding:2px" data-move="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="giù">${ic('arrowdown')}</button>`}</div></td>
          <td style="width:64px"><div class="thumb ${p.image ? 'zoom' : ''}" style="width:52px;height:52px" ${p.image ? `data-zoom="${esc(p.id)}"` : ''}>${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : esc((p.sku || '').slice(0, 6))}</div></td>
          <td><div class="cell-title">${esc(BL.pname(p, 'it'))}</div><div class="cell-sub"><span class="mono">${esc(p.sku)}</span> · ${esc(t('cat.' + p.category))}${miss.length ? ` · <span style="color:var(--warn)">${esc(t('admin.missingLangs'))}: ${miss.map(x => x.toUpperCase()).join(' ')}</span>` : ''}</div></td>
          <td>${esc(t('gender.' + p.gender))}${p.kids ? '<br><span class="hint">' + esc(t('product.kids')) + '</span>' : ''}</td>
          <td class="cell-sub" style="max-width:160px;white-space:normal">${esc(p.sizes.join(' '))}</td>
          <td>${tiersCell}</td>
          <td><label class="switch" title="${esc(t('admin.activeToggle'))}"><input type="checkbox" data-active ${p.active !== false ? 'checked' : ''}><span></span></label></td>
          <td class="right nowrap"><button class="btn ghost sm" data-edit>${ic('edit')}</button> <button class="btn ghost sm" data-dup title="${esc(t('admin.duplicate'))}">${ic('copy')}</button></td></tr>`;
      }).join('');
    };

    const bulkBar = () => bulk ? `<div class="card" style="margin-bottom:14px"><div class="card-b row wrap" style="gap:12px">
        <b>${esc(t('admin.bulkTitle'))}</b><span class="hint">${esc(t('admin.bulkHint'))}</span><span class="grow"></span>
        <label class="row hint" style="gap:6px">${esc(t('admin.changePct'))}<input class="inp sm" id="bk-pct" type="number" step="0.5" value="0" style="width:80px"> %</label>
        <label class="row hint" style="gap:6px">${esc(t('admin.roundTo'))}<select class="inp sm" id="bk-round" style="width:90px"><option value="0.01">0,01</option><option value="0.05">0,05</option><option value="0.1" selected>0,10</option><option value="0.5">0,50</option><option value="1">1,00</option></select></label>
        <button class="btn ghost sm" data-act="bk-apply">${ic('percent')}${esc(t('admin.apply'))}</button>
        <button class="btn ghost sm" data-act="bk-cancel">${esc(t('common.cancel'))}</button><button class="btn sm" data-act="bk-save">${ic('check')}${esc(t('admin.savePrices'))}</button></div></div>` : '';

    const body = () => `${listinoBanner()}<div class="toolbar"><div class="tabs">${S.sports.map(x => `<a class="tab ${x.id === s.id ? 'active' : ''}" href="#/admin/products?sport=${x.id}">${esc(BL.tl(x.name))}<span class="n">${S.products.filter(p => p.sport_id === x.id).length}</span></a>`).join('')}</div></div>
      <div class="toolbar"><div class="search">${ic('search')}<input class="inp" id="ap-q" placeholder="${esc(t('catalog.search'))}" value="${esc(q)}"></div>
        <label class="row hint" style="gap:6px"><input type="checkbox" id="ap-np" ${onlyNoPrice ? 'checked' : ''}> ${esc(t('admin.unpricedN', { n: all().filter(p => !BL.hasPrice(p)).length }))}</label><span class="grow"></span>
        <button class="btn ghost" data-act="template">${ic('down')}${esc(t('admin.csvTemplate'))}</button>
        <button class="btn ghost" data-act="export" ${all().length ? '' : 'disabled'}>${ic('down')}${esc(t('admin.exportCsv'))}</button>
        <button class="btn ghost" data-act="import">${ic('up')}${esc(t('admin.importCsv'))}</button>
        <button class="btn ghost" data-act="bulk" ${all().length && !bulk ? '' : 'disabled'}>${ic('percent')}${esc(t('admin.bulkEdit'))}</button></div>
      <div id="ap-bulk">${bulkBar()}</div>
      <div class="card tablewrap"><table class="t"><thead><tr><th></th><th></th><th>${esc(t('orders.article'))}</th><th>${esc(t('product.gender'))}</th><th>${esc(t('product.sizes'))}</th><th>${esc(t('product.tiers'))}</th><th>${esc(t('admin.active'))}</th><th></th></tr></thead><tbody id="ap-body">${rows()}</tbody></table></div>
      <input type="file" id="ap-file" accept=".csv,text/csv" class="hidden">`;

    return {
      title: esc(t('nav.adminProducts')),
      subtitle: `${BL.sportChip(s.id)} <span class="hint">· ${esc(t('catalog.season'))} ${esc(s.season || '—')} · <a href="#/admin/pricing?sport=${s.id}">${esc(t('admin.rulesLink'))}</a></span>`,
      titleText: t('nav.adminProducts'),
      actions: `<button class="btn" data-act="new">${ic('plus')}${esc(t('admin.newProduct'))}</button>`,
      body: body(),
      mount: (v, actions) => {
        const redraw = () => { v.innerHTML = body(); bind(); };
        const bind = () => {
          const qi = v.querySelector('#ap-q');
          qi.addEventListener('input', e => { q = e.target.value.toLowerCase().trim(); v.querySelector('#ap-body').innerHTML = rows(); bindRows(); });
          v.querySelector('#ap-np').addEventListener('change', e => { onlyNoPrice = e.target.checked; v.querySelector('#ap-body').innerHTML = rows(); bindRows(); });
          v.querySelectorAll('[data-act=new]').forEach(b => b.addEventListener('click', () => editProduct(null, s)));
          v.querySelectorAll('[data-act=import]').forEach(b => b.addEventListener('click', () => v.querySelector('#ap-file').click()));
          v.querySelectorAll('[data-act=listino]').forEach(b => b.addEventListener('click', openListinoSync));
          v.querySelector('[data-act=template]').addEventListener('click', () => BL.download(`modello-listino-${s.id}.csv`, BL.toCSV(csvRows(s, true)), 'text/csv;charset=utf-8'));
          v.querySelector('[data-act=export]').addEventListener('click', () => BL.download(`listino-${s.id}-${s.season || ''}.csv`, BL.toCSV(csvRows(s, false)), 'text/csv;charset=utf-8'));
          v.querySelector('#ap-file').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) importCSV(await f.text(), s); });
          v.querySelector('[data-act=bulk]').addEventListener('click', () => {
            bulk = true; draft = {};
            for (const p of all()) { const tt = (p.tiers || []).slice().sort((a, b) => a.min - b.min); draft[p.id] = tt.length ? tt.map(x => ({ min: x.min, price: x.price })) : DEF_MINS.map(m => ({ min: m, price: '' })); }
            redraw();
          });
          const bb = v.querySelector('#ap-bulk');
          const on = (n, f) => { const b = bb.querySelector(`[data-act=${n}]`); b && b.addEventListener('click', f); };
          on('bk-cancel', () => { bulk = false; draft = null; redraw(); });
          on('bk-apply', () => {
            const pct = Number(v.querySelector('#bk-pct').value) || 0; const step = Number(v.querySelector('#bk-round').value);
            for (const id in draft) draft[id] = draft[id].map(x => x.price === '' || !(Number(x.price) > 0) ? x : { min: x.min, price: Math.round(Math.round(Number(x.price) * (1 + pct / 100) / step) * step * 100) / 100 });
            v.querySelector('#ap-body').innerHTML = rows(); bindRows();
            BL.toast(t('admin.applied', { p: pct }));
          });
          on('bk-save', async () => {
            try {
              let n = 0;
              for (const p of all()) {
                const nt = draft[p.id].filter(x => Number(x.price) > 0).map(x => ({ min: x.min, price: Math.round(Number(x.price) * 100) / 100 }));
                const old = (p.tiers || []).slice().sort((a, b) => a.min - b.min).map(x => ({ min: x.min, price: x.price }));
                if (JSON.stringify(nt) !== JSON.stringify(old)) { await store.saveProduct(Object.assign({}, p, { tiers: nt })); n++; }
              }
              bulk = false; draft = null; BL.toast(t('admin.pricesSaved', { n })); await reload();
            } catch (e) { BL.fail(e); }
          });
          bindRows();
        };
        const bindRows = () => {
          v.querySelectorAll('#ap-body tr[data-id]').forEach(tr => {
            const p = S.products.find(x => x.id === tr.dataset.id);
            tr.querySelector('[data-edit]').addEventListener('click', () => editProduct(p, s));
            tr.querySelector('[data-dup]').addEventListener('click', () => editProduct(Object.assign(JSON.parse(JSON.stringify(p)), { id: null, sku: p.sku + '-COPY' }), s));
            tr.querySelector('[data-active]').addEventListener('change', async e => { try { await store.saveProduct(Object.assign({}, p, { active: e.target.checked })); await BL.loadAll(); tr.style.opacity = e.target.checked ? '' : '.55'; } catch (err) { BL.fail(err); } });
            tr.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', async () => {
              const ids = all().map(x => x.id); const i = ids.indexOf(p.id); const j = i + Number(b.dataset.move);
              if (j < 0 || j >= ids.length) return;[ids[i], ids[j]] = [ids[j], ids[i]];
              try { await store.reorderProducts(ids); await reload(); } catch (err) { BL.fail(err); }
            }));
            tr.querySelectorAll('[data-bulk]').forEach(inp => inp.addEventListener('input', () => { draft[inp.dataset.bulk][Number(inp.dataset.ti)].price = inp.value === '' ? '' : Number(inp.value); }));
            const z = tr.querySelector('[data-zoom]'); z && z.addEventListener('click', () => BL.zoomImage(p.image, BL.pname(p), p.sku));
          });
        };
        bind();
        actions.querySelector('[data-act=new]').addEventListener('click', () => editProduct(null, s));
      }
    };
  }, { admin: true });

  function editProduct(p, s) {
    const isNew = !p || !p.id;
    const d = JSON.parse(JSON.stringify(p || { sport_id: s.id, sku: '', name: {}, category: 'top', gender: 'both', kids: false, sizes: SIZE_PRESETS.adult.slice(), tiers: [{ min: 10, price: 0 }, { min: 30, price: 0 }, { min: 60, price: 0 }], active: true, image: '', notes: '' }));
    d.sport_id = s.id; d.name = d.name || {};
    if (!d.tiers || !d.tiers.length) d.tiers = [{ min: 10, price: 0 }, { min: 30, price: 0 }, { min: 60, price: 0 }];
    let curLang = 'it';
    const sizeChips = () => {
      const known = [...new Set([...SIZE_PRESETS.adult, ...SIZE_PRESETS.kids, ...SIZE_PRESETS.one, ...d.sizes])];
      return known.map(sz => `<button type="button" class="chip ${d.sizes.includes(sz) ? 'on' : ''}" data-size="${esc(sz)}">${esc(sz)}</button>`).join('');
    };
    const tiersHTML = () => d.tiers.map((x, i) => `<div class="tier-ed"><label class="f"><span>${esc(t('product.fromQty'))}</span><input class="inp sm" type="number" min="1" step="1" data-tmin="${i}" value="${x.min}"></label><label class="f"><span>${esc(t('product.unitPrice'))} (€)</span><input class="inp sm" type="number" min="0" step="0.01" data-tprice="${i}" value="${x.price}"></label><button type="button" class="btn ghost sm" data-tdel="${i}" ${d.tiers.length < 2 ? 'disabled' : ''}>${ic('trash')}</button></div>`).join('');
    const langTabs = () => `<div class="langtabs">${BL.LANGS.map(l => `<button type="button" data-lt="${l.id}" class="${l.id === curLang ? 'on' : ''} ${d.name[l.id] ? '' : 'miss'}">${l.id.toUpperCase()}</button>`).join('')}</div>`;
    const body = `<form class="stack" id="pf">
      <div class="grid3">
        <label class="f"><span class="req">${esc(t('product.sku'))}</span><input class="inp" name="sku" required value="${esc(d.sku)}"></label>
        <label class="f"><span>${esc(t('product.category'))}</span><select class="inp" name="category">${BL.CATEGORIES.map(c => `<option value="${c}" ${d.category === c ? 'selected' : ''}>${esc(t('cat.' + c))}</option>`).join('')}</select></label>
        <label class="f"><span>${esc(t('product.gender'))}</span><select class="inp" name="gender">${GENDERS.map(g => `<option value="${g}" ${d.gender === g ? 'selected' : ''}>${esc(t('gender.' + g))}</option>`).join('')}</select></label>
      </div>
      <div><div class="row between"><span class="f" style="font-size:12px;font-weight:600">${esc(t('product.names'))}</span><span class="hint">${esc(t('product.namesHint'))}</span></div>
        <div class="mt-s" id="pf-lt">${langTabs()}</div><input class="inp" id="pf-name" value="${esc(d.name[curLang] || '')}" placeholder="${esc(t('product.namePh'))}"></div>
      <div><div class="row between"><span style="font-size:12px;font-weight:600">${esc(t('product.sizes'))}</span><span class="row" style="gap:6px">${Object.keys(SIZE_PRESETS).map(k => `<button type="button" class="btn ghost sm" data-preset="${k}">${esc(t('product.preset.' + k))}</button>`).join('')}<button type="button" class="btn ghost sm" data-act="addsize">${ic('plus')}</button></span></div>
        <div class="chips mt-s" id="pf-sizes">${sizeChips()}</div><div class="hint mt-s">${esc(t('product.sizesHint'))}</div></div>
      <label class="row" style="gap:8px;font-size:13px"><input type="checkbox" name="kids" ${d.kids ? 'checked' : ''}> ${esc(t('product.kidsLine'))}</label>
      <div><div class="row between"><span style="font-size:12px;font-weight:600">${esc(t('product.tiers'))}</span><button type="button" class="btn ghost sm" data-act="addtier">${ic('plus')}${esc(t('product.addTier'))}</button></div>
        <div class="stack mt-s" id="pf-tiers" style="gap:8px">${tiersHTML()}</div><div class="hint mt-s">${esc(t('product.tiersHint'))} ${esc(t('admin.noPriceHint'))}.</div></div>
      <div class="grid2">
        <div><span style="font-size:12px;font-weight:600">${esc(t('product.image'))}</span><div class="row mt-s"><div class="thumb" id="pf-img" style="width:64px;height:64px">${d.image ? `<img src="${esc(d.image)}" alt="">` : ic('image')}</div><div class="stack" style="gap:6px"><button type="button" class="btn ghost sm" data-act="img">${ic('up')}${esc(t('product.upload'))}</button>${d.image ? `<button type="button" class="linkbtn" data-act="imgdel" style="font-size:12px">${esc(t('common.remove'))}</button>` : ''}</div></div><input type="file" id="pf-file" accept="image/*" class="hidden"></div>
        <label class="f"><span>${esc(t('common.notes'))}</span><textarea class="inp" name="notes" rows="3" placeholder="${esc(t('product.notesPh'))}">${esc(d.notes || '')}</textarea></label>
      </div>
    </form>`;
    BL.openOverlay({
      kind: 'modal', wide: true, title: esc(isNew ? t('admin.newProduct') : t('admin.editProduct')), sub: BL.sportChip(s.id),
      body,
      foot: `${!isNew ? `<button class="btn danger" data-act="del" style="margin-right:auto">${ic('trash')}${esc(t('common.delete'))}</button>` : ''}<button class="btn ghost" data-close>${esc(t('common.cancel'))}</button><button class="btn" data-act="save">${esc(t('common.save'))}</button>`,
      onMount: (o) => {
        const f = o.el.querySelector('#pf');
        const nameIn = o.el.querySelector('#pf-name');
        nameIn.addEventListener('input', () => { d.name[curLang] = nameIn.value; o.el.querySelector(`[data-lt=${curLang}]`).classList.toggle('miss', !nameIn.value); });
        o.el.querySelector('#pf-lt').addEventListener('click', e => { const b = e.target.closest('[data-lt]'); if (!b) return; curLang = b.dataset.lt; o.el.querySelector('#pf-lt').innerHTML = langTabs(); nameIn.value = d.name[curLang] || ''; nameIn.placeholder = curLang === 'it' ? t('product.namePh') : (d.name.it || ''); nameIn.focus(); });
        const sizesEl = o.el.querySelector('#pf-sizes');
        const order = [...SIZE_PRESETS.kids, ...SIZE_PRESETS.adult, ...SIZE_PRESETS.one];
        const sortSizes = () => d.sizes.sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
        sizesEl.addEventListener('click', e => { const b = e.target.closest('[data-size]'); if (!b) return; const sz = b.dataset.size; d.sizes = d.sizes.includes(sz) ? d.sizes.filter(x => x !== sz) : [...d.sizes, sz]; sortSizes(); sizesEl.innerHTML = sizeChips(); });
        o.el.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => { d.sizes = SIZE_PRESETS[b.dataset.preset].slice(); sizesEl.innerHTML = sizeChips(); }));
        o.el.querySelector('[data-act=addsize]').addEventListener('click', async () => { const r = await BL.promptDialog(t('product.addSize'), [{ name: 'sz', label: t('product.sizeName'), required: true }]); if (r && r.sz.trim()) { const sz = r.sz.trim().toUpperCase(); if (!d.sizes.includes(sz)) d.sizes.push(sz); sizesEl.innerHTML = sizeChips(); } });
        const tiersEl = o.el.querySelector('#pf-tiers');
        const drawTiers = () => { tiersEl.innerHTML = tiersHTML(); };
        tiersEl.addEventListener('input', e => { const m = e.target.dataset.tmin, p = e.target.dataset.tprice; if (m !== undefined) d.tiers[m].min = Math.max(1, Math.floor(Number(e.target.value) || 1)); if (p !== undefined) d.tiers[p].price = Number(e.target.value) || 0; });
        tiersEl.addEventListener('click', e => { const b = e.target.closest('[data-tdel]'); if (!b) return; d.tiers.splice(Number(b.dataset.tdel), 1); drawTiers(); });
        o.el.querySelector('[data-act=addtier]').addEventListener('click', () => { const last = d.tiers[d.tiers.length - 1]; d.tiers.push({ min: last ? last.min * 2 : 10, price: last ? last.price : 0 }); drawTiers(); });
        const file = o.el.querySelector('#pf-file');
        o.el.querySelector('[data-act=img]').addEventListener('click', () => file.click());
        file.addEventListener('change', async () => { const fl = file.files[0]; if (!fl) return; try { d.image = await BL.readImage(fl, 480); o.el.querySelector('#pf-img').innerHTML = `<img src="${d.image}" alt="">`; } catch (e) { BL.fail(e); } });
        const imgdel = o.el.querySelector('[data-act=imgdel]'); imgdel && imgdel.addEventListener('click', () => { d.image = ''; o.el.querySelector('#pf-img').innerHTML = ic('image'); });
        o.el.querySelector('[data-act=save]').addEventListener('click', async () => {
          if (!f.reportValidity()) return;
          const fd = new FormData(f);
          d.sku = String(fd.get('sku')).trim(); d.category = fd.get('category'); d.gender = fd.get('gender'); d.kids = fd.get('kids') === 'on'; d.notes = fd.get('notes');
          for (const k of Object.keys(d.name)) if (!String(d.name[k] || '').trim()) delete d.name[k]; else d.name[k] = d.name[k].trim();
          if (!d.name.it) return BL.toast(t('product.errName'), true);
          if (!d.sizes.length) return BL.toast(t('product.errSizes'), true);
          d.tiers = d.tiers.filter(x => x.price > 0);
          const mins = d.tiers.map(x => x.min);
          if (new Set(mins).size !== mins.length) return BL.toast(t('product.errTierDup'), true);
          if (!d.tiers.length && !await BL.confirmDialog(t('admin.noPriceHint') + '. ' + t('common.confirm') + '?')) return;
          d.tiers.sort((a, b) => a.min - b.min);
          try { await store.saveProduct(d); o.close(); BL.toast(t('common.saved')); await reload(); } catch (e) { BL.fail(e); }
        });
        const del = o.el.querySelector('[data-act=del]');
        del && del.addEventListener('click', async () => {
          if (!await BL.confirmDialog(t('admin.confirmDeleteProduct'), { danger: true, okLabel: t('common.delete') })) return;
          try { const r = await store.deleteProduct(d.id); o.close(); BL.toast(r && r.archived ? t('admin.archived') : t('admin.deleted')); await reload(); } catch (e) { BL.fail(e); }
        });
      }
    });
  }

  // ---------- CSV ----------
  const CSV_HEAD = ['sku', 'categoria', 'genere', 'bambino', 'taglie', 'nome_it', 'nome_en', 'nome_fr', 'nome_de', 'nome_es', 'fascia1_min', 'fascia1_prezzo', 'fascia2_min', 'fascia2_prezzo', 'fascia3_min', 'fascia3_prezzo', 'fascia4_min', 'fascia4_prezzo', 'attivo'];
  const G_OUT = { men: 'uomo', women: 'donna', both: 'uomo+donna', unisex: 'unisex' };
  const G_IN = { uomo: 'men', men: 'men', m: 'men', donna: 'women', women: 'women', w: 'women', d: 'women', 'uomo+donna': 'both', both: 'both', 'u+d': 'both', unisex: 'unisex', u: 'unisex' };
  const C_IN = { top: 'top', maglia: 'top', maglie: 'top', bottom: 'bottom', pantaloncini: 'bottom', outer: 'outer', giacca: 'outer', giacche: 'outer', set: 'set', completo: 'set', body: 'body', accessory: 'accessory', accessorio: 'accessory', accessori: 'accessory' };
  const num = (n) => String(n).replace('.', ',');
  function csvRows(s, template) {
    if (template) return [CSV_HEAD, ['ABC-001', 'top', 'uomo+donna', 'no', 'XS S M L XL XXL', 'Maglia manica corta', 'Short-sleeve jersey', 'Maillot manches courtes', 'Kurzarmtrikot', 'Maillot manga corta', '10', '45,00', '30', '42,50', '60', '40,00', '', '', 'si']];
    return [CSV_HEAD, ...S.products.filter(p => p.sport_id === s.id).map(p => {
      const tiers = p.tiers.slice().sort((a, b) => a.min - b.min);
      const tc = []; for (let i = 0; i < 4; i++) tc.push(tiers[i] ? tiers[i].min : '', tiers[i] ? num(tiers[i].price) : '');
      return [p.sku, p.category, G_OUT[p.gender], p.kids ? 'si' : 'no', p.sizes.join(' '), ...LANG_IDS().map(l => p.name[l] || ''), ...tc, p.active !== false ? 'si' : 'no'];
    })];
  }
  function importCSV(text, s) {
    const rows = BL.parseCSV(text);
    if (rows.length < 2) return BL.toast(t('admin.csvEmpty'), true);
    const head = rows[0].map(h => h.trim().toLowerCase());
    const col = (r, name) => { const i = head.indexOf(name); return i < 0 ? '' : String(r[i] ?? '').trim(); };
    if (!head.includes('sku') || !head.includes('nome_it')) return BL.toast(t('admin.csvBadHead'), true);
    const existing = S.products.filter(p => p.sport_id === s.id);
    const out = [], errors = [];
    rows.slice(1).forEach((r, idx) => {
      const line = idx + 2;
      const sku = col(r, 'sku'); if (!sku) return errors.push(`${t('admin.row')} ${line}: ${t('admin.csvNoSku')}`);
      const name = {}; for (const l of LANG_IDS()) { const v = col(r, 'nome_' + l); if (v) name[l] = v; }
      if (!name.it) return errors.push(`${t('admin.row')} ${line} (${sku}): ${t('product.errName')}`);
      const tiers = [];
      for (let i = 1; i <= 6; i++) { const m = col(r, `fascia${i}_min`), p = col(r, `fascia${i}_prezzo`); if (m === '' && p === '') continue; const mi = Math.floor(BL.parseNum(m)), pr = BL.parseNum(p); if (!(mi >= 1) || !(pr > 0)) { errors.push(`${t('admin.row')} ${line} (${sku}): ${t('admin.csvBadTier', { i })}`); return; } tiers.push({ min: mi, price: Math.round(pr * 100) / 100 }); }
      const gender = G_IN[col(r, 'genere').toLowerCase()] || 'unisex';
      const sizes = col(r, 'taglie').split(/[\s,;/|]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
      const ex = existing.find(p => p.sku.toLowerCase() === sku.toLowerCase());
      out.push({ ex, p: Object.assign({}, ex || {}, { sport_id: s.id, sku, name: Object.assign({}, ex ? ex.name : {}, name), category: C_IN[col(r, 'categoria').toLowerCase()] || (ex ? ex.category : 'top'), gender, kids: /^(si|sì|yes|y|1|x|true)$/i.test(col(r, 'bambino')), sizes: sizes.length ? sizes : (ex ? ex.sizes : ['TU']), tiers: tiers.length ? tiers.sort((a, b) => a.min - b.min) : (ex ? ex.tiers : []), active: !/^(no|n|0|false)$/i.test(col(r, 'attivo')) }) });
    });
    const nNew = out.filter(x => !x.ex).length, nUpd = out.length - nNew;
    BL.openOverlay({
      kind: 'modal', wide: true, title: esc(t('admin.importTitle')), sub: BL.sportChip(s.id),
      body: `<div class="grid3"><div class="card kpi"><small>${esc(t('admin.newProducts'))}</small><strong>${nNew}</strong></div><div class="card kpi"><small>${esc(t('admin.updatedProducts'))}</small><strong>${nUpd}</strong></div><div class="card kpi"><small>${esc(t('admin.errors'))}</small><strong style="color:${errors.length ? 'var(--danger)' : 'inherit'}">${errors.length}</strong></div></div>
        ${errors.length ? `<div class="alert err mt">${errors.slice(0, 20).map(esc).join('<br>')}${errors.length > 20 ? '<br>…' : ''}</div>` : ''}
        <div class="tablewrap mt"><table class="t"><thead><tr><th>SKU</th><th>${esc(t('orders.article'))}</th><th>${esc(t('product.tiers'))}</th><th></th></tr></thead><tbody>${out.slice(0, 60).map(x => `<tr><td class="mono">${esc(x.p.sku)}</td><td>${esc(x.p.name.it)}</td><td><div class="tiers">${x.p.tiers.map(tr => `<span class="tier">${tr.min}+ ${fmt.eur(tr.price)}</span>`).join('')}</div></td><td>${x.ex ? `<span class="pill plain st-submitted">${esc(t('admin.update'))}</span>` : `<span class="pill plain st-shipped">${esc(t('admin.new'))}</span>`}</td></tr>`).join('')}</tbody></table></div>`,
      foot: `<button class="btn ghost" data-close>${esc(t('common.cancel'))}</button><button class="btn" data-act="go" ${out.length ? '' : 'disabled'}>${ic('check')}${esc(t('admin.importN', { n: out.length }))}</button>`,
      onMount: (o) => o.el.querySelector('[data-act=go]').addEventListener('click', async () => {
        const b = o.el.querySelector('[data-act=go]'); b.disabled = true;
        try { for (const x of out) await store.saveProduct(x.p); o.close(); BL.toast(t('admin.imported', { n: out.length })); await reload(); } catch (e) { b.disabled = false; BL.fail(e); }
      })
    });
  }

  // ================= REGOLE COMMERCIALI =================
  BL.route('/admin/pricing', ({ query }) => {
    const s = BL.sport(query.sport || 'running') || S.sports[0];
    const r = JSON.parse(JSON.stringify(window.BLPricing.rulesWithDefaults(s.rules)));
    const meta = { season: s.season || '', color: s.color, active: s.active !== false };
    const pct = (arr) => arr.join(', ');
    const surRows = (k) => r.surcharge[k].map((x, i) => `<div class="tier-ed"><label class="f"><span>${esc(t('pricing.upTo'))}</span><input class="inp sm" type="number" min="1" data-sur="${k}" data-i="${i}" data-f="max" value="${x.max}"></label><label class="f"><span>${esc(t('pricing.mult'))}</span><input class="inp sm" type="number" min="1" step="0.05" data-sur="${k}" data-i="${i}" data-f="mult" value="${x.mult}"></label><button type="button" class="btn ghost sm" data-surdel="${k}" data-i="${i}">${ic('trash')}</button></div>`).join('') || `<div class="hint">${esc(t('pricing.noSurcharge'))}</div>`;
    const extraRows = () => r.extras.map((e, i) => `<div class="card" style="padding:12px;box-shadow:none"><div class="row wrap" style="gap:8px;align-items:flex-end">
        ${BL.LANGS.map(l => `<label class="f grow" style="min-width:120px"><span>${l.id.toUpperCase()}</span><input class="inp sm" data-ex="${i}" data-l="${l.id}" value="${esc(e.name[l.id] || '')}"></label>`).join('')}
        <label class="f" style="width:100px"><span>€</span><input class="inp sm" type="number" min="0" step="0.01" data-exprice="${i}" value="${e.price}"></label>
        <button type="button" class="btn ghost sm" data-exdel="${i}">${ic('trash')}</button></div></div>`).join('') || `<div class="hint">${esc(t('editor.noExtras'))}</div>`;

    const body = `<div class="toolbar"><div class="tabs">${S.sports.map(x => `<a class="tab ${x.id === s.id ? 'active' : ''}" href="#/admin/pricing?sport=${x.id}">${esc(BL.tl(x.name))}</a>`).join('')}</div></div>
      <div class="editor"><form class="stack" id="rf" onsubmit="return false">
        <div class="card"><div class="card-b"><div class="sec-title">${esc(t('pricing.sportSection'))}</div><div class="grid3">
          <label class="f"><span>${esc(t('catalog.season'))}</span><input class="inp" id="rf-season" value="${esc(meta.season)}"></label>
          <label class="f"><span>${esc(t('pricing.color'))}</span><input class="inp" id="rf-color" type="color" value="${esc(meta.color)}" style="height:40px;padding:4px"></label>
          <label class="f"><span>${esc(t('pricing.visible'))}</span><span class="row" style="height:40px"><label class="switch"><input type="checkbox" id="rf-active" ${meta.active ? 'checked' : ''}><span></span></label></span></label>
        </div></div></div>
        <div class="card"><div class="card-b"><div class="sec-title">${esc(t('pricing.qtySection'))}</div>
          <label class="f"><span>${esc(t('pricing.tierBasis'))}</span><select class="inp" id="rf-basis">${['product', 'order'].map(x => `<option value="${x}" ${r.tier_basis === x ? 'selected' : ''}>${esc(t('pricing.basis.' + x))}</option>`).join('')}</select></label>
          <div class="grid2 mt">
            <div><div class="row between"><b style="font-size:13px">${esc(t('pricing.surchargeNew'))}</b><button type="button" class="btn ghost sm" data-suradd="new">${ic('plus')}</button></div><div class="stack mt-s" style="gap:6px" id="sur-new">${surRows('new')}</div></div>
            <div><div class="row between"><b style="font-size:13px">${esc(t('pricing.surchargeReorder'))}</b><button type="button" class="btn ghost sm" data-suradd="reorder">${ic('plus')}</button></div><div class="stack mt-s" style="gap:6px" id="sur-reorder">${surRows('reorder')}</div></div>
          </div><div class="hint mt-s">${esc(t('pricing.surchargeHint'))}</div>
        </div></div>
        <div class="card"><div class="card-b"><div class="sec-title">${esc(t('pricing.setupFees'))}</div><div class="grid4">
          ${['new', 'modified', 'reorder'].map(k => `<label class="f"><span>${esc(t('otype.' + k))} (€)</span><input class="inp" type="number" min="0" step="0.01" data-setup="${k}" value="${r.setup_fee[k]}"></label>`).join('')}
          <label class="f"><span>${esc(t('pricing.setupFreeOver'))} (€)</span><input class="inp" type="number" min="0" step="1" id="rf-sfo" value="${r.setup_free_over}"></label>
        </div><div class="hint mt-s">${esc(t('pricing.zeroNever'))}</div></div></div>
        <div class="card"><div class="card-b"><div class="row between"><div class="sec-title" style="margin:0">${esc(t('sum.extras'))}</div><button type="button" class="btn ghost sm" data-act="exadd">${ic('plus')}${esc(t('pricing.addExtra'))}</button></div><div class="stack mt" id="rf-extras" style="gap:8px">${extraRows()}</div></div></div>
        <div class="card"><div class="card-b"><div class="sec-title">${esc(t('pricing.discounts'))}</div><div class="grid3">
          <label class="f"><span>${esc(t('pricing.discountMode'))}</span><select class="inp" id="rf-dmode">${['cascade', 'sum'].map(x => `<option value="${x}" ${r.discount_mode === x ? 'selected' : ''}>${esc(t('pricing.dmode.' + x))}</option>`).join('')}</select></label>
          <label class="f"><span>${esc(t('pricing.discountOptions'))}</span><input class="inp" id="rf-dopt" value="${esc(pct(r.discount_options))}"></label>
          <label class="f"><span>${esc(t('pricing.sponsorOptions'))}</span><input class="inp" id="rf-sopt" value="${esc(pct(r.sponsor_options))}"></label>
        </div><div class="hint mt-s">${esc(t('pricing.optionsHint'))}</div></div></div>
        <div class="card"><div class="card-b"><div class="sec-title">${esc(t('pricing.shippingVat'))}</div><div class="grid3">
          ${['it', 'eu', 'extra'].map(z => `<label class="f"><span>${esc(t('sum.shipping'))} ${esc(t('zone.' + z))} (€)</span><input class="inp" type="number" min="0" step="0.01" data-ship="${z}" value="${r.shipping[z]}"></label>`).join('')}
          <label class="f"><span>${esc(t('pricing.freeShipOver'))} (€)</span><input class="inp" type="number" min="0" id="rf-fso" value="${r.free_shipping_over}"></label>
          <label class="f"><span>${esc(t('sum.vat'))} (%)</span><input class="inp" type="number" min="0" max="100" step="0.5" id="rf-vat" value="${r.vat}"></label>
          <label class="f"><span>${esc(t('sum.deposit'))} (%)</span><input class="inp" type="number" min="0" max="100" id="rf-dep" value="${r.deposit}"></label>
        </div><div class="hint mt-s">${esc(t('pricing.zoneHint'))}</div></div></div>
      </form>
      <div class="stack summary">
        <div class="card"><div class="card-b stack">
          <button class="btn block" data-act="save">${ic('check')}${esc(t('common.saveChanges'))}</button>
          <label class="f"><span>${esc(t('pricing.copyFrom'))}</span><div class="row"><select class="inp sm" id="rf-copy">${S.sports.filter(x => x.id !== s.id).map(x => `<option value="${x.id}">${esc(BL.tl(x.name))}</option>`).join('')}</select><button class="btn ghost sm" data-act="copy">${esc(t('admin.apply'))}</button></div></label>
          <button class="btn ghost block" data-act="toall">${esc(t('pricing.applyAll'))}</button>
        </div></div>
        <div class="card"><div class="card-h"><h3>${esc(t('pricing.simulator'))}</h3></div><div class="card-b">
          <select class="inp sm" id="sim-p">${BL.sportProducts(s.id, true).map(p => `<option value="${esc(p.id)}">${esc(BL.pname(p))}</option>`).join('') || `<option value="">${esc(t('catalog.emptyShort'))}</option>`}</select>
          <div id="sim-out" class="mt-s"></div><div class="hint mt-s">${esc(t('pricing.simHint'))}</div></div></div>
      </div></div>`;

    return {
      title: esc(t('nav.adminPricing')), titleText: t('nav.adminPricing'),
      subtitle: `${BL.sportChip(s.id)} <span class="hint">· ${esc(t('pricing.sub'))}</span>`,
      body,
      mount: (v) => {
        const $ = (x) => v.querySelector(x);
        const parseList = (s) => [...new Set(String(s).split(/[,;\s]+/).map(Number).filter(x => x >= 0 && x <= 100))].sort((a, b) => a - b);
        const collect = () => {
          r.tier_basis = $('#rf-basis').value;
          v.querySelectorAll('[data-setup]').forEach(i => { r.setup_fee[i.dataset.setup] = Number(i.value) || 0; });
          r.setup_free_over = Number($('#rf-sfo').value) || 0;
          r.discount_mode = $('#rf-dmode').value;
          r.discount_options = parseList($('#rf-dopt').value); r.sponsor_options = parseList($('#rf-sopt').value);
          v.querySelectorAll('[data-ship]').forEach(i => { r.shipping[i.dataset.ship] = Math.max(0, Number(i.value) || 0); }); r.free_shipping_over = Number($('#rf-fso').value) || 0;
          r.vat = Number($('#rf-vat').value) || 0; r.deposit = Number($('#rf-dep').value) || 0;
          return r;
        };
        const drawSur = (k) => { $('#sur-' + k).innerHTML = surRows(k); sim(); };
        v.addEventListener('input', e => {
          const el = e.target;
          if (el.dataset.sur) r.surcharge[el.dataset.sur][el.dataset.i][el.dataset.f] = Number(el.value) || 0;
          if (el.dataset.ex !== undefined) r.extras[el.dataset.ex].name[el.dataset.l] = el.value;
          if (el.dataset.exprice !== undefined) r.extras[el.dataset.exprice].price = Number(el.value) || 0;
          sim();
        });
        v.addEventListener('change', () => sim());
        v.addEventListener('click', e => {
          const b = e.target.closest('button'); if (!b) return;
          if (b.dataset.suradd) { const a = r.surcharge[b.dataset.suradd]; const last = a[a.length - 1]; a.push({ max: last ? last.max + 5 : 1, mult: 1.1 }); drawSur(b.dataset.suradd); }
          if (b.dataset.surdel) { r.surcharge[b.dataset.surdel].splice(Number(b.dataset.i), 1); drawSur(b.dataset.surdel); }
          if (b.dataset.exdel !== undefined) { r.extras.splice(Number(b.dataset.exdel), 1); $('#rf-extras').innerHTML = extraRows(); }
          if (b.dataset.act === 'exadd') { r.extras.push({ id: 'x' + Date.now().toString(36), name: { it: '' }, price: 0 }); $('#rf-extras').innerHTML = extraRows(); }
        });
        const saveSport = async (target, rules) => {
          const sp = BL.sport(target);
          const data = Object.assign({}, sp, { rules: JSON.parse(JSON.stringify(rules)) });
          if (target === s.id) Object.assign(data, { season: $('#rf-season').value.trim(), color: $('#rf-color').value, active: $('#rf-active').checked });
          await store.saveSport(data);
        };
        const validate = () => {
          collect();
          r.extras = r.extras.filter(e => (e.name.it || '').trim());
          if (r.extras.some(e => !(e.price >= 0))) throw new Error(t('pricing.errExtra'));
          for (const k of ['new', 'reorder']) r.surcharge[k] = r.surcharge[k].filter(x => x.max >= 1 && x.mult >= 1).sort((a, b) => a.max - b.max);
          if (r.vat < 0 || r.vat > 100 || r.deposit < 0 || r.deposit > 100) throw new Error(t('pricing.errPct'));
        };
        v.querySelector('[data-act=save]').addEventListener('click', async () => { try { validate(); await saveSport(s.id, r); BL.toast(t('common.saved')); await reload(); } catch (e) { BL.fail(e); } });
        v.querySelector('[data-act=copy]').addEventListener('click', async () => {
          const src = BL.sport($('#rf-copy').value); if (!src) return;
          if (!await BL.confirmDialog(t('pricing.confirmCopy', { s: BL.tl(src.name) }))) return;
          try { await saveSport(s.id, window.BLPricing.rulesWithDefaults(src.rules)); await reload(); } catch (e) { BL.fail(e); }
        });
        v.querySelector('[data-act=toall]').addEventListener('click', async () => {
          if (!await BL.confirmDialog(t('pricing.confirmAll'))) return;
          try { validate(); for (const x of S.sports) await saveSport(x.id, r); BL.toast(t('common.saved')); await reload(); } catch (e) { BL.fail(e); }
        });
        const sim = () => {
          const p = S.products.find(x => x.id === $('#sim-p').value); const out = $('#sim-out');
          if (!p) { out.innerHTML = ''; return; }
          collect();
          const qs = [1, 3, 5, 9, ...p.tiers.map(x => Number(x.min))].filter((x, i, a) => a.indexOf(x) === i).sort((a, b) => a - b);
          out.innerHTML = `<table class="t"><thead><tr><th>${esc(t('common.qty'))}</th><th class="num">${esc(t('otype.new'))}</th><th class="num">${esc(t('otype.reorder'))}</th></tr></thead><tbody>${qs.map(q => {
            const a = window.BLPricing.unitPrice(p, q, 'new', window.BLPricing.rulesWithDefaults(r)); const b = window.BLPricing.unitPrice(p, q, 'reorder', window.BLPricing.rulesWithDefaults(r));
            return `<tr><td>${q}</td><td class="num">${fmt.eur(a.price)}${a.mult !== 1 ? ` <span class="hint">×${a.mult}</span>` : ''}</td><td class="num">${fmt.eur(b.price)}${b.mult !== 1 ? ` <span class="hint">×${b.mult}</span>` : ''}</td></tr>`;
          }).join('')}</tbody></table>`;
        };
        $('#sim-p').addEventListener('change', sim); sim();
      }
    };
  }, { admin: true });

  // ================= UTENTI =================
  BL.route('/admin/users', () => {
    const rows = () => S.users.map(u => {
      const nO = S.requests.filter(r => r.assigned_to === u.id).length, nC = S.clients.filter(c => c.owner_id === u.id).length;
      return `<tr class="click" data-id="${esc(u.id)}" style="${u.active === false ? 'opacity:.5' : ''}"><td><div class="row"><span class="avatar" style="background:#e9e9e6;color:#17191e">${esc(BL.initials(u.full_name || u.email))}</span><div><div class="cell-title">${esc(u.full_name || '—')}${u.id === S.me.id ? ` <span class="hint">(${esc(t('admin.you'))})</span>` : ''}</div><div class="cell-sub">${esc(u.email)}</div></div></div></td>
        <td>${BL.rolePill(u.role)}</td><td>${esc((u.language || '').toUpperCase())}</td><td>${esc(u.country || '—')}</td><td class="num">${nC}</td><td class="num">${nO}</td><td>${u.active === false ? `<span class="pill st-cancelled">${esc(t('admin.disabled'))}</span>` : `<span class="pill st-shipped">${esc(t('admin.active'))}</span>`}</td></tr>`;
    }).join('');
    return {
      title: esc(t('nav.adminUsers')), subtitle: esc(t('users.sub')),
      actions: `<button class="btn" data-act="invite">${ic('mail')}${esc(t('users.invite'))}</button>`,
      body: `<div class="grid3" style="margin-bottom:16px">${['admin', 'staff', 'agent'].map(r => `<div class="card" style="padding:14px 16px">${BL.rolePill(r)}<div class="hint mt-s">${esc(t('users.roleDesc.' + r))}</div></div>`).join('')}</div>
        <div class="card tablewrap"><table class="t"><thead><tr><th>${esc(t('users.user'))}</th><th>${esc(t('users.role'))}</th><th>${esc(t('profile.language'))}</th><th>${esc(t('clients.country'))}</th><th class="num">${esc(t('nav.clients'))}</th><th class="num">${esc(t('nav.requests'))}</th><th>${esc(t('orders.status'))}</th></tr></thead><tbody>${rows()}</tbody></table></div>`,
      mount: (v, actions) => {
        v.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => editUser(S.users.find(u => u.id === tr.dataset.id))));
        actions.querySelector('[data-act=invite]').addEventListener('click', () => editUser(null));
      }
    };
  }, { admin: true });

  function editUser(u) {
    const isNew = !u;
    const d = u || { role: 'agent', language: 'en', country: '', active: true };
    BL.openOverlay({
      kind: 'modal', title: esc(isNew ? t('users.invite') : (u.full_name || u.email)), sub: isNew ? esc(t('users.inviteSub')) : esc(u.email),
      body: `<form class="grid2" id="uf">
        ${isNew ? `<label class="f span-all"><span class="req">${esc(t('common.email'))}</span><input class="inp" type="email" name="email" required></label>` : ''}
        <label class="f span-all"><span>${esc(t('profile.name'))}</span><input class="inp" name="full_name" value="${esc(d.full_name || '')}"></label>
        <label class="f"><span>${esc(t('users.role'))}</span><select class="inp" name="role">${['agent', 'staff', 'admin'].map(r => `<option value="${r}" ${d.role === r ? 'selected' : ''}>${esc(t('role.' + r))}</option>`).join('')}</select></label>
        <label class="f"><span>${esc(t('profile.language'))}</span><select class="inp" name="language">${BL.LANGS.map(l => `<option value="${l.id}" ${d.language === l.id ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select></label>
        <label class="f"><span>${esc(t('clients.country'))}</span><input class="inp" name="country" maxlength="2" style="text-transform:uppercase" value="${esc(d.country || '')}"></label>
        ${!isNew ? `<label class="f"><span>${esc(t('admin.active'))}</span><span class="row" style="height:40px"><label class="switch"><input type="checkbox" name="active" ${d.active !== false ? 'checked' : ''}><span></span></label></span></label>` : ''}
      </form>${isNew && store.mode === 'demo' ? `<div class="alert info mt">${esc(t('users.demoInvite'))}</div>` : ''}`,
      foot: `<button class="btn ghost" data-close>${esc(t('common.cancel'))}</button><button class="btn" data-act="save">${isNew ? ic('send') + esc(t('users.sendInvite')) : esc(t('common.save'))}</button>`,
      onMount: (o) => o.el.querySelector('[data-act=save]').addEventListener('click', async () => {
        const f = o.el.querySelector('#uf'); if (!f.reportValidity()) return;
        const fd = Object.fromEntries(new FormData(f)); fd.country = (fd.country || '').toUpperCase();
        try {
          if (isNew) { await store.inviteUser(fd); BL.toast(t('users.invited')); }
          else { await store.saveUser(Object.assign({}, u, fd, { active: fd.active === 'on' })); BL.toast(t('common.saved')); }
          o.close(); await reload();
        } catch (e) { BL.fail(e); }
      })
    });
  }

  // ================= IMPOSTAZIONI =================
  BL.route('/admin/settings', () => {
    const s = Object.assign({}, S.settings);
    const fld = (k, label, ph) => `<label class="f"><span>${esc(label)}</span><input class="inp" name="${k}" value="${esc(s[k] || '')}" placeholder="${esc(ph || '')}"></label>`;
    return {
      title: esc(t('nav.adminSettings')), subtitle: esc(t('settings.sub')),
      actions: `<button class="btn" data-act="save">${ic('check')}${esc(t('common.saveChanges'))}</button>`,
      body: `<div class="editor"><form class="stack" id="sf" onsubmit="return false">
        <div class="card"><div class="card-b"><div class="sec-title">${esc(t('settings.company'))}</div><div class="grid2">
          ${fld('company_name', t('settings.companyName'))}${fld('company_vat', t('clients.vatNumber'))}
          <label class="f span-all"><span>${esc(t('settings.address'))}</span><textarea class="inp" name="company_address" rows="3">${esc(s.company_address || '')}</textarea></label>
          ${fld('company_email', t('common.email'))}${fld('company_phone', t('common.phone'))}${fld('company_web', t('settings.web'))}${fld('iban', 'IBAN')}
        </div></div></div>
        <div class="card"><div class="card-b"><div class="sec-title">${esc(t('settings.documents'))}</div><div class="grid2">
          ${fld('order_prefix', t('settings.prefix'), 'BL')}
          <label class="f"><span>${esc(t('settings.validity'))}</span><input class="inp" type="number" min="1" name="validity_days" value="${esc(s.validity_days || 30)}"></label>
          ${fld('doc_place', t('settings.place'), 'Casier (TV)')}
          <label class="f"><span>${esc(t('settings.deliveryWeeks'))}</span><input class="inp" type="number" min="1" name="delivery_weeks" value="${esc(s.delivery_weeks || 6)}"></label>
          <label class="f"><span>${esc(t('settings.recontactMonths'))}</span><input class="inp" type="number" min="1" max="60" name="recontact_months" value="${esc(s.recontact_months || 12)}"></label>
          <label class="f span-all"><span>${esc(t('settings.footer'))}</span><textarea class="inp" name="footer" rows="3" placeholder="${esc(t('settings.footerPh'))}">${esc(s.footer || '')}</textarea></label>
        </div><div class="hint mt-s">${esc(t('settings.noSignature'))}</div></div></div>
      </form>
      <div class="stack summary">
        <div class="card"><div class="card-h"><h3>${esc(t('settings.logo'))}</h3></div><div class="card-b">
          <div class="dropzone" id="sf-logo"><img src="${esc(s.logo || 'img/brand/bl-logo.png')}" style="max-height:80px;max-width:100%" alt=""></div><div class="hint mt-s">${esc(t('settings.logoDefault'))}</div>
          <div class="row mt-s"><button class="btn ghost sm" data-act="logo">${ic('up')}${esc(t('product.upload'))}</button>${s.logo ? `<button class="btn ghost sm" data-act="nologo">${esc(t('common.remove'))}</button>` : ''}</div>
          <input type="file" id="sf-file" accept="image/png,image/jpeg,image/svg+xml" class="hidden"></div></div>
        <div class="card"><div class="card-h"><h3>${esc(t('settings.data'))}</h3></div><div class="card-b stack">
          <div class="hint">${esc(store.mode === 'demo' ? t('settings.demoData') : t('settings.liveData'))}</div>
          <button class="btn ghost block" data-act="backup">${ic('down')}${esc(t('settings.backup'))}</button>
          ${store.mode === 'demo' ? `<button class="btn danger block" data-act="reset">${ic('refresh')}${esc(t('settings.resetDemo'))}</button>` : ''}
        </div></div>
      </div></div>`,
      mount: (v, actions) => {
        const file = v.querySelector('#sf-file');
        v.querySelector('[data-act=logo]').addEventListener('click', () => file.click());
        file.addEventListener('change', async () => {
          const f = file.files[0]; if (!f) return;
          try {
            s.logo = f.type === 'image/svg+xml' ? await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(f); }) : await BL.readImage(f, 600);
            v.querySelector('#sf-logo').innerHTML = `<img src="${s.logo}" style="max-height:80px;max-width:100%" alt="">`;
          } catch (e) { BL.fail(e); }
        });
        const nl = v.querySelector('[data-act=nologo]'); nl && nl.addEventListener('click', () => { s.logo = ''; v.querySelector('#sf-logo').innerHTML = '<img src="img/brand/bl-logo.png" style="max-height:80px;max-width:100%" alt="">'; });
        actions.querySelector('[data-act=save]').addEventListener('click', async () => {
          const fd = Object.fromEntries(new FormData(v.querySelector('#sf')));
          fd.validity_days = Math.max(1, Number(fd.validity_days) || 30);
          fd.delivery_weeks = Math.max(1, Number(fd.delivery_weeks) || 6);
          fd.recontact_months = Math.min(60, Math.max(1, Number(fd.recontact_months) || 12));
          fd.order_prefix = (fd.order_prefix || 'BL').trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BL';
          try { await store.saveSettings(Object.assign(s, fd)); BL.toast(t('common.saved')); await reload(); } catch (e) { BL.fail(e); }
        });
        v.querySelector('[data-act=backup]').addEventListener('click', async () => {
          try { const data = await store.exportAll(); BL.download(`bicycleline-studio-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json'); } catch (e) { BL.fail(e); }
        });
        const rs = v.querySelector('[data-act=reset]');
        rs && rs.addEventListener('click', async () => {
          if (!await BL.confirmDialog(t('settings.confirmReset'), { danger: true })) return;
          await store.resetDemo(); const id = S.me.id; await store.signIn(id).catch(() => store.signIn('u-admin')); S.me = store.me(); S.loaded = false; BL.render();
        });
      }
    };
  }, { admin: true });
})();
