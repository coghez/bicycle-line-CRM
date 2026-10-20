/* Richieste (bacheca a colonne, come il CRM originale) + Clienti con promemoria di ricontatto */
(function () {
  'use strict';
  const { t, esc, ic, fmt, S, store } = BL;

  const COUNTRIES = ['IT', 'DE', 'FR', 'ES', 'AT', 'CH', 'BE', 'NL', 'LU', 'PT', 'SI', 'HR', 'PL', 'CZ', 'DK', 'SE', 'IE', 'GB', 'US', 'NO'];
  const EU = window.BLPricing.EU;
  const regimeFor = (c) => !c || c === 'IT' ? 'it' : EU.includes(c) ? 'eu_reverse' : 'extra_eu';
  const today = () => new Date().toISOString().slice(0, 10);

  function guessSport(text) {
    const s = String(text || '').toLowerCase();
    if (!s) return '';
    const alias = { cycling: ['cicl', 'bici', 'bike', 'cycl', 'rad', 'vélo', 'velo', 'mtb', 'gravel', 'strada'], running: ['run', 'corsa', 'atlet', 'lauf', 'course', 'podis', 'marat'], triathlon: ['tri'], speed_skating: ['patt', 'skat', 'patin', 'eisschnell'], rowing: ['canot', 'row', 'rud', 'aviron', 'remo'] };
    for (const [id, keys] of Object.entries(alias)) if (keys.some(k => s.includes(k))) return id;
    return '';
  }
  BL.guessSport = guessSport;

  // ---------- importi e date delle richieste ----------
  const total = (r) => Number(r.order_total) || 0;
  const orderDate = (r) => total(r) ? (r.order_date || String(r.created_at || '').slice(0, 10)) : null;
  BL.reqTotal = total;
  BL.reqOrderDate = orderDate;
  // ---------- prodotti del preventivo -> righe del modulo TAGLIE ----------
  // Stessi campi e stessa logica della funzione SQL bl_cycling_quote_manage (sku, product, gender, expected),
  // così il controllo "non puoi modificare i prodotti" del database li riconosce come identici.
  const AUDIENCES = ['Uomo', 'Donna', 'Unisex', 'Bambino', 'Bambina'];
  const sizeKey = (l) => [String(l.sku || '').toUpperCase(), l.gender || '', l.model || '', l.note || ''].join('|');
  function sizeLinesFromQuote(quote, previous) {
    const old = (Array.isArray(previous) ? previous : []).map(l => ({ l, used: false }));
    return (quote?.items || []).map(it => {
      const name = String(it.name || '').trim().slice(0, 160);
      const gender = AUDIENCES.includes(it.audience) ? it.audience : /donna/i.test(it.name || '') ? 'Donna' : /uomo/i.test(it.name || '') ? 'Uomo' : 'Unisex';
      const line = { sku: String(it.code || '').trim().slice(0, 80), product: name, gender, expected: parseInt(it.qty, 10) || 0, sizes: {} };
      const model = String(it.model || '').trim().slice(0, 80);
      if (model) line.model = model;
      if (it.padFit && it.padFit !== gender && /salopett|pantalon|short|bib|calzoncin/i.test(name + ' ' + (it.category || ''))) line.note = 'Fondello ' + String(it.padFit).toLowerCase();
      // conserva le taglie già inserite dalla squadra per lo stesso articolo
      const match = old.find(o => !o.used && sizeKey(o.l) === sizeKey(line)) || old.find(o => !o.used && String(o.l.sku || '').toUpperCase() === line.sku.toUpperCase() && (o.l.gender || '') === gender);
      if (match) {
        match.used = true;
        for (const [s, q] of Object.entries(match.l.sizes || {})) { const n = parseInt(q, 10); if (n > 0 && n <= 10000) line.sizes[s] = n; }
      }
      return line;
    });
  }
  BL.sizeLinesFromQuote = sizeLinesFromQuote;

  const quotesOf = (r) => S.orders.filter(o => o.request_id != null && String(o.request_id) === String(r.id)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  // ---------- promemoria di ricontatto ----------
  const addMonths = (iso, m) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
  function clientStats(c) {
    const rs = S.requests.filter(r => r.client_id && String(r.client_id) === String(c.id));
    const orders = rs.filter(r => total(r) > 0);
    const last = orders.map(orderDate).sort().pop() || null;
    const base = [last, c.recontacted_at].filter(Boolean).sort().pop() || null;
    const months = Number(S.settings.recontact_months) || 12;
    const due = last ? addMonths(base, months) : null;
    const days = due ? daysBetween(today(), due) : null;
    return { requests: rs, orders, n: orders.length, value: orders.reduce((a, r) => a + total(r), 0), last, due, days, soon: days !== null && days <= 30 };
  }
  BL.clientStats = clientStats;
  BL.recontactDue = () => S.clients.map(c => ({ c, s: clientStats(c) })).filter(x => x.s.soon).sort((a, b) => a.s.days - b.s.days);
  const recontactPill = (s) => {
    if (!s.due) return `<span class="hint">—</span>`;
    if (s.days < 0) return `<span class="pill plain recall late">${ic('phone')}${esc(t('recall.late', { n: -s.days }))}</span>`;
    if (s.days <= 30) return `<span class="pill plain recall soon">${ic('phone')}${esc(s.days === 0 ? t('recall.today') : t('recall.inDays', { n: s.days }))}</span>`;
    return `<span class="hint">${esc(t('recall.on', { d: fmt.date(s.due) }))}</span>`;
  };
  BL.recontactPill = recontactPill;

  /** collega la richiesta a una scheda cliente (stesso nome = stesso cliente), creandola se serve */
  async function ensureClient(req) {
    if (req.client_id && S.clients.some(c => String(c.id) === String(req.client_id))) return req.client_id;
    const name = String(req.team || '').trim();
    const same = S.clients.find(c => c.name.trim().toLowerCase() === name.toLowerCase());
    if (same) return same.id;
    const agent = req.assigned_to && S.users.find(u => u.id === req.assigned_to && u.role === 'agent');
    const client = await store.saveClient({ name, contact_name: req.contact_name || '', email: req.email || '', phone: req.phone || '', country: 'IT', vat_regime: 'it', language: BL.lang, owner_id: agent ? agent.id : S.me.id, notes: '' });
    S.clients.push(client);
    return client.id;
  }

  // ================= RICHIESTE: bacheca =================
  const COLS = BL.REQ_STATUSES;
  BL.route('/requests', ({ query }) => {
    let q = '', who = '';
    const people = () => `<option value="">${esc(t('req.allPeople'))}</option><option value="none">${esc(t('req.unassigned'))}</option>` + S.users.filter(u => u.active !== false).map(u => `<option value="${esc(u.id)}">${esc(u.full_name || u.email)}</option>`).join('');
    const card = (r) => `<article class="ticket" draggable="true" data-id="${esc(r.id)}" tabindex="0">
        <h4>${esc(r.team)}</h4>
        <p>${esc(r.contact_name || t('req.noContact'))}</p>
        <p>${esc(r.sport || '—')} · ${fmt.date(r.created_at)}</p>
        <div class="foot"><span class="pill plain ${r.assigned_to ? '' : 'attn-pill'}">${ic('users')} ${esc(r.assigned_to ? BL.userName(r.assigned_to) : t('req.unassigned'))}</span>
          ${total(r) ? `<span class="pill plain money">${esc(fmt.eurShort(total(r)))}</span>` : ''}</div></article>`;
    const board = () => {
      const list = S.requests.filter(r => (!who || (who === 'none' ? !r.assigned_to : r.assigned_to === who)) &&
        (!q || [r.team, r.contact_name, r.email, r.sport, r.message, r.phone].some(v => String(v || '').toLowerCase().includes(q))));
      return COLS.map(c => {
        const items = list.filter(r => r.status === c);
        const sum = items.reduce((a, r) => a + total(r), 0);
        return `<div class="kcol" data-col="${c}"><div class="kcol-h"><span><span class="dot" style="background:${BL.REQ_COLORS[c]}"></span>${esc(t('req.' + c))}</span><span class="count">${items.length}</span></div>
          ${sum ? `<div class="kcol-sum">${esc(fmt.eurShort(sum))}</div>` : ''}
          ${items.map(card).join('') || `<div class="hint" style="text-align:center;padding:18px 0">${esc(t('req.emptyCol'))}</div>`}</div>`;
      }).join('');
    };
    return {
      title: esc(t('nav.requests')),
      subtitle: esc(BL.isAgent() ? t('req.subAgent') : t('req.sub')),
      actions: `<button class="btn" data-act="new">${ic('plus')}${esc(t('req.new'))}</button>`,
      body: `<div class="toolbar"><div class="search">${ic('search')}<input class="inp" id="rq-q" placeholder="${esc(t('req.search'))}"></div>
          ${BL.isStaff() ? `<select class="inp" id="rq-who" style="max-width:230px">${people()}</select>` : ''}
          <span class="hint grow right">${esc(t('board.dragHint'))}</span></div>
        <div class="kanban" id="board">${board()}</div>`,
      mount: (v, actions) => {
        const boardEl = v.querySelector('#board');
        let drag = null;
        const refresh = () => { boardEl.innerHTML = board(); bind(); };
        const bind = () => {
          boardEl.querySelectorAll('.ticket').forEach(el => {
            el.addEventListener('click', () => openRequest(el.dataset.id));
            el.addEventListener('keydown', e => { if (e.key === 'Enter') openRequest(el.dataset.id); });
            el.addEventListener('dragstart', e => { drag = el.dataset.id; e.dataTransfer.setData('text/plain', drag); el.classList.add('dragging'); });
            el.addEventListener('dragend', () => { el.classList.remove('dragging'); boardEl.querySelectorAll('.over').forEach(c => c.classList.remove('over')); drag = null; });
          });
          boardEl.querySelectorAll('.kcol').forEach(colEl => {
            colEl.addEventListener('dragover', e => { if (!drag) return; e.preventDefault(); colEl.classList.add('over'); });
            colEl.addEventListener('dragleave', e => { if (!colEl.contains(e.relatedTarget)) colEl.classList.remove('over'); });
            colEl.addEventListener('drop', async e => {
              e.preventDefault(); colEl.classList.remove('over');
              const r = S.requests.find(x => String(x.id) === String(drag)); drag = null;
              const target = colEl.dataset.col;
              if (!r || r.status === target) return;
              const prev = r.status; r.status = target; refresh();
              try { await store.saveRequest(r); BL.toast(t('req.moved', { s: t('req.' + target) })); }
              catch (err) { r.status = prev; refresh(); BL.fail(err); }
            });
          });
        };
        bind();
        v.querySelector('#rq-q').addEventListener('input', e => { q = e.target.value.toLowerCase().trim(); refresh(); });
        const w = v.querySelector('#rq-who'); w && w.addEventListener('change', e => { who = e.target.value; refresh(); });
        actions.querySelector('[data-act=new]').addEventListener('click', () => openRequest(null));
        if (query.open) openRequest(query.open);
        if (BL.pendingDoc) { const d = BL.pendingDoc; BL.pendingDoc = null; BL.openDocument(d); } // PDF appena salvato, sopra la richiesta
        if (query.open) { /* già aperta */ }
        else if (query.new) openRequest(null, { client: query.new });
        else if (query.add) openRequest(null);
      }
    };
  });

  // chiudendo una scheda aperta da link (?open=…) l'indirizzo torna pulito, così non si riapre da sola
  const cleanHash = () => { if (/[?&](open|new|add|tab)=/.test(location.hash)) history.replaceState(null, '', location.hash.split('?')[0]); };

  // ================= Scheda della richiesta =================
  async function openRequest(id, { client } = {}) {
    const r = id ? S.requests.find(x => String(x.id) === String(id)) : null;
    if (id && !r) return BL.toast(t('common.notFound'), true);
    const pre = client ? S.clients.find(c => String(c.id) === String(client)) : null;
    const v = r || (pre ? { status: 'da_rispondere', team: pre.name, contact_name: pre.contact_name, email: pre.email, phone: pre.phone, client_id: pre.id, assigned_to: pre.owner_id } : { status: 'da_rispondere' });
    const people = S.users.filter(u => u.active !== false);
    const fld = (k, label, type = 'text', full) => `<label class="f ${full ? 'span-all' : ''}"><span>${esc(label)}</span><input class="inp" name="${k}" type="${type}" value="${esc(v[k] || '')}"></label>`;
    const linked = v.client_id && S.clients.find(c => String(c.id) === String(v.client_id));
    const quotes = r ? quotesOf(r) : [];
    const quoteRow = (o) => `<div class="list-item quote">
        <div class="initials">${ic('file')}</div>
        <div class="grow"><div class="cell-title mono">${esc(o.number)}</div><div class="cell-sub">${esc(BL.sportName(o.sport_id))} · ${o.totals ? o.totals.qty : 0} ${esc(t('common.pcs'))} · ${fmt.date(o.created_at)}</div></div>
        <div class="right"><b class="nowrap">${fmt.eur(o.totals ? o.totals.net : 0)}</b><div class="cell-sub">${esc(t('quote.vatExcl'))}</div></div>
        <div class="row" style="gap:4px">
          <button type="button" class="btn ghost sm" data-q-pdf="${esc(o.id)}" title="PDF">${ic('print')}PDF</button>
          <button type="button" class="btn ghost sm icon" data-q-edit="${esc(o.id)}" title="${esc(t('common.edit'))}">${ic('edit')}</button>
          <button type="button" class="btn ghost sm" data-q-use="${esc(o.id)}" title="${esc(t('quote.useTotalHint'))}">${esc(t('quote.useTotal'))}</button>
        </div></div>`;
    const body = `<form class="stack" id="rqf" onsubmit="return false">
      ${r ? `<div class="row bl-priority-actions" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px"><button type="button" class="btn primary" data-act="quote">${ic('file')} PREVENTIVO</button><button type="button" class="btn primary" data-act="sizes" aria-controls="sizes-panel" aria-expanded="false">${ic('file')} TAGLIE</button></div><div class="ordbox" id="sizes-panel" hidden style="margin-bottom:14px"><div class="sec-title">TAGLIE · link e stato</div><div class="hint mt-s">Invia il link al cliente: compilerà le taglie degli articoli salvati nel preventivo, senza vedere i prezzi.</div><div id="sizes-info" class="mt-s" role="status" aria-live="polite"></div></div>` : ''}
      <div class="grid2">
        <label class="f span-all"><span class="req">${esc(t('req.team'))}</span><input class="inp" name="team" required maxlength="250" value="${esc(v.team || '')}"></label>
        ${fld('contact_name', t('req.contact'))}${fld('sport', t('common.sport'))}
        ${fld('email', t('common.email'), 'email')}${fld('phone', t('common.phone'))}
        ${fld('athletes', t('req.athletes'))}
        <label class="f"><span>${esc(t('req.status'))}</span><select class="inp" name="status">${BL.REQ_STATUSES.map(s => `<option value="${s}" ${v.status === s ? 'selected' : ''}>${esc(t('req.' + s))}</option>`).join('')}</select></label>
        <label class="f span-all"><span>${esc(t('req.message'))}</span><textarea class="inp" name="message" rows="3">${esc(v.message || '')}</textarea></label>
        ${BL.isStaff() ? `<label class="f span-all"><span>${esc(t('req.assigned'))}</span><select class="inp" name="assigned_to"><option value="">${esc(t('req.unassigned'))}</option>${people.map(u => `<option value="${esc(u.id)}" ${v.assigned_to === u.id ? 'selected' : ''}>${esc(u.full_name || u.email)} · ${esc(t('role.' + u.role))}</option>`).join('')}</select></label>` : ''}
        <label class="f span-all"><span>${esc(t('req.notes'))}</span><textarea class="inp" name="notes" rows="3" placeholder="${esc(t('req.notesPh'))}">${esc(v.notes || '')}</textarea></label>
      </div>
      <div class="ordbox">
        <div class="grid2">
          <label class="f"><span>${ic('euro')} ${esc(t('req.orderTotal'))}</span><input class="inp money-inp" name="order_total" id="rq-total" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0,00" value="${v.order_total ?? ''}"></label>
          <label class="f"><span>${esc(t('req.orderDate'))}</span><input class="inp" name="order_date" id="rq-date" type="date" value="${esc(v.order_date || '')}"></label>
        </div>
        <div class="hint mt-s">${esc(t('req.orderTotalHint'))}</div>
        <div class="mt-s" id="rq-client">${linked ? `${ic('users')} ${esc(t('req.linkedClient'))}: <a href="#/clients?open=${esc(linked.id)}" data-close-go>${esc(linked.name)}</a>` : `<span class="hint">${esc(t('req.clientAuto'))}</span>`}</div>
      </div>

      ${r ? `<div><div class="sec-title" style="font-size:15px;margin:10px 0">${ic('chat')} ${esc(t('chat.title'))}</div><div id="rq-comments"><span class="hint">${esc(t('common.loading'))}</span></div></div>` : ''}
      ${r ? `<details><summary class="hint" style="cursor:pointer">${esc(t('common.history'))}</summary><div class="timeline mt-s" id="rq-ev"><span class="hint">${esc(t('common.loading'))}</span></div></details>` : ''}
    </form>`;
    BL.openOverlay({
      title: esc(r ? r.team : t('req.new')), sub: r ? esc(t('req.receivedOn', { d: fmt.dt(r.created_at) })) + (r.source && r.source !== 'manual' ? ' · ' + esc(t('req.fromWebsite')) : '') : esc(t('req.manual')),
      body, onClose: cleanHash,
      foot: `${r && BL.isStaff() ? `<button class="btn danger" data-act="del" style="margin-right:auto">${ic('trash')}</button>` : ''}

        <button class="btn" data-act="save">${esc(t('common.save'))}</button>`,
      onMount: (o) => {
        const form = o.el.querySelector('#rqf');
        const totalInp = o.el.querySelector('#rq-total'), dateInp = o.el.querySelector('#rq-date');
        totalInp.addEventListener('input', () => { if (totalInp.value && !dateInp.value) dateInp.value = today(); });
        const collect = () => {
          const d = Object.fromEntries(new FormData(form));
          return Object.assign({}, r || {}, v.client_id ? { client_id: v.client_id } : {}, d, {
            assigned_to: BL.isStaff() ? (d.assigned_to || null) : (r ? r.assigned_to : S.me.id),
            order_total: d.order_total === '' ? null : Math.round(Number(d.order_total) * 100) / 100,
            order_date: d.order_date || null
          });
        };
        const persist = async () => {
          if (!form.reportValidity()) return null;
          const req = collect();
          if (req.order_total !== null && !(req.order_total >= 0)) { totalInp.focus(); BL.toast(t('req.totalInvalid'), true); return null; }
          if (req.order_total) { req.client_id = await ensureClient(req); if (!req.order_date) req.order_date = today(); }
          return store.saveRequest(req);
        };
        o.el.querySelector('.ov-f [data-act=save]').addEventListener('click', async () => {
          try { const saved = await persist(); if (!saved) return; o.close(); await BL.loadAll(); BL.render(); BL.toast(saved.order_total ? t('req.savedWithTotal', { v: fmt.eur(saved.order_total) }) : t('common.saved')); } catch (e) { BL.fail(e); }
        });
        const del = o.el.querySelector('[data-act=del]');
        del && del.addEventListener('click', async () => {
          if (!await BL.confirmDialog(t('req.confirmDelete'), { danger: true, okLabel: t('common.delete') })) return;
          try { await store.deleteRequest(r.id); o.close(); await BL.loadAll(); BL.render(); } catch (e) { BL.fail(e); }
        });
        let refreshSizesPanel = null; // aggiorna il riquadro TAGLIE dopo il salvataggio del preventivo
        // preventivo: collega/crea il cliente, poi apre l'editor con i prodotti del listino
        o.el.querySelectorAll('[data-act=quote]').forEach(b => b.addEventListener('click', async () => {
          try {
            if (!form.reportValidity()) return;
            const req = collect();
            req.client_id = await ensureClient(req);
            const saved = await store.saveRequest(req);
            if (!store.manageCiclismoQuote) throw Error('Preventivi integrati disponibili solo con Supabase.');
            const origin=location.origin;
            const quoteUrl='preventivo.html?request='+encodeURIComponent(saved.id)+'&v=15';
            const popup=document.createElement('div');
            popup.style.cssText='position:fixed;inset:0;background:#f1f3f7;z-index:100005;display:flex;flex-direction:column';
            popup.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 17px;background:#fff;border-bottom:1px solid #ddd"><strong>Preventivo · '+esc(saved.team)+'</strong><button type="button" class="btn" id="bl-close-quote">Chiudi</button></div><iframe title="Preventivo Bicycle Line" style="border:0;flex:1;width:100%" src="'+quoteUrl+'"></iframe>';
            document.body.append(popup);
            const frame=popup.querySelector('iframe');
            // Ogni passaggio ha un tempo massimo: il preventivatore riceve sempre una risposta (mai attese infinite).
            const step=(label,promise,ms=15000)=>Promise.race([promise,new Promise((_,rej)=>setTimeout(()=>rej(Error(label+': il database non ha risposto entro '+Math.round(ms/1000)+' secondi. Controlla la connessione e riprova.')),ms))]);
            let loading=false;
            let saving=null; // salvataggio in corso: un secondo clic riceve lo stesso esito, senza doppio salvataggio
            const onMessage=async (ev)=>{
              // Si accettano solo messaggi dell'iframe aperto qui (controllo sulla finestra mittente), anche se il server
              // presenta il preventivo con un indirizzo leggermente diverso (www, redirect, http/https).
              if(ev.source!==frame.contentWindow || ev.data?.blQuoteBridge!==true || String(ev.data.request)!==String(saved.id))return;
              const reply=(type,rest={})=>frame.contentWindow?.postMessage({blQuoteBridge:true,request:String(saved.id),type,...rest},'*');
              try{
                if(ev.data.type==='ready'){
                  reply('hello',{crmOrigin:origin});
                  if(loading) return; loading=true;
                  let result;
                  try { result=await step('Caricamento preventivo', store.manageCiclismoQuote(saved.id,'get'), 20000); }
                  catch(e){
                    const msg=/could not find|does not exist|schema cache/i.test(e.message||'')?'sul database manca la funzione dei preventivi (script supabase/04_preventivi_ciclismo.sql).':(e.message||String(e));
                    reply('loaded',{failed:true,message:msg}); return;
                  }
                  const SPORT_TAB={cycling:'Ciclismo',running:'Running',triathlon:'Triathlon',speed_skating:'Pattinaggio',rowing:'Canottaggio'};
                  const cl=S.clients?.find(c=>String(c.id)===String(saved.client_id))||null;
                  reply('loaded',{quote:result?.quote||null,team:saved.team,contact:saved.contact_name,email:saved.email||'',phone:saved.phone||'',
                    sport:SPORT_TAB[guessSport(saved.sport)]||'',
                    client:cl?{email:cl.email||'',phone:cl.phone||'',country:cl.country||'',billing_address:cl.billing_address||''}:null,
                    // prezzi della sezione Prodotti: il preventivo usa questi (stessa fonte del CRM)
                    prices:(S.products||[]).filter(p=>p.active!==false).map(p=>({sport_id:p.sport_id,sku:p.sku,tiers:p.tiers||[]}))});
                }
                if(ev.data.type==='save'){
                  reply('saving');
                  if(saving){ const res=await saving; reply(res.type,res.rest); return; }
                  let done; saving=new Promise(r=>done=r);
                  try{
                  const quote=ev.data.quote;
                  const expectedLines = quote?.items?.length || 0;
                  const expectedNet = Number(quote?.crmNet);
                  if (!expectedLines) throw Error('Aggiungi almeno un prodotto al preventivo.');
                  if (!Number.isFinite(expectedNet)) throw Error('Totale del preventivo non valido.');
                  // 1) Modulo TAGLIE della task (lo crea se non esiste) e taglie già inserite dalla squadra.
                  const before = await step('Lettura modulo TAGLIE', store.manageSizes(saved.id,'create'));
                  if (!before?.token) throw Error('Impossibile creare il modulo TAGLIE per questa task.');
                  if (before.status==='ricevuto') throw Error('La squadra ha già confermato le taglie: apri TAGLIE e premi «Riapri» prima di modificare il preventivo.');
                  // 1b) Numero preventivo automatico (01.26, 02.26 …): uno per task, resta uguale ai salvataggi successivi.
                  let quoteNo = String(quote.number||'').trim();
                  if (!quoteNo && store.quoteNumber) {
                    try { quoteNo = await step('Numero preventivo', store.quoteNumber(saved.id)); quote.number = quoteNo; }
                    catch(e){ console.warn('Numerazione preventivi non disponibile', e); if (BL.isAdmin()) BL.checkQuoteNumbering?.(true); }
                  }
                  // 2) Preventivo e totale nella task.
                  try { await step('Salvataggio preventivo', store.manageCiclismoQuote(saved.id,'save',quote)); }
                  catch(e){
                    if (/could not find|does not exist|schema cache/i.test(e.message||'')) throw Error('Sul database manca la funzione dei preventivi (script supabase/04_preventivi_ciclismo.sql).');
                    throw e;
                  }
                  // 3) Prodotti nel link TAGLIE: li scrive sempre il CRM, mantenendo le taglie già compilate.
                  const lines = sizeLinesFromQuote(quote, before.lines);
                  await step('Scrittura prodotti nel link TAGLIE', store.syncSizeLines(before.token, lines));
                  // 4) Verifica reale sul database: non mostrare "salvato" se i dati non sono recuperabili.
                  let [storedQuote, storedSizes, storedRequest] = await step('Verifica salvataggio', Promise.all([
                    store.manageCiclismoQuote(saved.id,'get'),
                    store.manageSizes(saved.id,'get'),
                    store.getRequestById(saved.id)
                  ]));
                  if (Math.abs(Number(storedRequest?.order_total) - expectedNet) > 0.011) storedRequest = await step('Aggiornamento totale task', store.setRequestTotal(saved.id, expectedNet));
                  const sizesOk = Array.isArray(storedSizes?.lines) && storedSizes.lines.length === expectedLines &&
                    storedSizes.lines.every((l,i)=>String(l.sku)===lines[i].sku && Number(l.expected)===lines[i].expected);
                  if (!storedQuote?.quote) throw Error('Il database non ha confermato il salvataggio del preventivo.');
                  if (!sizesOk) throw Error('Il preventivo è salvato ma i prodotti non risultano nel link TAGLIE. Riprova; se l’errore resta, va aggiornato lo script supabase/04_preventivi_ciclismo.sql.');
                  if (Math.abs(Number(storedRequest?.order_total) - expectedNet) > 0.011) throw Error('Il database non ha confermato il totale del preventivo nella task.');
                  if (refreshSizesPanel) refreshSizesPanel(storedSizes);
                  totalInp.value=expectedNet.toFixed(2);
                  if(!dateInp.value)dateInp.value=storedRequest.order_date || today();
                  // Evita che una successiva apertura della scheda mostri valori obsoleti.
                  r.order_total=Number(storedRequest.order_total);
                  r.order_date=storedRequest.order_date;
                  const cacheRequest=S.requests?.find(x=>String(x.id)===String(saved.id));
                  if(cacheRequest){cacheRequest.order_total=r.order_total;cacheRequest.order_date=r.order_date;}
                  done({type:'saved',rest:{total:expectedNet,products:expectedLines,number:quoteNo}});
                  reply('saved',{total:expectedNet,products:expectedLines,number:quoteNo});
                  BL.toast('Preventivo salvato: totale '+fmt.eur(expectedNet)+' · '+expectedLines+' prodotti pronti nel link TAGLIE');
                  }catch(err){ done({type:'error',rest:{message:err.message||String(err)}}); throw err; }
                  finally{ saving=null; }
                }
              }catch(err){reply('error',{message:err.message||String(err)});}
            };
            window.addEventListener('message',onMessage);
            popup.querySelector('#bl-close-quote').onclick=async()=>{window.removeEventListener('message',onMessage);popup.remove();try{await BL.loadAll(); BL.render();}catch(e){BL.fail(e);}};
          } catch (e) { BL.fail(e); }
        }));
        o.el.querySelectorAll('[data-q-pdf]').forEach(b => b.addEventListener('click', () => { const q = S.orders.find(x => x.id === b.dataset.qPdf); if (q) BL.openDocument(q); }));
        o.el.querySelectorAll('[data-q-edit]').forEach(b => b.addEventListener('click', () => { o.close(); BL.go(`#/order/${b.dataset.qEdit}/edit`); }));
        o.el.querySelectorAll('[data-q-use]').forEach(b => b.addEventListener('click', () => {
          const q = S.orders.find(x => x.id === b.dataset.qUse); if (!q || !q.totals) return;
          totalInp.value = q.totals.net; if (!dateInp.value) dateInp.value = today();
          totalInp.classList.add('flash'); setTimeout(() => totalInp.classList.remove('flash'), 900);
          BL.toast(t('quote.totalCopied'));
        }));
        o.el.querySelectorAll('[data-close-go]').forEach(a => a.addEventListener('click', () => o.close()));
        if (r) {
          const b = o.el.querySelector('[data-act=sizes]'), info = o.el.querySelector('#sizes-info');
          const sizesUrl = token => new URL('taglie.html?t=' + encodeURIComponent(token), location.href.split('#')[0]).href;
          const showSize = f => {
            if (!f) { info.textContent = 'Nessun link generato.'; return; }
            const url = sizesUrl(f.token);
            info.innerHTML = `<div class="hint">Stato: <b>${esc(f.status)}</b> · ${Array.isArray(f.lines) ? f.lines.length : 0} prodotti</div><div class="row mt-s" style="flex-wrap:wrap;gap:6px"><button type="button" class="btn sm ghost" data-sz="copy">Copia link</button><button type="button" class="btn sm ghost" data-sz="open">Apri modulo</button><button type="button" class="btn sm ghost" data-sz="csv">Scarica CSV taglie</button><button type="button" class="btn sm ghost" data-sz="reopen">Riapri</button><button type="button" class="btn sm ghost" data-sz="revoke">Rigenera link</button></div>`;
            info.querySelector('[data-sz=copy]').onclick = async () => { try { await navigator.clipboard.writeText(url); BL.toast('Link copiato'); } catch { prompt('Copia il link:', url); } };
            info.querySelector('[data-sz=open]').onclick = () => window.open(url,'_blank','noopener');
            info.querySelector('[data-sz=csv]').onclick = () => {
              const rows = [['Squadra','Codice','Prodotto','Genere','Taglia','Quantità']];
              for (const l of f.lines || []) for (const [size,qty] of Object.entries(l.sizes||{})) if (Number(qty)>0) rows.push([r.team,l.sku,l.product,l.gender,size,qty]);
              const csv = '\ufeff'+ rows.map(row=>row.map(v=>'"'+String(v??'').replace(/^[=+@-]/,x=>"'"+x).replace(/"/g,'""')+'"').join(';')).join('\r\n');
              const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='taglie-'+String(r.team).replace(/[^a-z0-9_-]/gi,'_')+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
            };
            for (const action of ['reopen','revoke']) info.querySelector('[data-sz='+action+']').onclick = async () => {
              if (!confirm(action==='revoke'?'Il vecchio link smetterà di funzionare. Proseguire?':'Riaprire le taglie per le modifiche?')) return;
              try { showSize(await store.manageSizes(r.id,action)); BL.toast('Aggiornato'); } catch(e){BL.fail(e);}
            };
          };
          const panel = o.el.querySelector('#sizes-panel');
          refreshSizesPanel = f => { if (!panel.hidden && f) showSize(f); };
          b.onclick = async () => {
            panel.hidden = false;
            b.setAttribute('aria-expanded','true');
            info.textContent = 'Caricamento link TAGLIE…';
            b.disabled = true;
            try {
              if (!store.manageSizes) throw new Error('Modulo TAGLIE non disponibile: controlla che tutti i file del CRM siano aggiornati.');
              const result = await store.manageSizes(r.id,'create');
              showSize(result);
              if (!result) info.textContent = 'Non è stato possibile generare il link. Verifica la configurazione Supabase.';
            } catch(e) {
              info.textContent = 'Impossibile aprire TAGLIE: '+(e?.message || String(e));
              BL.fail(e);
            } finally { b.disabled = false; }
          };
          // Non caricare silenziosamente il form: il pulsante mostra sempre un risultato visibile.
        }
        if (r) BL.mountRequestComments(o.el.querySelector('#rq-comments'), r);
        if (r) store.listRequestEvents(r.id).then(evs => {
          const el = o.el.querySelector('#rq-ev'); if (!el) return;
          el.innerHTML = evs.map(e => `<div class="ev"><b>${esc(e.event_type === 'created' ? t('ev.reqCreated') : t('ev.reqUpdated'))}</b> ${Object.keys(e.detail || {}).filter(k => k !== 'source').map(k => esc(t('ev.f.' + k))).join(', ')}<small>${esc(e.actor ? BL.userName(e.actor) : t('ev.automation'))} · ${fmt.dt(e.created_at)}</small></div>`).join('') || `<span class="hint">${esc(t('common.noActivity'))}</span>`;
        }).catch(() => { const el = o.el.querySelector('#rq-ev'); if (el) el.textContent = t('common.unavailable'); });
      }
    });
  }
  BL.openRequest = openRequest;

  // ================= CLIENTI =================
  BL.route('/clients', ({ query }) => {
    let q = '', tab = query.tab || 'all';
    const rows = () => {
      const list = S.clients.map(c => ({ c, s: clientStats(c) }))
        .filter(({ c, s }) => (tab === 'all' || s.soon) && (!q || [c.name, c.contact_name, c.email, c.country, c.vat_number, BL.userName(c.owner_id)].some(x => String(x || '').toLowerCase().includes(q))))
        .sort((a, b) => tab === 'recall' ? a.s.days - b.s.days : a.c.name.localeCompare(b.c.name));
      if (!list.length) return `<tr><td colspan="7"><div class="empty"><b>${esc(S.clients.length ? (tab === 'recall' ? t('clients.noRecall') : t('common.noResults')) : t('clients.empty'))}</b>${esc(S.clients.length ? '' : t('clients.emptySub'))}</div></td></tr>`;
      return list.map(({ c, s }) => `<tr class="click ${s.soon ? 'has-unread' : ''}" data-id="${esc(c.id)}">
        <td><div class="row"><div class="initials">${esc(BL.initials(c.name))}</div><div><div class="cell-title">${esc(c.name)}</div><div class="cell-sub">${esc(c.contact_name || '—')}</div></div></div></td>
        <td><div>${esc(c.email || '—')}</div><div class="cell-sub">${esc(c.phone || '')}</div></td>
        ${BL.isStaff() ? `<td>${esc(BL.userName(c.owner_id))}</td>` : ''}
        <td class="num">${s.n}</td><td class="num"><b>${s.value ? fmt.eur(s.value) : '—'}</b></td>
        <td class="nowrap">${s.last ? fmt.date(s.last) : '—'}</td>
        <td>${recontactPill(s)}</td></tr>`).join('');
    };
    const nRecall = () => BL.recontactDue().length;
    const tabs = () => `<button class="tab ${tab === 'all' ? 'active' : ''}" data-tab="all">${esc(t('common.all'))}<span class="n">${S.clients.length}</span></button><button class="tab ${tab === 'recall' ? 'active' : ''} ${nRecall() ? 'attn' : ''}" data-tab="recall">${esc(t('clients.tabRecall'))}<span class="n">${nRecall()}</span></button>`;
    return {
      title: esc(BL.isAgent() ? t('nav.myClients') : t('nav.clients')),
      subtitle: esc(t('clients.subRecall', { m: Number(S.settings.recontact_months) || 12 })),
      actions: `<button class="btn" data-act="new">${ic('plus')}${esc(t('clients.new'))}</button>`,
      body: `<div class="toolbar"><div class="tabs" id="cl-tabs">${tabs()}</div><div class="search">${ic('search')}<input class="inp" id="cl-q" placeholder="${esc(t('clients.search'))}"></div></div>
        <div class="card tablewrap"><table class="t"><thead><tr><th>${esc(t('clients.client'))}</th><th>${esc(t('clients.contacts'))}</th>${BL.isStaff() ? `<th>${esc(t('common.agent'))}</th>` : ''}<th class="num">${esc(t('clients.ordersN'))}</th><th class="num">${esc(t('clients.value'))}</th><th>${esc(t('clients.lastOrder'))}</th><th>${esc(t('clients.recall'))}</th></tr></thead><tbody id="cl-body">${rows()}</tbody></table></div>`,
      mount: (v, actions) => {
        const bind = () => v.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => openClient(tr.dataset.id)));
        const refresh = () => { v.querySelector('#cl-body').innerHTML = rows(); bind(); };
        bind();
        v.querySelector('#cl-tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; tab = b.dataset.tab; v.querySelector('#cl-tabs').innerHTML = tabs(); refresh(); });
        v.querySelector('#cl-q').addEventListener('input', e => { q = e.target.value.toLowerCase().trim(); refresh(); });
        actions.querySelector('[data-act=new]').addEventListener('click', () => openClient(null));
        if (query.open) openClient(query.open);
      }
    };
  });

  function clientForm(c) {
    const agents = S.users.filter(u => u.active !== false);
    return `<form class="grid2" id="clf" onsubmit="return false">
      <label class="f span-all"><span class="req">${esc(t('clients.name'))}</span><input class="inp" name="name" required value="${esc(c.name || '')}" placeholder="${esc(t('clients.namePh'))}"></label>
      <label class="f"><span>${esc(t('req.contact'))}</span><input class="inp" name="contact_name" value="${esc(c.contact_name || '')}"></label>
      <label class="f"><span>${esc(t('common.email'))}</span><input class="inp" type="email" name="email" value="${esc(c.email || '')}"></label>
      <label class="f"><span>${esc(t('common.phone'))}</span><input class="inp" name="phone" value="${esc(c.phone || '')}"></label>
      <label class="f"><span>${esc(t('clients.vatNumber'))}</span><input class="inp" name="vat_number" value="${esc(c.vat_number || '')}"></label>
      <label class="f"><span>${esc(t('clients.country'))}</span><input class="inp" name="country" list="countries" maxlength="2" style="text-transform:uppercase" value="${esc(c.country || 'IT')}"><datalist id="countries">${COUNTRIES.map(x => `<option value="${x}">`).join('')}</datalist></label>
      <label class="f"><span>${esc(t('clients.vatRegime'))}</span><select class="inp" name="vat_regime">${['it', 'eu_reverse', 'extra_eu'].map(x => `<option value="${x}" ${(c.vat_regime || 'it') === x ? 'selected' : ''}>${esc(t('vat.' + x))}</option>`).join('')}</select></label>
      <label class="f"><span>${esc(t('clients.docLang'))}</span><select class="inp" name="language">${BL.LANGS.map(l => `<option value="${l.id}" ${(c.language || BL.lang) === l.id ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select></label>
      ${BL.isStaff() ? `<label class="f"><span>${esc(t('clients.owner'))}</span><select class="inp" name="owner_id">${agents.map(u => `<option value="${esc(u.id)}" ${(c.owner_id || S.me.id) === u.id ? 'selected' : ''}>${esc(u.full_name || u.email)} · ${esc(t('role.' + u.role))}</option>`).join('')}</select></label>` : ''}
      <label class="f span-all"><span>${esc(t('clients.billing'))}</span><textarea class="inp" name="billing_address" rows="2">${esc(c.billing_address || '')}</textarea></label>
      <label class="f span-all"><span>${esc(t('clients.delivery'))}</span><textarea class="inp" name="delivery_address" rows="2" placeholder="${esc(t('clients.deliveryPh'))}">${esc(c.delivery_address || '')}</textarea></label>
      <label class="f span-all"><span>${esc(t('common.notes'))}</span><textarea class="inp" name="notes" rows="2">${esc(c.notes || '')}</textarea></label>
    </form>`;
  }

  function openClient(id, { onSaved } = {}) {
    const c = id ? S.clients.find(x => String(x.id) === String(id)) : null;
    if (id && !c) return BL.toast(t('common.notFound'), true);
    const s = c ? clientStats(c) : null;
    const recall = c && s.last ? `<div class="recallbox ${s.soon ? 'due' : ''}">
        <div class="grow"><b>${ic('phone')} ${esc(s.days < 0 ? t('recall.lateLong', { n: -s.days }) : s.soon ? t('recall.soonLong', { d: fmt.date(s.due) }) : t('recall.nextLong', { d: fmt.date(s.due) }))}</b>
        <div class="hint">${esc(t('recall.basis', { d: fmt.date(s.last), m: Number(S.settings.recontact_months) || 12 }))}${c.recontacted_at ? ' · ' + esc(t('recall.lastContact', { d: fmt.date(c.recontacted_at) })) : ''}</div></div>
        <button type="button" class="btn ghost sm" data-act="contacted">${ic('check')}${esc(t('recall.done'))}</button></div>` : '';
    const history = c ? `<div class="mt"><div class="row between"><div class="sec-title" style="font-size:15px;margin:0">${esc(t('clients.history'))} (${s.requests.length})</div><button type="button" class="btn sm" data-act="newreq">${ic('plus')}${esc(t('clients.newRequest'))}</button></div>
        <div class="mt-s">${s.requests.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(r => `<div class="list-item click" data-req="${esc(r.id)}"><div class="grow"><div class="cell-title">${esc(r.team)}</div><div class="cell-sub">${fmt.date(orderDate(r) || r.created_at)} · ${esc(t('req.' + r.status))}</div></div><b class="nowrap">${total(r) ? fmt.eur(total(r)) : '—'}</b></div>`).join('') || `<div class="hint">${esc(t('clients.noOrders'))}</div>`}</div></div>` : '';
    BL.openOverlay({
      title: esc(c ? c.name : t('clients.new')),
      sub: c ? esc(t('clients.since', { d: fmt.date(c.created_at) })) + (s.value ? ' · ' + esc(t('clients.totalSpent', { v: fmt.eur(s.value), n: s.n })) : '') : '',
      body: recall + clientForm(c || {}) + history, onClose: cleanHash,
      foot: `${c && BL.isStaff() ? `<button class="btn danger" data-act="del" style="margin-right:auto">${ic('trash')}</button>` : ''}<button class="btn ghost" data-close>${esc(t('common.cancel'))}</button><button class="btn" data-act="save">${esc(t('common.save'))}</button>`,
      onMount: (o) => {
        const form = o.el.querySelector('#clf');
        const country = form.querySelector('[name=country]'), regime = form.querySelector('[name=vat_regime]');
        country.addEventListener('change', () => { country.value = country.value.toUpperCase(); regime.value = regimeFor(country.value); });
        o.el.querySelectorAll('[data-req]').forEach(el => el.addEventListener('click', () => { o.close(); openRequest(el.dataset.req); }));
        const nr = o.el.querySelector('[data-act=newreq]');
        nr && nr.addEventListener('click', () => { o.close(); BL.go('#/requests?new=' + encodeURIComponent(c.id)); });
        const ct = o.el.querySelector('[data-act=contacted]');
        ct && ct.addEventListener('click', async () => {
          try { await store.saveClient(Object.assign({}, c, { recontacted_at: today() })); o.close(); await BL.loadAll(); BL.render(); BL.toast(t('recall.doneToast')); } catch (e) { BL.fail(e); }
        });
        o.el.querySelector('[data-act=save]').addEventListener('click', async () => {
          if (!form.reportValidity()) return;
          const d = Object.fromEntries(new FormData(form)); d.country = (d.country || '').toUpperCase();
          try {
            const saved = await store.saveClient(Object.assign({}, c || {}, d));
            o.close(); await BL.loadAll(); BL.toast(t('common.saved'));
            if (onSaved) onSaved(saved); else BL.render();
          } catch (e) { BL.fail(e); }
        });
        const del = o.el.querySelector('[data-act=del]');
        del && del.addEventListener('click', async () => {
          if (!await BL.confirmDialog(t('clients.confirmDelete'), { danger: true, okLabel: t('common.delete') })) return;
          try { await store.deleteClient(c.id); o.close(); await BL.loadAll(); BL.render(); } catch (e) { BL.fail(e); }
        });
      }
    });
  }
  BL.openClient = openClient;
  BL.regimeFor = regimeFor;
})();
