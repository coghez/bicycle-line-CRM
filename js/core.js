/* Bicycle Line Studio — nucleo: stato, i18n, router, layout, componenti UI */
(function () {
  'use strict';
  const CFG = Object.assign({ mode: 'demo' }, window.BL_CONFIG || {});
  if (/[?&]demo\b/.test(location.search)) CFG.mode = 'demo'; // index.html?demo → prova senza toccare i dati veri
  const store = CFG.mode === 'supabase' ? window.BLSupabaseStore : window.BLLocalStore;

  const LANGS = [
    { id: 'it', label: 'Italiano', locale: 'it-IT' },
    { id: 'en', label: 'English', locale: 'en-GB' },
    { id: 'fr', label: 'Français', locale: 'fr-FR' },
    { id: 'de', label: 'Deutsch', locale: 'de-DE' },
    { id: 'es', label: 'Español', locale: 'es-ES' }
  ];
  const ORDER_STATUSES = ['draft', 'submitted', 'approved', 'production', 'shipped', 'cancelled'];
  const ORDER_FLOW = ['draft', 'submitted', 'approved', 'production', 'shipped'];
  const normStatus = (st) => st === 'review' ? 'submitted' : st === 'design' ? 'approved' : st; // stati del vecchio flusso
  const REQ_STATUSES = ['da_rispondere', 'preventivo_inviato', 'completato']; // Richiesta ricevuta → Preventivo inviato → Trello
  // stati del CRM precedente che non hanno più una colonna
  const normReq = (st) => st === 'in_trattativa' ? 'da_rispondere' : st === 'in_lavorazione' ? 'completato' : (st || 'da_rispondere');
  const REQ_COLORS = { da_rispondere: '#d08a1e', in_trattativa: '#2c62a8', preventivo_inviato: '#6046b0', in_lavorazione: '#b3243a', completato: '#1f7a4d' };
  const CATEGORIES = ['top', 'bottom', 'outer', 'set', 'body', 'accessory'];

  const S = { me: null, sports: [], products: [], settings: {}, users: [], clients: [], orders: [], requests: [], unread: {}, mentions: [], loaded: false };

  // ---------- i18n ----------
  const safeLS = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* */ } }
  };
  let lang = safeLS.get('bl_lang') || ((navigator.language || 'it').slice(0, 2));
  if (!LANGS.some(l => l.id === lang)) lang = 'it';
  function t(key, vars) {
    const D = window.BLI18N || {};
    let s = (D[lang] && D[lang][key]) ?? (D.it && D.it[key]) ?? key;
    if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
    return s;
  }
  function tl(obj, l) { // testo multilingua {it,en,...}
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    return obj[l || lang] || obj.it || obj.en || Object.values(obj).find(Boolean) || '';
  }
  const locale = (l) => (LANGS.find(x => x.id === (l || lang)) || LANGS[0]).locale;
  const fmt = {
    eur: (n, l) => new Intl.NumberFormat(locale(l), { style: 'currency', currency: 'EUR' }).format(Number(n) || 0),
    num: (n, l) => new Intl.NumberFormat(locale(l)).format(Number(n) || 0),
    date: (d, l) => d ? new Date(d).toLocaleDateString(locale(l), { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
    dt: (d, l) => d ? new Date(d).toLocaleString(locale(l), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—',
    eurShort: (n) => {
      n = Number(n) || 0;
      if (Math.abs(n) >= 1e6) return new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 }).format(n);
      return new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
    }
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => [...(el || document).querySelectorAll(sel)];
  const initials = (s) => String(s || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  // ---------- Icone ----------
  const P = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
    inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.4 3.5 5.2"/>',
    file: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    chevd: '<path d="m6 9 6 6 6-6"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><path d="M7 14h10v7H7z"/>',
    down: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    up: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    arrowup: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    arrowdown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
    tag: '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    clip: '<path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7"/>',
    euro: '<path d="M18 6.5A7 7 0 1 0 18 17.5M4 10h10M4 14h10"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="14.5" cy="7" r="1"/>',
    box2: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/>',
    truck: '<path d="M2 6h12v10H2zM14 10h4l3 3v3h-7"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h0"/>',
    at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
    columns: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>'
  };
  const ic = (n, cls) => `<svg class="i ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;

  // ---------- Permessi ----------
  const role = () => S.me ? S.me.role : null;
  const isAdmin = () => role() === 'admin';
  const isStaff = () => role() === 'admin' || role() === 'staff';
  const isAgent = () => role() === 'agent';
  const unreadTotal = () => Object.values(S.unread || {}).reduce((a, b) => a + b, 0);
  const mentionsUnread = () => (S.mentions || []).filter(m => m.unread).length;

  // ---------- Helpers dominio ----------
  const sport = (id) => S.sports.find(s => s.id === id);
  const sportName = (id, l) => { const s = sport(id); return s ? tl(s.name, l) : id; };
  const sportChip = (id) => { const s = sport(id); if (!s) return esc(id || '—'); return `<span class="sport-chip"><i style="background:${esc(s.color)}">${esc(s.code)}</i>${esc(tl(s.name))}</span>`; };
  const pname = (p, l) => tl(p && p.name, l);
  const userName = (id) => { const u = S.users.find(x => x.id === id); return u ? (u.full_name || u.email) : (id ? '—' : t('common.unassigned')); };
  const clientName = (id) => { const c = S.clients.find(x => x.id === id); return c ? c.name : '—'; };
  const statusPill = (st) => { st = normStatus(st); return `<span class="pill st-${esc(st)}">${esc(t('status.' + st))}</span>`; };
  const rolePill = (r) => `<span class="pill plain role-${esc(r)}">${esc(t('role.' + r))}</span>`;
  const sportProducts = (sid, all) => S.products.filter(p => p.sport_id === sid && (all || p.active !== false));
  const hasPrice = (p) => (p.tiers || []).some(x => Number(x.price) > 0);
  const pricedCount = (sid) => sportProducts(sid).filter(hasPrice).length;
  function zoomImage(src, title, sub, downloadName) {
    const ov = document.createElement('div');
    ov.className = 'overlay center lightbox';
    ov.innerHTML = `<figure><img src="${esc(src)}" alt=""><figcaption><b>${esc(title || '')}</b>${sub ? `<span>${esc(sub)}</span>` : ''}${downloadName ? `<a class="btn sm" href="${esc(src)}" download="${esc(downloadName)}" data-dl>${ic('down')}${esc(t('chat.download'))}</a>` : ''}</figcaption></figure>`;
    const dl = ov.querySelector('[data-dl]'); if (dl) dl.addEventListener('click', e => e.stopPropagation());
    const close = () => { ov.remove(); document.removeEventListener('keydown', k); };
    const k = (e) => { if (e.key === 'Escape') close(); };
    ov.addEventListener('click', close); document.addEventListener('keydown', k);
    document.body.appendChild(ov);
  }

  // ---------- UI: toast / overlay ----------
  function toast(msg, err) {
    let w = $('.toast-wrap');
    if (!w) { w = document.createElement('div'); w.className = 'toast-wrap'; document.body.appendChild(w); }
    const el = document.createElement('div');
    el.className = 'toast' + (err ? ' err' : '');
    el.setAttribute('role', 'status');
    el.textContent = msg;
    w.appendChild(el);
    setTimeout(() => el.remove(), err ? 5000 : 2800);
  }
  const fail = (e) => { console.error(e); toast((e && e.message) || String(e), true); };

  let overlayStack = [];
  function openOverlay({ kind = 'drawer', title = '', sub = '', body = '', foot = '', wide = false, onMount, onClose }) {
    const ov = document.createElement('div');
    ov.className = 'overlay' + (kind === 'modal' ? ' center' : '');
    ov.innerHTML = `<div class="${kind}${wide ? ' wide' : ''}" role="dialog" aria-modal="true">
      <div class="ov-h"><div><h2>${title}</h2>${sub ? `<div class="subtitle">${sub}</div>` : ''}</div><button class="x" data-close aria-label="${esc(t('common.close'))}">${ic('x')}</button></div>
      <div class="ov-b">${body}</div>${foot ? `<div class="ov-f">${foot}</div>` : ''}</div>`;
    const close = () => { ov.remove(); overlayStack = overlayStack.filter(x => x !== api); document.removeEventListener('keydown', onKey); onClose && onClose(); };
    const onKey = (e) => { if (e.key === 'Escape' && overlayStack[overlayStack.length - 1] === api) close(); };
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    ov.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    const api = { el: ov, close, body: ov.querySelector('.ov-b'), foot: ov.querySelector('.ov-f') };
    overlayStack.push(api);
    onMount && onMount(api);
    const first = ov.querySelector('input:not([type=hidden]),select,textarea');
    if (first && kind === 'modal') setTimeout(() => first.focus(), 30);
    return api;
  }
  function confirmDialog(message, { okLabel, danger } = {}) {
    return new Promise((resolve) => {
      let done = false;
      openOverlay({
        kind: 'modal', title: esc(t('common.confirm')), body: `<p style="margin:0">${esc(message)}</p>`,
        foot: `<button class="btn ghost" data-close>${esc(t('common.cancel'))}</button><button class="btn ${danger ? 'danger' : ''}" data-ok>${esc(okLabel || t('common.confirm'))}</button>`,
        onMount: (o) => o.el.querySelector('[data-ok]').addEventListener('click', () => { done = true; o.close(); resolve(true); }),
        onClose: () => { if (!done) resolve(false); }
      });
    });
  }
  function promptDialog(title, fields) {
    // fields: [{name,label,type,value,required,options}]
    return new Promise((resolve) => {
      let done = false;
      const body = `<form class="stack" data-f>${fields.map(f => `<label class="f"><span class="${f.required ? 'req' : ''}">${esc(f.label)}</span>${f.options
        ? `<select class="inp" name="${f.name}">${f.options.map(o => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
        : f.type === 'textarea' ? `<textarea class="inp" name="${f.name}" rows="3">${esc(f.value || '')}</textarea>`
          : `<input class="inp" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}" ${f.required ? 'required' : ''}>`}</label>`).join('')}<button type="submit" class="hidden"></button></form>`;
      openOverlay({
        kind: 'modal', title: esc(title), body,
        foot: `<button class="btn ghost" data-close>${esc(t('common.cancel'))}</button><button class="btn" data-ok>${esc(t('common.confirm'))}</button>`,
        onMount: (o) => {
          const form = o.el.querySelector('[data-f]');
          const submit = () => { if (!form.reportValidity()) return; const v = Object.fromEntries(new FormData(form)); done = true; o.close(); resolve(v); };
          form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
          o.el.querySelector('[data-ok]').addEventListener('click', submit);
        },
        onClose: () => { if (!done) resolve(null); }
      });
    });
  }

  // ---------- Dati ----------
  async function loadAll() {
    if (store.checkSchema) await store.checkSchema();
    const [sports, products, settings, users, clients, orders, requests, unread, mentions] = await Promise.all([
      store.listSports(), store.listProducts(), store.getSettings(), store.listUsers(), store.listClients(), store.listOrders(), store.listRequests(),
      store.unreadCounts().catch(() => ({})), store.listMentions().catch(() => [])
    ]);
    for (const o of orders) o.status = normStatus(o.status);
    for (const r of requests) r.status = normReq(r.status);
    Object.assign(S, { sports, products, settings, users, clients, orders, requests, unread: unread || {}, mentions: mentions || [], loaded: true });
    // prezzi del listino TEAM: applicati da soli al primo accesso di un amministratore (vedi views/admin.js)
    if (BL.autoListino) setTimeout(() => BL.autoListino(), 0);
    if (BL.checkQuoteNumbering) setTimeout(() => BL.checkQuoteNumbering(), 0);
  }
  let reloadTimer = null;
  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      if (!S.me || document.querySelector('.overlay') || BL.editing || BL.composing) return; // non disturbare mentre si compila
      try {
        const before = new Set(S.requests.map(r => String(r.id)));
        await loadAll(); render();
        const fresh = S.requests.filter(r => !before.has(String(r.id)) && r.source !== 'manual');
        if (before.size && fresh.length) toast(t('board.newRequest', { n: fresh.map(r => r.team).join(', ') }));
      } catch (e) { console.warn(e); }
    }, 250);
  }

  // ---------- Router ----------
  const routes = [];
  function route(pattern, handler, opts = {}) { routes.push({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/?]+)') + '$'), handler, opts }); }
  function parseHash() {
    const h = (location.hash || '#/dashboard').slice(1);
    const [path, qs] = h.split('?');
    return { path: path || '/dashboard', query: Object.fromEntries(new URLSearchParams(qs || '')) };
  }
  const go = (h) => { if (location.hash === h) render(); else location.hash = h; };

  const NAV = () => [
    { sec: t('nav.workspace') },
    { href: '#/dashboard', icon: 'home', label: t('nav.dashboard'), match: '/dashboard' },
    { href: '#/requests', icon: 'columns', label: t('nav.requests'), match: '/requests', badge: S.requests.filter(r => r.status === 'da_rispondere').length },
    { href: '#/clients', icon: 'users', label: isAgent() ? t('nav.myClients') : t('nav.clients'), match: '/clients', badge: BL.recontactDue ? BL.recontactDue().length : 0, badgeCls: 'soft' },
    { href: '#/mentions', icon: 'at', label: t('nav.mentions'), match: '/mentions', badge: mentionsUnread() },
    { href: '#/catalog', icon: 'tag', label: t('nav.catalog'), match: '/catalog' },
    ...(isAdmin() ? [
      { sec: t('nav.admin') },
      { href: '#/admin/products', icon: 'box', label: t('nav.adminProducts'), match: '/admin/products' },
      { href: '#/admin/pricing', icon: 'sliders', label: t('nav.adminPricing'), match: '/admin/pricing' },
      { href: '#/admin/users', icon: 'shield', label: t('nav.adminUsers'), match: '/admin/users' },
      { href: '#/admin/settings', icon: 'cog', label: t('nav.adminSettings'), match: '/admin/settings' }
    ] : [])
  ];

  function brandMark() {
    return S.settings.logo ? `<div class="brand-mark"><img src="${esc(S.settings.logo)}" alt=""></div>` : `<img class="brand-logo" src="img/brand/bl-logo.png" alt="BL">`;
  }

  function shellHTML(path, page) {
    const nav = NAV().map(n => n.sec ? `<div class="navsec">${esc(n.sec)}</div>` :
      `<a class="navlink ${path.startsWith(n.match) ? 'active' : ''}" href="${n.href}">${ic(n.icon)}<span>${esc(n.label)}</span>${n.badge ? `<span class="badge ${n.badgeCls || ''}">${n.badge}</span>` : ''}${n.dot ? `<span class="badge msg" title="${esc(t('chat.unread'))}">${ic('chat')}${n.dot}</span>` : ''}</a>`).join('');
    return `<div class="shell" id="shell">
      <aside class="side">
        <div class="brand">${brandMark()}<div><b>BICYCLE LINE</b><small>STUDIO</small></div></div>
        <nav>${nav}</nav>
        <div class="side-foot">
          <button class="me" data-act="me-menu" title="${esc(S.me.email || '')}">
            <span class="avatar">${esc(initials(S.me.full_name || S.me.email))}</span>
            <span class="grow"><b>${esc(S.me.full_name || S.me.email)}</b><small>${esc(t('role.' + S.me.role))} · ${esc(lang.toUpperCase())}</small></span>${ic('chevd')}
          </button>
        </div>
      </aside>
      <div class="content">
        <div class="mobilebar"><div class="brand">${brandMark()}<div><b>BICYCLE LINE</b></div></div><button class="btn icon dark" data-act="nav-toggle" aria-label="Menu">${ic('menu')}</button></div>
        <main class="main">
          ${store.mode === 'demo' ? `<div class="demo-ribbon">${ic('eye')}<span>${t('demo.ribbon')}</span></div>` : ''}
          <header class="topbar">
            <div>${page.crumb ? `<div class="crumb">${page.crumb}</div>` : ''}<h1 class="title">${page.title}</h1>${page.subtitle ? `<div class="subtitle">${page.subtitle}</div>` : ''}</div>
            <div class="top-actions">${page.actions || ''}</div>
          </header>
          <div id="view">${page.body}</div>
        </main>
      </div>
    </div>`;
  }

  function meMenu() {
    openOverlay({
      kind: 'modal', title: esc(S.me.full_name || S.me.email), sub: `${esc(S.me.email)} · ${rolePill(S.me.role)}`,
      body: `<div class="stack">
        <div><div class="hint" style="margin-bottom:6px">${esc(t('profile.language'))}</div><div class="langsel">${LANGS.map(l => `<button data-lang="${l.id}" class="${l.id === lang ? 'on' : ''}">${esc(l.label)}</button>`).join('')}</div></div>
        <label class="f"><span>${esc(t('profile.name'))}</span><input class="inp" id="pf-name" value="${esc(S.me.full_name || '')}"></label>
      </div>`,
      foot: `${store.mode === 'supabase' ? `<button class="btn ghost" data-act="pw">${ic('key')}${esc(t('profile.changePassword'))}</button>` : ''}
        <button class="btn ghost" data-act="logout">${ic('logout')}${esc(store.mode === 'demo' ? t('demo.switchUser') : t('profile.logout'))}</button>
        <button class="btn" data-act="save">${esc(t('common.save'))}</button>`,
      onMount: (o) => {
        o.el.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', async () => {
          setLang(b.dataset.lang, true); o.close();
        }));
        o.el.querySelector('[data-act=logout]').addEventListener('click', async () => { o.close(); await store.signOut(); S.me = null; render(); });
        const pw = o.el.querySelector('[data-act=pw]');
        pw && pw.addEventListener('click', async () => {
          const v = await promptDialog(t('profile.changePassword'), [{ name: 'pw', label: t('profile.newPassword'), type: 'password', required: true }]);
          if (!v) return;
          if (v.pw.length < 8) return toast(t('profile.pwShort'), true);
          try { await store.changePassword(v.pw); toast(t('profile.pwOk')); } catch (e) { fail(e); }
        });
        o.el.querySelector('[data-act=save]').addEventListener('click', async () => {
          try { S.me = await store.updateMyProfile({ full_name: o.el.querySelector('#pf-name').value.trim() }); o.close(); await loadAll(); render(); } catch (e) { fail(e); }
        });
      }
    });
  }

  function setLang(l, persistProfile) {
    lang = l; safeLS.set('bl_lang', l);
    document.documentElement.lang = l;
    if (persistProfile && S.me) store.updateMyProfile({ language: l }).then(u => { S.me = u; }).catch(() => {});
    render();
  }

  let currentPage = null;
  async function render() {
    document.documentElement.lang = lang;
    const app = document.getElementById('app');
    if (!S.me) { BL.editing = null; app.innerHTML = BL.views.login(); BL.views.loginMount(app); return; }
    if (!S.loaded) { app.innerHTML = `<div class="empty" style="padding-top:30vh">${esc(t('common.loading'))}</div>`; try { await loadAll(); } catch (e) {
      console.error(e);
      app.innerHTML = `<div class="empty" style="padding:22vh 20px 0;max-width:640px;margin:0 auto"><b>${esc(t('setup.title'))}</b><div style="margin:8px 0 18px">${esc(e.message || e)}</div><button class="btn ghost" id="setup-out">${ic('logout')}${esc(t('profile.logout'))}</button></div>`;
      const b = document.getElementById('setup-out'); b && b.addEventListener('click', async () => { await store.signOut(); S.me = null; render(); });
      return;
    } }
    const { path, query } = parseHash();
    let match = null;
    for (const r of routes) { const m = path.match(r.re); if (m) { match = { r, params: m.groups || {} }; break; } }
    if (!match || (match.r.opts.admin && !isAdmin())) { location.replace('#/dashboard'); return; }
    if (BL.editing && !path.startsWith('/order/')) BL.editing = null;
    let page;
    try { page = await match.r.handler({ params: match.params, query, path }); } catch (e) { fail(e); page = { title: t('common.error'), body: `<div class="card empty">${esc(e.message)}</div>` }; }
    if (!page) return;
    currentPage = page;
    app.innerHTML = shellHTML(path, page);
    document.title = `${page.titleText || stripTags(page.title)} · Bicycle Line Studio`;
    $('[data-act=me-menu]', app).addEventListener('click', meMenu);
    const nt = $('[data-act=nav-toggle]', app);
    nt && nt.addEventListener('click', () => $('#shell').classList.toggle('nav-open'));
    $$('.navlink', app).forEach(a => a.addEventListener('click', () => $('#shell').classList.remove('nav-open')));
    if (page.mount) { try { page.mount($('#view'), $('.top-actions')); } catch (e) { fail(e); } }
  }
  const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '');

  async function start() {
    try { await store.init(CFG); } catch (e) { document.getElementById('app').innerHTML = `<div class="empty" style="padding-top:25vh"><b>${esc(t('setup.title'))}</b>${esc(e.message || e)}</div>`; return; }
    S.me = store.me();
    if (S.me && S.me.language && !safeLS.get('bl_lang')) lang = S.me.language;
    store.onChange && store.onChange(scheduleReload);
    store.onAuth && store.onAuth((u) => { S.me = u; S.loaded = false; if (u && u.language && !safeLS.get('bl_lang')) lang = u.language; render(); });
    let lastHash = location.hash, skipNext = false;
    window.addEventListener('hashchange', () => {
      if (skipNext) { skipNext = false; return; }
      if (BL.editing && BL.editing.dirty && !confirm(t('editor.confirmLeave'))) { skipNext = true; location.hash = lastHash; return; }
      if (BL.editing && BL.editing.dirty) BL.editing.dirty = false;
      lastHash = location.hash; render(); window.scrollTo(0, 0);
    });
    window.addEventListener('beforeunload', (e) => { if (BL.editing && BL.editing.dirty) { e.preventDefault(); e.returnValue = ''; } });
    await render();
    if (store.consumePasswordSetup && store.consumePasswordSetup()) {
      // primo accesso da invito: l'utente sceglie la sua password (minimo 8 caratteri)
      for (let i = 0; i < 5; i++) {
        const v = await promptDialog(t('profile.changePassword'), [{ name: 'pw', label: t('profile.newPassword') + ' (min. 8)', type: 'password', required: true }, { name: 'pw2', label: t('profile.newPassword') + ' ✓', type: 'password', required: true }]);
        if (!v) break;
        if (v.pw.length < 8) { toast(t('profile.pwShort'), true); continue; }
        if (v.pw !== v.pw2) { toast('Le due password non coincidono', true); continue; }
        try { await store.changePassword(v.pw); toast(t('profile.pwOk')); break; } catch (e) { fail(e); }
      }
    }
  }

  // ---------- CSV ----------
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const delim = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim() !== ''));
  }
  function toCSV(rows) {
    return '﻿' + rows.map(r => r.map(v => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\r\n');
  }
  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const parseNum = (s) => { if (typeof s === 'number') return s; s = String(s || '').trim().replace(/[€\s]/g, ''); if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); return Number(s); };

  function readImage(file, maxSize = 480) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = reject;
      fr.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const k = Math.min(1, maxSize / Math.max(img.width, img.height));
          const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', .85));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  window.BL = {
    CFG, store, S, LANGS, ORDER_STATUSES, ORDER_FLOW, REQ_STATUSES, REQ_COLORS, CATEGORIES,
    t, tl, fmt, esc, $, $$, ic, initials, get lang() { return lang; }, setLang, locale,
    isAdmin, isStaff, isAgent, unreadTotal, mentionsUnread, normStatus, sport, sportName, sportChip, pname, userName, clientName, statusPill, rolePill, sportProducts, hasPrice, pricedCount, zoomImage,
    toast, fail, openOverlay, confirmDialog, promptDialog, loadAll, render, route, go, parseHash,
    parseCSV, toCSV, download, parseNum, readImage, views: {}, editing: null, start
  };
})();
