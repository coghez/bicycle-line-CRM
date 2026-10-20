/* Preventivo / conferma d'ordine in PDF con il layout del generatore preventivi Bicycle Line
 * (intestazione con logo BL e "Belong to your ride", tabella con foto, riepilogo, condizioni, piè di pagina legale).
 * Usa jsPDF incluso in vendor/ (funziona anche offline e aprendo index.html da file). */
(function () {
  'use strict';
  const { esc, ic, fmt, S } = BL;

  const loaded = {};
  const loadScript = (src) => loaded[src] || (loaded[src] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res;
    s.onerror = () => { delete loaded[src]; rej(new Error('Impossibile caricare ' + src)); };
    document.head.appendChild(s);
  }));

  const imgSize = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res([0, 0]); i.src = src; });
  const toDataURL = async (url) => {
    const b = await (await (window.BLImgFetch ? window.BLImgFetch(url) : fetch(url))).blob();
    return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
  };
  /** foto prodotto come data URL + dimensioni */
  async function productPhoto(p) {
    if (!p || !p.image) return null;
    try {
      if (p.image.startsWith('data:')) { const [w, h] = await imgSize(p.image); return w ? { data: p.image, w, h } : null; }
      if (window.BLImages && window.BLImages[p.image]) { const [d, w, h] = window.BLImages[p.image]; return { data: d, w, h }; }
      const d = await toDataURL(p.image); const [w, h] = await imgSize(d); return w ? { data: d, w, h } : null;
    } catch { return null; }
  }

  async function ensureLibs(needImages) {
    await loadScript('vendor/jspdf.umd.min.js');
    await loadScript('js/brand-assets.js');
    if (needImages && location.protocol === 'file:') { try { await loadScript('js/catalog-images.js'); } catch { /* senza foto */ } }
  }

  // colori del preventivo Bicycle Line
  const C = { slate: [74, 85, 99], brand: [111, 125, 139], light: [238, 241, 244], muted: [138, 149, 161], line: [213, 219, 225], white: [255, 255, 255] };
  const L = 20, R = 190, W = 170, TOP = 49, BOTTOM = 280;

  async function buildQuotePdf(o, lang) {
    const lines0 = (o.totals && o.totals.lines) || [];
    await ensureLibs(lines0.length > 0);
    const T = (k, v) => BL.tIn(lang, k, v);
    const loc = BL.locale(lang);
    const euro = (n) => '€ ' + Number(n || 0).toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const num = (n) => Number(n).toLocaleString(loc);
    const fdate = (d) => { const x = new Date(d); return String(x.getDate()).padStart(2, '0') + '/' + String(x.getMonth() + 1).padStart(2, '0') + '/' + x.getFullYear(); };
    const set = S.settings || {};
    const B = window.BLBrand || {};
    const tot = o.totals;
    const cs = o.client_snapshot || {};
    const isQuote = o.status === 'draft';

    // foto in parallelo
    const photos = await Promise.all(tot.lines.map(l => productPhoto(S.products.find(p => p.id === l.product_id))));
    let logo = { data: B.logo, w: B.logoW, h: B.logoH };
    if (set.logo) { const [w, h] = await imgSize(set.logo); if (w) logo = { data: set.logo, w, h }; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    doc.setProperties({ title: (isQuote ? T('doc.quote') : T('doc.confirmation')) + ' ' + (o.number || '') + ' ' + (cs.name || ''), author: set.company_name || 'Bicycle Line Srl' });
    const font = (size, style = 'normal', color = C.slate) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); };
    const fmtImg = (d) => /^data:image\/png/i.test(d) ? 'PNG' : 'JPEG';
    const fitImg = (img, x, y, bw, bh, alignX, alias) => {
      if (!img || !img.data || !img.w || !img.h) return;
      const k = Math.min(bw / img.w, bh / img.h), w = img.w * k, h = img.h * k;
      const xx = alignX === 'right' ? x + bw - w : alignX === 'center' ? x + (bw - w) / 2 : x;
      doc.addImage(img.data, fmtImg(img.data), xx, y + (bh - h) / 2, w, h, alias, 'FAST');
    };
    const address = String(set.company_address || '').split(/\n/).map(s => s.trim()).filter(Boolean);
    const contacts = [set.company_phone ? 'T ' + set.company_phone : '', set.company_email, (set.company_web || '').replace(/^https?:\/\//, '').replace(/^www\./, '')].filter(Boolean);

    const bg = () => {
      fitImg(logo, 8.8, 10, 25.6, 25.6, 'center', 'hd_logo');
      let yy = 19.1;
      [{ t: set.company_name || 'Bicycle Line Srl', b: true }, ...address.map(t => ({ t }))].forEach(l => { font(9.5, l.b ? 'bold' : 'normal'); doc.text(l.t, 47, yy); yy += 3.45; });
      yy = 19.1;
      contacts.forEach(t => { font(9.5); doc.text(t, 96.5, yy); yy += 3.45; });
      fitImg({ data: B.slogan, w: B.sloganW, h: B.sloganH }, 146, 15.5, 42, 14.5, 'right', 'hd_slogan');
      doc.setDrawColor(...C.slate); doc.setLineWidth(0.25); doc.line(8, 40.1, 202, 40.1);
      doc.line(8, 284.5, 202, 284.5);
      const footer = set.footer ? String(set.footer).replace(/\n/g, '     ') : '';
      if (footer) { let fs = 7; font(fs); while (doc.getTextWidth(footer) > 190 && fs > 4.5) { fs -= 0.25; font(fs); } doc.text(footer, 105 - doc.getTextWidth(footer) / 2, 290); }
    };
    bg();
    const tw = (s, c = 0) => doc.getTextWidth(s) + c * s.length;
    const txt = (s, x, y, op = {}) => {
      const { size = 9.5, style = 'normal', color = C.slate, align = 'left', cs: c = 0 } = op;
      s = String(s); font(size, style, color); doc.setCharSpace(c);
      const w = tw(s, c); const xx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
      doc.text(s, xx, y); doc.setCharSpace(0); return w;
    };
    const wrap = (s, width, size, style = 'normal') => { font(size, style); return doc.splitTextToSize(String(s || ''), width); };
    const label = (s, x, y, align = 'left', color = C.muted) => txt(String(s).toUpperCase(), x, y, { size: 7.5, style: 'bold', color, align, cs: 0.35 });
    const hline = (y, color, lw, x1 = L, x2 = R) => { doc.setDrawColor(...color); doc.setLineWidth(lw); doc.line(x1, y, x2, y); };
    let y = TOP;
    const newPage = () => { doc.addPage(); bg(); y = TOP; };
    const ensure = (h) => { if (y + h > BOTTOM) newPage(); };

    // titolo + dati documento
    txt(isQuote ? T('doc.quote') : T('doc.confirmation'), L, y + 8, { size: 26, style: 'bold' });
    txt(T('pdf.subtitle', { s: BL.sportName(o.sport_id, lang) }), L, y + 14.5, { size: 10.5, color: C.muted });
    const docDate = isQuote ? (o.updated_at || o.created_at) : (o.submitted_at || o.created_at);
    const meta = [[T('doc.number'), o.number], [T('doc.date'), fdate(docDate || new Date())], [T('pdf.place'), set.doc_place || 'Casier (TV)']].filter(m => m[1]);
    let my = y + 14.5 - (meta.length - 1) * 5.5;
    meta.forEach(([k, v]) => { const w = txt(v, R, my, { size: 10, style: 'bold', align: 'right' }); label(k, R - w - 3, my, 'right'); my += 5.5; });
    y += 22;

    // cliente
    const extraSrc = [cs.contact_name ? T('pdf.attn', { n: cs.contact_name }) : '', ...String(cs.billing_address || '').split('\n'), cs.vat_number ? T('doc.vat') + ' ' + cs.vat_number : '', cs.email || '', cs.delivery_address && cs.delivery_address !== cs.billing_address ? T('doc.shipTo') + ': ' + cs.delivery_address.replace(/\n/g, ', ') : ''].filter(Boolean);
    const extra = extraSrc.flatMap(l => wrap(l, W - 14, 9.5));
    const nameLines = wrap(cs.name || ' ', W - 14, 12, 'bold');
    const boxH = 13 + (nameLines.length - 1) * 5.2 + (extra.length ? extra.length * 4.4 + 1.5 : 0) + 3;
    doc.setFillColor(...C.light); doc.rect(L, y, W, boxH, 'F');
    doc.setFillColor(...C.brand); doc.rect(L, y, 1.1, boxH, 'F');
    label(T('pdf.to'), L + 6, y + 6);
    let cy = y + 11.8;
    nameLines.forEach(l => { txt(l, L + 6, cy, { size: 12, style: 'bold' }); cy += 5.2; });
    cy += 0.3;
    extra.forEach(l => { txt(l, L + 6, cy, { size: 9.5 }); cy += 4.4; });
    y += boxH + 9;

    // tabella articoli con foto
    const cols = [{ k: 'photo', t: T('pdf.photo'), w: 34, a: 'center' }, { k: 'art', t: T('orders.article'), w: 56, a: 'left' }, { k: 'qty', t: T('common.qty'), w: 22, a: 'center' }, { k: 'price', t: T('orders.unit'), w: 29, a: 'right' }, { k: 'tot', t: T('orders.total'), w: 29, a: 'right' }];
    let x = L; cols.forEach(c => { c.x = x; x += c.w; });
    const P = 3;
    const colX = (c) => c.a === 'right' ? c.x + c.w - P : c.a === 'center' ? c.x + c.w / 2 : c.x + P;
    const head = () => { doc.setFillColor(...C.brand); doc.rect(L, y, W, 8, 'F'); cols.forEach(c => label(c.t, colX(c), y + 5.2, c.a, C.white)); y += 8; };
    ensure(30); label(T('pdf.items'), L, y); y += 3.5;
    head();
    const genderWord = (p) => p ? (p.kids ? T('product.kids') : p.gender === 'men' ? T('gender.men') : p.gender === 'women' ? T('gender.women') : '') : '';
    const art = cols[1], aw = art.w - 2 * P;
    tot.lines.forEach((li, idx) => {
      const p = S.products.find(pp => pp.id === li.product_id);
      const full = p ? BL.pname(p, lang) : BL.tl(li.name, lang);
      const parts = full.split(' · ');
      const model = parts.length > 1 ? parts[0] : '';
      const title = (parts.length > 1 ? parts.slice(1).join(' · ') : full) + (genderWord(p) ? ' – ' + (lang === 'de' ? genderWord(p) : genderWord(p).toLowerCase()) : '');
      const sizesTxt = li.sizes.map(s => `${s.size} ${s.qty}`).join(' · ');
      const nl = wrap(title, aw, 11, 'bold');
      const ml = model ? wrap(model, aw, 8.5) : [];
      const sl = wrap(T('product.sizes') + ': ' + sizesTxt, aw, 7.5);
      const block = 4.2 + nl.length * 4.8 + (ml.length ? ml.length * 3.8 + 0.6 : 0) + sl.length * 3.4 + 0.8;
      const rowH = Math.max(29, block + 8);
      if (y + rowH > BOTTOM) { newPage(); head(); }
      const pc = cols[0]; const bx = pc.x + 2.5, by = y + 2.5, bw = pc.w - 5, bh = rowH - 5;
      doc.setFillColor(...C.light); doc.rect(bx, by, bw, bh, 'F');
      const ph = photos[idx];
      if (ph) {
        const pad = 1.5, k = Math.min((bw - 2 * pad) / ph.w, (bh - 2 * pad) / ph.h), iw = ph.w * k, ih = ph.h * k;
        doc.addImage(ph.data, fmtImg(ph.data), bx + (bw - iw) / 2, by + (bh - ih) / 2, iw, ih, 'ph_' + li.product_id, 'FAST');
      }
      let ty = y + (rowH - block) / 2 + 3.2;
      txt(li.sku, art.x + P, ty - 0.4, { size: 7.5, color: C.muted, cs: 0.3 }); ty += 4.2;
      nl.forEach(l => { txt(l, art.x + P, ty + 0.6, { size: 11, style: 'bold' }); ty += 4.8; });
      if (ml.length) { ty += 0.2; ml.forEach(l => { txt(l, art.x + P, ty, { size: 8.5, color: C.muted }); ty += 3.8; }); }
      ty += 0.8; sl.forEach(l => { txt(l, art.x + P, ty, { size: 7.5, color: C.muted }); ty += 3.4; });
      const mid = y + rowH / 2 + 1.4;
      txt(num(li.qty) + ' ' + T('common.pcs'), colX(cols[2]), mid, { size: 9.5, style: 'bold', align: 'center' });
      txt(euro(li.unit), colX(cols[3]), mid, { size: 9.5, align: 'right' });
      if (li.mult !== 1) txt(T('pdf.smallQty', { m: num(li.mult) }), colX(cols[3]), mid + 4.2, { size: 6.8, color: C.muted, align: 'right' });
      txt(euro(li.total), colX(cols[4]), mid, { size: 10.5, style: 'bold', align: 'right' });
      y += rowH;
      hline(y, idx === tot.lines.length - 1 ? C.brand : C.line, idx === tot.lines.length - 1 ? 0.4 : 0.2);
    });

    // riepilogo
    {
      const rows = [{ k: T('pdf.goods'), v: euro(tot.goods) }];
      if (tot.setup || tot.setup_waived) rows.push({ k: T('pricing.setup.' + o.order_type), v: tot.setup_waived ? T('pdf.free') : euro(tot.setup) });
      tot.extras_lines.forEach(e => rows.push({ k: BL.tl(e.name, lang) + (e.qty > 1 ? ` × ${e.qty}` : ''), v: euro(e.total) }));
      if (tot.discount) rows.push({ k: T('sum.discount') + ' ' + num(tot.discount_pct) + '%', v: '– ' + euro(tot.discount) });
      if (tot.sponsor) rows.push({ k: T('sum.sponsor') + ' ' + num(tot.sponsor_pct) + '%', v: '– ' + euro(tot.sponsor) });
      rows.push({ k: T('sum.shipping') + (tot.shipping_zone ? ' (' + T('zone.' + tot.shipping_zone) + ')' : ''), v: tot.shipping ? euro(tot.shipping) : T('pdf.free') });
      const showVat = tot.vat_rate > 0;
      const final = [{ k: T('sum.taxable'), v: euro(tot.taxable), strong: true }];
      if (showVat) final.push({ k: T('sum.vat') + ' ' + num(tot.vat_rate) + '%', v: euro(tot.vat) });
      const bw = 82, bx = R - bw;
      const totH = (rows.length + final.length) * 5.9 + 10;
      y += 6; ensure(totH + 14);
      const line = (r, bold) => {
        txt(r.k, bx + P, y + 4.1, { size: 9, style: bold ? 'bold' : 'normal' });
        txt(r.v, R - P, y + 4.1, { size: 9.5, style: bold ? 'bold' : 'normal', align: 'right' });
        y += 5.9; hline(y, C.line, 0.2, bx, R);
      };
      rows.forEach(r => line(r, false));
      final.forEach(r => line(r, r.strong));
      doc.setFillColor(...C.brand); doc.rect(bx, y, bw, 10, 'F');
      label(showVat ? T('pdf.totalVat') : T('pdf.totalNoVat'), bx + P, y + 6.3, 'left', C.white);
      txt(euro(tot.total), R - P, y + 6.6, { size: 12, style: 'bold', color: C.white, align: 'right' });
      y += 10;
      y += 4.5; txt(T('pdf.unitNote'), R, y, { size: 8, style: 'italic', color: C.muted, align: 'right' });
      const regime = cs.vat_regime || 'it';
      if (regime !== 'it') { wrap(T('doc.vatNote.' + regime), bw + 40, 8, 'italic').forEach(l => { y += 4; txt(l, R, y, { size: 8, style: 'italic', color: C.muted, align: 'right' }); }); }
    }

    // condizioni
    const dep = Number(tot.deposit_pct) || 0;
    const validUntil = new Date(new Date(o.updated_at || o.created_at || Date.now()).getTime() + (Number(set.validity_days) || 30) * 864e5);
    const conds = [
      [T('pdf.c.prices'), T('pdf.c.pricesV')],
      [T('pdf.c.delivery'), T('pdf.c.deliveryV', { n: Number(set.delivery_weeks) || 6 })],
      [T('pdf.c.payment'), dep >= 100 ? T('pdf.c.paymentFull') : T('pdf.c.paymentV', { a: num(dep), b: num(100 - dep) }) + ` (${T('sum.deposit').toLowerCase()} ${euro(tot.deposit)})`],
      isQuote ? [T('pdf.c.validity'), T('doc.validity', { d: fdate(validUntil) })] : null,
      set.iban ? ['IBAN', set.iban] : null
    ].filter(Boolean);
    y += 9;
    const crows = conds.map(([k, v]) => { const vl = wrap(v, W - 38, 9.5); const kl = wrap(k, 34, 9, 'bold'); return { kl, vl, h: Math.max(9, Math.max(vl.length, kl.length) * 4.3 + 4.7) }; });
    ensure(4 + crows[0].h);
    label(T('pdf.conditions'), L, y); y += 3.5;
    hline(y, C.line, 0.2);
    crows.forEach(r => {
      if (y + r.h > BOTTOM) { newPage(); hline(y, C.line, 0.2); }
      r.kl.forEach((l, i) => txt(l, L, y + 5.8 + i * 4.3, { size: 9, style: 'bold' }));
      r.vl.forEach((l, i) => txt(l, L + 38, y + 5.8 + i * 4.3, { size: 9.5 }));
      y += r.h; hline(y, C.line, 0.2);
    });

    // note
    if (o.notes && o.notes.trim()) {
      y += 9;
      const nl = o.notes.split('\n').flatMap(l => wrap(l, W, 9.5));
      ensure(6 + Math.min(nl.length, 3) * 4.4);
      label(T('common.notes'), L, y); y += 5.5;
      nl.forEach(l => { ensure(4.4); txt(l, L, y, { size: 9.5 }); y += 4.4; });
    }

    // chiusura
    const cl = T('pdf.closing').split('\n').flatMap(l => wrap(l, W, 9.5));
    y += 9; ensure(cl.length * 4.6 + 6);
    cl.forEach(l => { txt(l, L, y, { size: 9.5 }); y += 4.6; });
    y += 0.4; txt(set.company_name || 'Bicycle Line Srl', L, y, { size: 9.5, style: 'bold' });

    const n = doc.getNumberOfPages();
    if (n > 1) for (let i = 1; i <= n; i++) { doc.setPage(i); txt(T('pdf.page', { i, n }), 202, 282.8, { size: 7.5, color: C.muted, align: 'right' }); }
    return doc;
  }

  const fileName = (o, lang) => {
    const clean = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '');
    return `${clean(o.status === 'draft' ? BL.tIn(lang, 'doc.quote') : BL.tIn(lang, 'doc.confirmation'))}_${clean(o.number)}_${clean((o.client_snapshot || {}).name)}.pdf`;
  };

  /** Anteprima a schermo del PDF + scarica, con scelta lingua */
  BL.openDocument = (o, langOverride) => {
    let lang = langOverride || o.language || 'it';
    let doc = null, busy = false;
    const ov = document.createElement('div');
    ov.className = 'doc-overlay';
    ov.innerHTML = `<div class="docbar"><div class="langsel" data-langs>${BL.LANGS.map(x => `<button data-l="${x.id}" class="${x.id === lang ? 'on' : ''}">${x.id.toUpperCase()}</button>`).join('')}</div>
      <button class="btn" data-act="dl" disabled>${ic('down')}${esc(BL.t('pdf.download'))}</button>
      <button class="btn ghost" data-act="close">${ic('x')}${esc(BL.t('common.close'))}</button></div>
      <div class="pdfwrap"><div class="empty" data-msg>${esc(BL.t('pdf.generating'))}</div><div class="pdfpages hidden" data-pages></div></div>`;
    const pagesEl = ov.querySelector('[data-pages]'), msg = ov.querySelector('[data-msg]'), dl = ov.querySelector('[data-act=dl]');
    const draw = async () => {
      if (busy) return; busy = true; dl.disabled = true;
      msg.classList.remove('hidden'); msg.textContent = BL.t('pdf.generating'); pagesEl.classList.add('hidden');
      try {
        doc = await buildQuotePdf(o, lang);
        dl.disabled = false;
        await renderPages(doc.output('arraybuffer'), pagesEl);
        pagesEl.classList.remove('hidden'); msg.classList.add('hidden');
      } catch (e) { console.error(e); msg.textContent = BL.t('common.error') + ': ' + (e.message || e); }
      busy = false;
    };
    ov.querySelector('[data-langs]').addEventListener('click', (e) => { const b = e.target.closest('[data-l]'); if (!b || busy) return; lang = b.dataset.l; ov.querySelectorAll('[data-l]').forEach(x => x.classList.toggle('on', x.dataset.l === lang)); draw(); });
    dl.addEventListener('click', () => { if (doc) doc.save(fileName(o, lang)); });
    // Esc chiude solo il documento, non la scheda della richiesta che sta sotto
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
    const close = () => { ov.remove(); window.removeEventListener('keydown', onKey, true); };
    ov.querySelector('[data-act=close]').addEventListener('click', close);
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(ov);
    draw();
  };
  /** anteprima: pagine PDF disegnate con pdf.js (funziona anche su telefono) */
  async function renderPages(buf, el) {
    if (location.protocol === 'file:') await loadScript('vendor/pdfjs/pdf.worker.min.js'); // senza Web Worker da file locale
    await loadScript('vendor/pdfjs/pdf.min.js');
    const lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
    const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
    el.innerHTML = '';
    const width = Math.min(900, el.parentElement.clientWidth - 24);
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width, dpr = Math.min(2, window.devicePixelRatio || 1);
      const vp = page.getViewport({ scale: scale * dpr });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.style.width = width + 'px';
      el.appendChild(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }
  }
  BL.buildQuotePdf = buildQuotePdf;
})();
