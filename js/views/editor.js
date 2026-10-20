/* Editor del preventivo (nasce da una richiesta, esce come PDF) */
(function () {
  'use strict';
  const { t, esc, ic, fmt, S, store } = BL;
  const GROUPS = { men: ['M'], women: ['W'], both: ['M', 'W'], unisex: ['U'] };

  async function editorPage({ params, query }) {
    let base = null;
    if (params.id) {
      try { base = await store.getOrder(params.id); } catch { BL.toast(t('quote.notFound'), true); location.replace('#/requests'); return null; }
    }
    const firstClient = query.client && S.clients.find(c => c.id === query.client);
    const ed = BL.editing = {
      id: base && base.id, status: base ? base.status || 'draft' : 'draft', number: base && base.number,
      sport_id: (base && base.sport_id) || query.sport || '',
      client_id: (base && base.client_id) || (firstClient && firstClient.id) || '',
      order_type: (base && base.order_type) || 'new',
      language: (base && base.language) || (firstClient && firstClient.language) || BL.lang,
      agent_id: base && base.agent_id,
      request_id: (base && base.request_id) || query.request || null,
      qty: new Map(((base && base.lines) || []).map(l => [`${l.product_id}|${l.group}|${l.size}`, l.qty])),
      options: Object.assign({ discount: 0, sponsor: 0, extras: {} }, (base && base.options) || {}),
      notes: (base && base.notes) || '',
      open: new Set(), filter: '', cat: '', onlySel: false, dirty: false
    };
    if (ed.sport_id && !BL.sport(ed.sport_id)) ed.sport_id = '';
    for (const k of ed.qty.keys()) ed.open.add(k.split('|')[0]);

    const client = () => S.clients.find(c => c.id === ed.client_id);
    const rules = () => window.BLPricing.rulesWithDefaults((BL.sport(ed.sport_id) || {}).rules);
    const products = () => ed.sport_id ? BL.sportProducts(ed.sport_id) : [];
    const lines = () => [...ed.qty.entries()].filter(([, q]) => q > 0).map(([k, q]) => { const [product_id, group, size] = k.split('|'); return { product_id, group, size, qty: q }; });
    const compute = () => window.BLPricing.computeOrder({ order_type: ed.order_type, lines: lines(), options: ed.options }, products(), rules(), (client() || {}).vat_regime || 'it', (client() || {}).country);
    const markDirty = () => { ed.dirty = true; };

    // ---------- HTML parziali ----------
    const sportCards = () => `<div class="sportpick">${S.sports.filter(s => s.active !== false).map(s => {
      const n = BL.pricedCount(s.id);
      return `<button type="button" class="sportcard ${ed.sport_id === s.id ? 'active' : ''}" data-sport="${s.id}" ${n ? '' : 'disabled'}><i style="background:${esc(s.color)}">${esc(s.code)}</i><div><b>${esc(BL.tl(s.name))}</b><br><small>${n ? esc(t('editor.nProducts', { n })) : esc(t('catalog.noPrices'))}</small></div></button>`;
    }).join('')}</div>`;

    const clientOpts = () => `<option value="">${esc(t('editor.chooseClient'))}</option>` + S.clients.map(c => `<option value="${esc(c.id)}" ${c.id === ed.client_id ? 'selected' : ''}>${esc(c.name)}${BL.isStaff() ? ' — ' + esc(BL.userName(c.owner_id)) : ''}</option>`).join('');

    const tierChips = (p, tot) => {
      const line = tot && tot.lines.find(l => l.product_id === p.id);
      const tiers = p.tiers.slice().sort((a, b) => a.min - b.min);
      let active = -1;
      if (line && line.mult === 1) tiers.forEach((x, i) => { if (Math.abs(x.price - line.unit) < 0.001) active = i; });
      return `<div class="tiers">${tiers.map((x, i) => `<span class="tier ${i === active ? 'on' : ''}">${x.min}+ ${fmt.eur(x.price)}</span>`).join('')}${line && line.mult !== 1 ? `<span class="tier on" style="background:var(--warn);border-color:var(--warn)">×${line.mult} ${esc(t('pricing.smallQty'))}</span>` : ''}</div>`;
    };

    const productRow = (p, tot) => {
      const groups = GROUPS[p.gender] || ['U'];
      const line = tot.lines.find(l => l.product_id === p.id);
      const priced = BL.hasPrice(p);
      const open = priced && ed.open.has(p.id);
      return `<div class="prod ${line ? 'has' : ''} ${priced ? '' : 'off'}" data-pid="${esc(p.id)}">
        <div class="prod-h" ${priced ? `data-toggle="${esc(p.id)}"` : ''}>
          <div class="thumb lg ${p.image ? 'zoom' : ''}" ${p.image ? `data-zoom="${esc(p.id)}" title="${esc(t('catalog.zoom'))}"` : ''}>${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : esc(String(p.sku || '').slice(0, 6))}</div>
          <div style="min-width:0"><div class="cell-title">${esc(BL.pname(p))}</div><div class="cell-sub"><span class="mono">${esc(p.sku)}</span> · ${esc(t('gender.' + p.gender))}${p.kids ? ' · ' + esc(t('product.kids')) : ''}</div><div data-tiers>${priced ? tierChips(p, tot) : `<div class="tiers"><span class="noprice">${esc(t('catalog.priceTbd'))}</span></div>`}</div></div>
          <div class="prod-tot" data-ptot>${line ? `<b>${fmt.eur(line.total)}</b><small>${line.qty} ${esc(t('common.pcs'))} × ${fmt.eur(line.unit)}</small>` : priced ? `<span class="hint">${esc(t('editor.addSizes'))}</span>` : ''}</div>
          <span class="faint" style="transform:rotate(${open ? 90 : 0}deg);transition:.15s;${priced ? '' : 'visibility:hidden'}">${ic('chev')}</span>
        </div>
        <div class="prod-b ${open ? '' : 'hidden'}">${groups.map(g => `<div class="sizes">${g !== 'U' ? `<span class="glabel">${esc(t('gender.' + g))}</span>` : ''}${p.sizes.map(sz => {
          const k = `${p.id}|${g}|${sz}`; const v = ed.qty.get(k) || '';
          return `<label class="sz">${esc(sz)}<input type="number" inputmode="numeric" min="0" max="9999" step="1" data-k="${esc(k)}" value="${v}" class="${v ? 'has' : ''}" placeholder="0"></label>`;
        }).join('')}</div>`).join('')}</div>
      </div>`;
    };

    const productList = (tot) => {
      if (!ed.sport_id) return `<div class="empty">${esc(t('editor.pickSportFirst'))}</div>`;
      const q = ed.filter.toLowerCase();
      const list = products().filter(p => (!q || (BL.pname(p) + ' ' + p.sku).toLowerCase().includes(q)) && (!ed.cat || p.category === ed.cat) && (!ed.onlySel || tot.lines.some(l => l.product_id === p.id)));
      return list.map(p => productRow(p, tot)).join('') || `<div class="empty">${esc(t('common.noResults'))}</div>`;
    };

    const summary = (tot) => {
      const r = rules();
      const c = client();
      return `<div class="card"><div class="card-h"><h3>${esc(t('editor.summary'))}</h3>${ed.number ? `<span class="mono hint">${esc(ed.number)}</span>` : ''}</div><div class="card-b">
        <div class="grid2" style="margin-bottom:12px">
          <label class="f"><span>${esc(t('sum.discount'))}</span><select class="inp sm" data-opt="discount">${[...new Set([0, ...(r.discount_options || []), Number(ed.options.discount) || 0])].sort((a, b) => a - b).map(x => `<option value="${x}" ${Number(ed.options.discount) === x ? 'selected' : ''}>${x ? x + '%' : esc(t('common.none'))}</option>`).join('')}</select></label>
          <label class="f"><span>${esc(t('sum.sponsor'))}</span><select class="inp sm" data-opt="sponsor">${[...new Set([0, ...(r.sponsor_options || []), Number(ed.options.sponsor) || 0])].sort((a, b) => a - b).map(x => `<option value="${x}" ${Number(ed.options.sponsor) === x ? 'selected' : ''}>${x ? x + '%' : esc(t('common.none'))}</option>`).join('')}</select></label>
          ${BL.isStaff() ? `<label class="f span-all"><span>${esc(t('editor.shippingOverride'))}</span><input class="inp sm" type="number" min="0" step="0.01" data-opt="shipping" value="${ed.options.shipping ?? ''}" placeholder="${esc(t('editor.standard'))} ${fmt.eur(r.shipping[window.BLPricing.shippingZone((c || {}).country)])}"></label>` : ''}
        </div>
        <div data-totals>${BL.totalsHTML(tot)}</div>
        ${c && c.vat_regime !== 'it' ? `<div class="alert info mt-s">${esc(t('vat.' + c.vat_regime))}</div>` : ''}
        <div data-hints class="mt-s">${hints(tot)}</div>
        <div class="stack mt">
          <button class="btn block" data-act="save">${ic('check')}${esc(t('quote.save'))}</button>
          <button class="btn ghost block" data-act="preview">${ic('eye')}${esc(t('editor.preview'))}</button>
        </div>
      </div></div>`;
    };
    const hints = (tot) => {
      const r = rules(); const out = [];
      if (!tot.qty) return `<div class="hint">${esc(t('editor.hintEmpty'))}</div>`;
      if (tot.setup_waived) out.push(t('editor.hintSetupFree'));
      else if (r.setup_free_over && tot.setup) out.push(t('editor.hintSetupMissing', { v: fmt.eur(r.setup_free_over - tot.goods + 0.01) }));
      if (tot.shipping_free) out.push(t('editor.hintShipFree'));
      else if (r.free_shipping_over && tot.shipping) out.push(t('editor.hintShipMissing', { v: fmt.eur(r.free_shipping_over - tot.net + 0.01) }));
      const small = tot.lines.filter(l => l.mult !== 1);
      if (small.length) out.push(t('editor.hintSmall', { n: small.length }));
      return out.map(x => `<div class="hint" style="margin-top:4px">• ${esc(x)}</div>`).join('');
    };

    const extrasHTML = () => {
      const r = rules();
      if (!ed.sport_id) return '';
      return `${r.extras.map(e => `<div class="extra-row"><span>${esc(BL.tl(e.name))}</span><span class="hint">${fmt.eur(e.price)} ${esc(t('editor.each'))}</span>
        <span class="stepper"><button type="button" data-step="${esc(e.id)}" data-d="-1">−</button><input type="number" min="0" data-extra="${esc(e.id)}" value="${Number(ed.options.extras[e.id]) || 0}"><button type="button" data-step="${esc(e.id)}" data-d="1">+</button></span></div>`).join('') || `<div class="hint">${esc(t('editor.noExtras'))}</div>`}`;
    };

    const tot0 = compute();
    const c0 = client();
    const body = `<div class="editor">
      <div class="stack">
        <div class="card"><div class="card-b"><div class="sec-title"><span class="num">01</span>${esc(t('editor.sport'))}</div>${sportCards()}</div></div>
        <div class="card"><div class="card-b"><div class="sec-title"><span class="num">02</span>${esc(t('editor.details'))}</div>
          <div class="grid2">
            <label class="f span-all"><span class="req">${esc(t('clients.client'))}</span><div class="row"><select class="inp" id="ed-client">${clientOpts()}</select><button type="button" class="btn ghost" data-act="new-client">${ic('plus')}${esc(t('editor.newClient'))}</button></div></label>
            <label class="f"><span>${esc(t('orders.type'))}</span><select class="inp" id="ed-type">${['new', 'reorder', 'modified'].map(x => `<option value="${x}" ${ed.order_type === x ? 'selected' : ''}>${esc(t('otype.' + x))}</option>`).join('')}</select></label>
            <label class="f"><span>${esc(t('orders.docLang'))}</span><select class="inp" id="ed-lang">${BL.LANGS.map(l => `<option value="${l.id}" ${ed.language === l.id ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select></label>
            ${BL.isStaff() ? `<label class="f"><span>${esc(t('common.agent'))}</span><select class="inp" id="ed-agent"><option value="">${esc(t('editor.clientOwner'))}</option>${S.users.filter(u => u.active !== false).map(u => `<option value="${esc(u.id)}" ${ed.agent_id === u.id ? 'selected' : ''}>${esc(u.full_name || u.email)}</option>`).join('')}</select></label>` : ''}
          </div>
          <div id="ed-clientinfo" class="mt-s">${c0 ? clientInfo(c0) : ''}</div>
        </div></div>
        <div class="card"><div class="card-b"><div class="sec-title"><span class="num">03</span>${esc(t('editor.items'))}</div>
          <div class="toolbar" style="margin-bottom:8px"><div class="search" style="flex:1 1 220px">${ic('search')}<input class="inp" id="ed-q" placeholder="${esc(t('catalog.search'))}"></div>
            <select class="inp" id="ed-cat" style="max-width:170px"><option value="">${esc(t('editor.allCats'))}</option>${BL.CATEGORIES.map(c => `<option value="${c}">${esc(t('cat.' + c))}</option>`).join('')}</select>
            <label class="row hint" style="gap:6px"><input type="checkbox" id="ed-only"> ${esc(t('editor.onlySelected'))}</label>
            <button type="button" class="btn ghost sm" data-act="expand">${esc(t('editor.expandAll'))}</button></div>
          <div id="ed-products">${productList(tot0)}</div>
        </div></div>
        <div class="card"><div class="card-b"><div class="sec-title"><span class="num">04</span>${esc(t('editor.extras'))}</div>
          <div id="ed-extras">${extrasHTML()}</div>
          <label class="f mt"><span>${esc(t('common.notes'))}</span><textarea class="inp" id="ed-notes" rows="3" placeholder="${esc(t('editor.notesPh'))}">${esc(ed.notes)}</textarea></label>
        </div></div>
      </div>
      <div class="summary" id="ed-summary">${summary(tot0)}</div>
    </div>`;

    function clientInfo(c) {
      return `<div class="hint">${esc([c.contact_name, c.email, c.country, t('vat.' + (c.vat_regime || 'it') + '.short')].filter(Boolean).join(' · '))} · <button type="button" class="linkbtn" data-act="edit-client">${esc(t('common.edit'))}</button></div>`;
    }

    const req = ed.request_id && S.requests.find(r => String(r.id) === String(ed.request_id));
    const back = req ? '#/requests?open=' + encodeURIComponent(req.id) : '#/requests';
    return {
      title: esc(ed.id ? t('quote.editTitle', { n: ed.number }) : t('quote.newTitle')),
      titleText: ed.id ? ed.number : t('quote.newTitle'),
      crumb: `<a href="#/requests">${esc(t('nav.requests'))}</a>${req ? ` ${ic('chev')} <a href="${esc(back)}">${esc(req.team)}</a>` : ''} ${ic('chev')} ${esc(ed.id ? ed.number : t('quote.newTitle'))}`,
      actions: `<button class="btn ghost" data-act="cancel">${esc(t('common.cancel'))}</button>`,
      body,
      mount: (v, actions) => {
        const $ = (s) => v.querySelector(s);
        const refreshSummary = () => {
          const tot = compute();
          $('#ed-summary [data-totals]').innerHTML = BL.totalsHTML(tot);
          $('#ed-summary [data-hints]').innerHTML = hints(tot);
          for (const el of v.querySelectorAll('.prod[data-pid]')) {
            const p = products().find(x => x.id === el.dataset.pid); if (!p) continue;
            const line = tot.lines.find(l => l.product_id === p.id);
            el.classList.toggle('has', !!line);
            if (!BL.hasPrice(p)) continue;
            el.querySelector('[data-ptot]').innerHTML = line ? `<b>${fmt.eur(line.total)}</b><small>${line.qty} ${esc(t('common.pcs'))} × ${fmt.eur(line.unit)}</small>` : `<span class="hint">${esc(t('editor.addSizes'))}</span>`;
            el.querySelector('[data-tiers]').innerHTML = tierChips(p, tot);
          }
          return tot;
        };
        const redrawProducts = () => { $('#ed-products').innerHTML = productList(compute()); };
        const redrawSummary = () => { $('#ed-summary').innerHTML = summary(compute()); bindSummary(); };

        // sport
        v.querySelectorAll('[data-sport]').forEach(b => b.addEventListener('click', async () => {
          if (b.dataset.sport === ed.sport_id) return;
          if (lines().length && !await BL.confirmDialog(t('editor.confirmSportChange'))) return;
          ed.sport_id = b.dataset.sport; ed.qty.clear(); ed.open.clear(); ed.options.extras = {}; markDirty();
          v.querySelectorAll('[data-sport]').forEach(x => x.classList.toggle('active', x.dataset.sport === ed.sport_id));
          redrawProducts(); $('#ed-extras').innerHTML = extrasHTML(); redrawSummary();
        }));
        // dettagli
        const clientSel = $('#ed-client');
        const onClient = () => {
          ed.client_id = clientSel.value; markDirty();
          const c = client();
          if (c && c.language) { ed.language = c.language; $('#ed-lang').value = c.language; }
          $('#ed-clientinfo').innerHTML = c ? clientInfo(c) : '';
          bindClientInfo(); redrawSummary();
        };
        clientSel.addEventListener('change', onClient);
        const bindClientInfo = () => { const b = v.querySelector('[data-act=edit-client]'); b && b.addEventListener('click', () => BL.openClient(ed.client_id, { onSaved: () => { clientSel.innerHTML = clientOpts(); onClient(); } })); };
        bindClientInfo();
        v.querySelector('[data-act=new-client]').addEventListener('click', () => BL.openClient(null, { onSaved: (c) => { ed.client_id = c.id; clientSel.innerHTML = clientOpts(); clientSel.value = c.id; onClient(); } }));
        $('#ed-type').addEventListener('change', e => { ed.order_type = e.target.value; markDirty(); refreshSummary(); });
        $('#ed-lang').addEventListener('change', e => { ed.language = e.target.value; markDirty(); });
        const ag = $('#ed-agent'); ag && ag.addEventListener('change', e => { ed.agent_id = e.target.value || null; markDirty(); });

        // prodotti
        const prodBox = $('#ed-products');
        prodBox.addEventListener('click', e => {
          const z = e.target.closest('[data-zoom]');
          if (z) { e.stopPropagation(); const p = products().find(x => x.id === z.dataset.zoom); if (p) BL.zoomImage(p.image, BL.pname(p), p.sku + ' · ' + t('gender.' + p.gender)); return; }
          const h = e.target.closest('[data-toggle]'); if (!h) return;
          const id = h.dataset.toggle; const el = h.parentElement;
          if (ed.open.has(id)) ed.open.delete(id); else ed.open.add(id);
          el.querySelector('.prod-b').classList.toggle('hidden', !ed.open.has(id));
          h.lastElementChild.style.transform = `rotate(${ed.open.has(id) ? 90 : 0}deg)`;
          if (ed.open.has(id)) { const f = el.querySelector('input'); f && f.focus(); }
        });
        prodBox.addEventListener('input', e => {
          const inp = e.target.closest('input[data-k]'); if (!inp) return;
          let n = Math.floor(Number(inp.value));
          if (!Number.isFinite(n) || n < 0) n = 0;
          if (n > 9999) { n = 9999; inp.value = n; }
          if (n) ed.qty.set(inp.dataset.k, n); else ed.qty.delete(inp.dataset.k);
          inp.classList.toggle('has', !!n); markDirty(); refreshSummary();
        });
        prodBox.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input[data-k]')) { e.preventDefault(); const all = [...prodBox.querySelectorAll('.prod-b:not(.hidden) input[data-k]')]; const i = all.indexOf(e.target); if (all[i + 1]) all[i + 1].focus(); } });
        prodBox.addEventListener('focusin', e => { if (e.target.matches('input[data-k]')) e.target.select(); });
        $('#ed-q').addEventListener('input', e => { ed.filter = e.target.value.trim(); redrawProducts(); });
        $('#ed-cat').addEventListener('change', e => { ed.cat = e.target.value; redrawProducts(); });
        $('#ed-only').addEventListener('change', e => { ed.onlySel = e.target.checked; redrawProducts(); });
        v.querySelector('[data-act=expand]').addEventListener('click', () => {
          const pp = products().filter(BL.hasPrice);
          const all = pp.every(p => ed.open.has(p.id));
          pp.forEach(p => all ? ed.open.delete(p.id) : ed.open.add(p.id)); redrawProducts();
        });

        // extra + note
        const extrasBox = $('#ed-extras');
        extrasBox.addEventListener('click', e => {
          const b = e.target.closest('[data-step]'); if (!b) return;
          const id = b.dataset.step; const n = Math.max(0, (Number(ed.options.extras[id]) || 0) + Number(b.dataset.d));
          ed.options.extras[id] = n; extrasBox.querySelector(`[data-extra="${CSS.escape(id)}"]`).value = n; markDirty(); refreshSummary();
        });
        extrasBox.addEventListener('input', e => { const i = e.target.closest('[data-extra]'); if (!i) return; ed.options.extras[i.dataset.extra] = Math.max(0, Math.floor(Number(i.value) || 0)); markDirty(); refreshSummary(); });
        $('#ed-notes').addEventListener('input', e => { ed.notes = e.target.value; markDirty(); });

        // riepilogo
        function bindSummary() {
          v.querySelectorAll('#ed-summary [data-opt]').forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
            const k = el.dataset.opt;
            ed.options[k] = k === 'shipping' ? (el.value === '' ? null : Math.max(0, Number(el.value))) : Number(el.value);
            markDirty(); refreshSummary();
          }));
          const act = (n, f) => { const b = v.querySelector(`#ed-summary [data-act=${n}]`); b && b.addEventListener('click', f); };
          act('save', () => save(ed.status || 'draft'));
          act('preview', () => {
            const c = client();
            const fake = { number: ed.number || t('editor.previewNumber'), status: 'draft', order_type: ed.order_type, language: ed.language, sport_id: ed.sport_id, agent_id: ed.agent_id || (c && c.owner_id) || S.me.id, created_at: new Date().toISOString(), options: ed.options, notes: ed.notes, client_snapshot: c || {}, totals: compute() };
            BL.openDocument(fake);
          });
        }
        bindSummary();

        async function save(status) {
          if (!ed.sport_id) return BL.toast(t('editor.errSport'), true);
          if (!ed.client_id) { clientSel.focus(); return BL.toast(t('editor.errClient'), true); }
          if (!lines().length) return BL.toast(t('editor.errLines'), true);
          const btns = v.querySelectorAll('#ed-summary .btn'); btns.forEach(b => { b.disabled = true; });
          try {
            const o = await store.saveOrder({ id: ed.id, client_id: ed.client_id, sport_id: ed.sport_id, order_type: ed.order_type, language: ed.language, agent_id: ed.agent_id || undefined, lines: lines(), options: ed.options, notes: ed.notes, status, request_id: ed.request_id });
            if (ed.request_id && !ed.id) {
              const r = S.requests.find(x => x.id === ed.request_id);
              if (r && ['da_rispondere', 'in_trattativa'].includes(r.status)) { try { await store.saveRequest(Object.assign({}, r, { status: 'preventivo_inviato' })); } catch { /* facoltativo */ } }
            }
            ed.dirty = false; BL.editing = null;
            BL.toast(t('quote.saved'));
            await BL.loadAll(); BL.pendingDoc = o; BL.go(back);
          } catch (e) { BL.fail(e); btns.forEach(b => { b.disabled = false; }); }
        }

        actions.querySelector('[data-act=cancel]').addEventListener('click', async () => {
          if (ed.dirty && !await BL.confirmDialog(t('editor.confirmLeave'))) return;
          ed.dirty = false; BL.editing = null; BL.go(back);
        });
      }
    };
  }

  BL.route('/order/new', editorPage);
  BL.route('/order/:id/edit', editorPage);
})();
