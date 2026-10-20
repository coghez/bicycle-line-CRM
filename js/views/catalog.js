/* Riepilogo totali del preventivo + Listini consultabili */
(function () {
  'use strict';
  const { t, esc, ic, fmt, S, store } = BL;

  // Gli ordini non hanno più una sezione: restano i preventivi PDF creati dalle richieste (editor.js) e i Listini.

  // ================= Riepilogo totali (condiviso con l'editor) =================
  BL.totalsHTML = (tot, opts = {}) => {
    const l = opts.lang;
    const T = (k, v) => opts.lang ? BL.tIn(l, k, v) : t(k, v);
    const E = (n) => fmt.eur(n, l);
    return `
      <div class="sum"><span class="muted">${esc(T('sum.qty'))}</span><b>${tot.qty} ${esc(T('common.pcs'))}</b></div>
      <div class="sum"><span class="muted">${esc(T('sum.goods'))}</span><b>${E(tot.goods)}</b></div>
      <div class="sum"><span class="muted">${esc(T('sum.setup'))}${tot.setup_waived ? ` <span class="pill plain st-shipped">${esc(T('sum.free'))}</span>` : ''}</span><b>${E(tot.setup)}</b></div>
      ${tot.extras ? `<div class="sum"><span class="muted">${esc(T('sum.extras'))}</span><b>${E(tot.extras)}</b></div>` : ''}
      ${tot.discount ? `<div class="sum neg"><span class="muted">${esc(T('sum.discount'))} ${tot.discount_pct}%</span><b>− ${E(tot.discount)}</b></div>` : ''}
      ${tot.sponsor ? `<div class="sum neg"><span class="muted">${esc(T('sum.sponsor'))} ${tot.sponsor_pct}%</span><b>− ${E(tot.sponsor)}</b></div>` : ''}
      <div class="sum"><span class="muted">${esc(T('sum.shipping'))}${tot.shipping_zone ? ' (' + esc(T('zone.' + tot.shipping_zone)) + ')' : ''}${tot.shipping_free ? ` <span class="pill plain st-shipped">${esc(T('sum.free'))}</span>` : ''}</span><b>${E(tot.shipping)}</b></div>
      <div class="sum"><span class="muted">${esc(T('sum.taxable'))}</span><b>${E(tot.taxable)}</b></div>
      <div class="sum"><span class="muted">${esc(T('sum.vat'))} ${tot.vat_rate}%</span><b>${E(tot.vat)}</b></div>
      <div class="sum total"><span><b style="font:600 13px var(--font)">${esc(T('sum.total'))}</b></span><b>${E(tot.total)}</b></div>
      <div class="sum"><span class="muted">${esc(T('sum.deposit'))} ${tot.deposit_pct}%</span><b>${E(tot.deposit)}</b></div>`;
  };
  // traduzione in una lingua specifica (per il documento)
  BL.tIn = (l, key, vars) => {
    const D = window.BLI18N || {};
    let s = (D[l] && D[l][key]) ?? (D.it && D.it[key]) ?? key;
    if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
    return s;
  };

  // Documento PDF: vedi js/quote-pdf.js (BL.openDocument)

  // ================= LISTINO (consultazione, tutti i ruoli) =================
  BL.route('/catalog', ({ query }) => {
    const sid = query.sport || (S.sports.find(s => BL.sportProducts(s.id).length) || S.sports[0] || {}).id;
    const s = BL.sport(sid);
    let q = '', cat = '', gen = '';
    const rows = () => {
      const all = BL.sportProducts(sid);
      const list = all.filter(p => (!q || (BL.pname(p) + ' ' + p.sku).toLowerCase().includes(q)) && (!cat || p.category === cat) && (!gen || (gen === 'kids' ? p.kids : (!p.kids && (p.gender === gen || p.gender === 'unisex' || p.gender === 'both')))));
      if (!all.length) return `<div class="card empty"><b>${esc(t('catalog.empty'))}</b>${esc(BL.isAdmin() ? t('catalog.emptyAdmin') : t('catalog.emptySub'))}${BL.isAdmin() ? `<div class="mt"><a class="btn" href="#/admin/products?sport=${esc(sid)}">${ic('plus')}${esc(t('admin.addProducts'))}</a></div>` : ''}</div>`;
      if (!list.length) return `<div class="card empty">${esc(t('common.noResults'))}</div>`;
      return `<div class="pgrid">${list.map(p => {
        const tiers = (p.tiers || []).slice().sort((a, b) => a.min - b.min);
        return `<div class="card pcard"><div class="ph" data-zoom="${esc(p.id)}">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : `<span class="faint mono">${esc(p.sku)}</span>`}</div>
          <div class="pb"><b>${esc(BL.pname(p))}</b><div class="meta"><span class="mono">${esc(p.sku)}</span> · ${esc(t('gender.' + p.gender))}${p.kids ? ' · ' + esc(t('product.kids')) : ''} · ${esc(t('cat.' + p.category))}</div>
            <div class="meta">${esc(t('product.sizes'))}: ${esc(p.sizes.join(' '))}</div>
            <div class="tiers">${tiers.length ? tiers.map(x => `<span class="tier">${x.min}+ ${fmt.eur(x.price)}</span>`).join('') : `<span class="noprice">${esc(t('catalog.priceTbd'))}</span>`}</div></div></div>`;
      }).join('')}</div>`;
    };
    const r = s ? BL.pricingRulesSummary(s) : '';
    return {
      title: esc(t('nav.catalog')),
      subtitle: esc(t('catalog.sub')),
      actions: BL.isAdmin() ? `<a class="btn ghost" href="#/admin/products?sport=${esc(sid)}">${ic('edit')}${esc(t('catalog.manage'))}</a>` : '',
      body: `<div class="toolbar"><div class="tabs">${S.sports.map(x => `<a class="tab ${x.id === sid ? 'active' : ''}" href="#/catalog?sport=${x.id}">${esc(BL.tl(x.name))}<span class="n">${BL.sportProducts(x.id).length}</span></a>`).join('')}</div></div>
        <div class="toolbar"><div class="search">${ic('search')}<input class="inp" id="ct-q" placeholder="${esc(t('catalog.search'))}"></div>
          <select class="inp" id="ct-cat" style="max-width:200px"><option value="">${esc(t('editor.allCats'))}</option>${BL.CATEGORIES.filter(c => BL.sportProducts(sid).some(p => p.category === c)).map(c => `<option value="${c}">${esc(t('cat.' + c))}</option>`).join('')}</select>
          <select class="inp" id="ct-gen" style="max-width:170px"><option value="">${esc(t('catalog.allLines'))}</option><option value="men">${esc(t('gender.men'))}</option><option value="women">${esc(t('gender.women'))}</option><option value="kids">${esc(t('product.kids'))}</option></select>
          <span class="grow"></span><span class="hint">${esc(t('catalog.counts', { n: BL.sportProducts(sid).length, p: BL.pricedCount(sid) }))}</span></div>
        <div id="ct-list">${rows()}</div>
        ${r ? `<div class="card mt"><div class="card-h"><h3>${esc(t('catalog.rules'))}</h3></div><div class="card-b">${r}</div></div>` : ''}`,
      mount: (v) => {
        const redraw = () => { v.querySelector('#ct-list').innerHTML = rows(); };
        v.querySelector('#ct-q').addEventListener('input', e => { q = e.target.value.toLowerCase().trim(); redraw(); });
        v.querySelector('#ct-cat').addEventListener('change', e => { cat = e.target.value; redraw(); });
        v.querySelector('#ct-gen').addEventListener('change', e => { gen = e.target.value; redraw(); });
        v.querySelector('#ct-list').addEventListener('click', e => { const z = e.target.closest('[data-zoom]'); if (!z) return; const p = S.products.find(x => x.id === z.dataset.zoom); if (p && p.image) BL.zoomImage(p.image, BL.pname(p), p.sku); });
      }
    };
  });

  BL.pricingRulesSummary = (s) => {
    const r = BL_rules(s);
    const sur = (arr) => arr.slice().sort((a, b) => a.max - b.max).map((x, i, a) => `${i ? (a[i - 1].max + 1) + '–' : (x.max === 1 ? '' : '1–')}${x.max} ${t('common.pcs')}: ×${x.mult}`).join(' · ') || '—';
    return `<div class="grid2" style="font-size:13px">
      <div><b>${esc(t('pricing.tierBasis'))}</b><div class="muted">${esc(t('pricing.basis.' + r.tier_basis))}</div></div>
      <div><b>${esc(t('pricing.surchargeNew'))}</b><div class="muted">${esc(sur(r.surcharge.new))}</div></div>
      <div><b>${esc(t('pricing.setupFees'))}</b><div class="muted">${esc(t('otype.new'))} ${fmt.eur(r.setup_fee.new)} · ${esc(t('otype.modified'))} ${fmt.eur(r.setup_fee.modified)} · ${esc(t('otype.reorder'))} ${fmt.eur(r.setup_fee.reorder)}${r.setup_free_over ? ' · ' + esc(t('pricing.freeOver', { v: fmt.eur(r.setup_free_over) })) : ''}</div></div>
      <div><b>${esc(t('pricing.surchargeReorder'))}</b><div class="muted">${esc(sur(r.surcharge.reorder))}</div></div>
      <div><b>${esc(t('sum.shipping'))}</b><div class="muted">${['it', 'eu', 'extra'].map(z => esc(t('zone.' + z)) + ' ' + fmt.eur(r.shipping[z])).join(' · ')}${r.free_shipping_over ? ' · ' + esc(t('pricing.freeOver', { v: fmt.eur(r.free_shipping_over) })) : ''}</div></div>
      <div><b>${esc(t('sum.extras'))}</b><div class="muted">${r.extras.map(e => esc(BL.tl(e.name)) + ' ' + fmt.eur(e.price)).join(' · ') || '—'}</div></div>
    </div>`;
  };
  const BL_rules = (s) => window.BLPricing.rulesWithDefaults(s.rules);
})();
