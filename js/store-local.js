/* Archivio DEMO nel browser (localStorage). Emula i permessi di Supabase/RLS:
 * gli agenti vedono solo i propri clienti, ordini e richieste assegnate. */
(function (root) {
  'use strict';
  const KEY = 'blstudio_demo_v1';
  const SESSION = 'blstudio_demo_session';
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const uid = (p) => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => new Date().toISOString();

  let db = null;
  let me = null;
  const listeners = new Set();
  const VERSION = 8;
  const STATUSES = ['draft', 'submitted', 'approved', 'production', 'shipped', 'cancelled'];

  // ---- file allegati dei commenti: IndexedDB (localStorage è troppo piccolo per immagini e PDF) ----
  let idbP = null;
  const idb = () => idbP || (idbP = new Promise((res, rej) => {
    const r = indexedDB.open('blstudio-files', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const idbPut = async (key, blob) => { const d = await idb(); await new Promise((res, rej) => { const tx = d.transaction('files', 'readwrite'); tx.objectStore('files').put(blob, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); };
  const idbGet = async (key) => { const d = await idb(); return await new Promise((res, rej) => { const q = d.transaction('files').objectStore('files').get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); }); };

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn('Salvataggio locale non riuscito', e); }
    listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } });
  }

  function seed() {
    const S = root.BLSeed;
    // demo pulita: solo utenti, sport/listini e qualche richiesta di esempio. Nessun ordine o cliente finto.
    db = {
      version: VERSION,
      seq: {},
      users: clone(S.USERS), sports: clone(S.SPORTS), products: clone(S.PRODUCTS),
      settings: clone(S.SETTINGS), clients: [],
      requests: clone(S.REQUESTS), request_events: [], orders: [], order_events: [], messages: [], request_comments: [], reads: {}, mention_seen: {}
    };
  }

  function load() {
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
    if (!db || db.version !== VERSION) { seed(); persist(); }
    try { const id = localStorage.getItem(SESSION); me = db.users.find(u => u.id === id && u.active) || null; } catch { me = null; }
  }

  const isAgent = () => me && me.role === 'agent';
  const isAdmin = () => me && me.role === 'admin';
  const isStaff = () => me && (me.role === 'admin' || me.role === 'staff');
  const need = (cond, msg) => { if (!cond) throw new Error(msg || 'Operazione non consentita'); };

  function canSeeClient(c) { return isStaff() || (isAgent() && c.owner_id === me.id); }
  function canSeeOrder(o) { return isStaff() || (isAgent() && o.agent_id === me.id); }
  function canSeeRequest(r) { return isStaff() || (isAgent() && r.assigned_to === me.id); }
  // chi può essere menzionato: solo chi vede già l'ordine o la richiesta (come i trigger su Supabase)
  const userOk = (id) => db.users.find(u => u.id === id && u.active);
  const userSeesOrder = (id, o) => { const u = userOk(id); return !!u && (u.role === 'admin' || u.role === 'staff' || (u.role === 'agent' && o.agent_id === id)); };
  const userSeesRequest = (id, r) => { const u = userOk(id); return !!u && (u.role === 'admin' || u.role === 'staff' || (u.role === 'agent' && r.assigned_to === id)); };
  const cleanMentions = (ids, test) => [...new Set(ids || [])].filter(id => id !== me.id && test(id));
  const forMe = (o) => clone(o);

  function nextNumber(year) {
    const k = String(year);
    db.seq[k] = (db.seq[k] || 0) + 1;
    return `${db.settings.order_prefix || 'BL'}-${k}-${String(db.seq[k]).padStart(4, '0')}`;
  }

  function addOrderEvent(order_id, type, detail) {
    db.order_events.push({ id: uid('oe'), order_id, actor: me ? me.id : null, type, detail: detail || {}, created_at: now() });
  }

  function saveOrderSync(input, when) {
    need(me, 'Sessione scaduta');
    const existing = input.id ? db.orders.find(o => o.id === input.id) : null;
    if (existing) {
      need(canSeeOrder(existing));
      if (isAgent()) need(existing.status === 'draft', 'L\'ordine è già stato inviato e non è più modificabile.');
    }
    const client = db.clients.find(c => c.id === input.client_id);
    need(client, 'Seleziona un cliente');
    need(canSeeClient(client), 'Cliente non accessibile');
    const sport = db.sports.find(s => s.id === input.sport_id);
    need(sport, 'Sport non valido');
    let status = input.status || (existing ? existing.status : 'draft');
    if (isAgent()) need(['draft', 'submitted'].includes(status), 'Stato non consentito');
    const products = db.products.filter(p => p.sport_id === sport.id).sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.sku).localeCompare(String(b.sku)));
    const totals = root.BLPricing.computeOrder(input, products, sport.rules, client.vat_regime, client.country);
    const unpriced = totals.lines.filter(l => !(l.unit > 0)).map(l => l.sku);
    need(!unpriced.length, 'Prezzo non ancora definito per: ' + unpriced.join(', '));
    const ts = when || now();
    const o = existing || { id: input._seedId || uid('o'), number: nextNumber(new Date(ts).getFullYear()), created_at: ts, agent_id: isAgent() ? me.id : (input.agent_id || client.owner_id || me.id) };
    if (!isAgent() && input.agent_id) o.agent_id = input.agent_id;
    Object.assign(o, {
      client_id: client.id,
      client_snapshot: { name: client.name, contact_name: client.contact_name, email: client.email, phone: client.phone, vat_number: client.vat_number, country: client.country, vat_regime: client.vat_regime, billing_address: client.billing_address, delivery_address: client.delivery_address },
      sport_id: sport.id, order_type: input.order_type || 'new', language: input.language || client.language || 'it',
      lines: (input.lines || []).filter(l => Number(l.qty) > 0).map(l => ({ product_id: l.product_id, group: l.group, size: l.size, qty: Math.floor(Number(l.qty)) })),
      options: clone(input.options || {}), notes: input.notes || '', request_id: input.request_id || o.request_id || null,
      totals, updated_at: ts
    });
    const prevStatus = existing ? existing.status : null;
    o.status = status;
    if (status === 'submitted' && prevStatus !== 'submitted') { o.submitted_at = ts; o.return_note = ''; }
    if (!existing) { db.orders.unshift(o); addOrderEvent(o.id, 'created', {}); }
    else addOrderEvent(o.id, 'updated', {});
    if (prevStatus && prevStatus !== status) addOrderEvent(o.id, 'status', { from: prevStatus, to: status });
    if (!prevStatus && status !== 'draft') addOrderEvent(o.id, 'status', { from: 'draft', to: status });
    return o;
  }

  const api = {
    mode: 'demo',
    async init() {
      load();
      window.addEventListener('storage', (e) => {
        if (e.key !== KEY || !e.newValue) return;
        let incoming = null; try { incoming = JSON.parse(e.newValue); } catch { return; }
        if (!incoming || incoming.version !== db.version) return; // scheda con una versione vecchia del programma: ignora
        db = incoming; const id = me && me.id; me = db.users.find(u => u.id === id && u.active) || null;
        listeners.forEach(f => f());
      });
    },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    me() { return me ? clone(me) : null; },
    demoUsers() { return clone(db.users.filter(u => u.active)); },
    async signIn(userId) { me = db.users.find(u => u.id === userId && u.active) || null; need(me, 'Utente non trovato'); localStorage.setItem(SESSION, me.id); return clone(me); },
    async signOut() { me = null; localStorage.removeItem(SESSION); },
    async resetPassword() { return true; },
    async changePassword() { return true; },
    async updateMyProfile(patch) { need(me); const u = db.users.find(x => x.id === me.id); Object.assign(u, { full_name: patch.full_name ?? u.full_name, language: patch.language ?? u.language }); me = u; persist(); return clone(u); },
    async resetDemo() { localStorage.removeItem(KEY); load(); persist(); },

    // utenti
    async listUsers() { need(me); return clone(db.users).map(u => isAdmin() ? u : { id: u.id, full_name: u.full_name, email: u.email, role: u.role, language: u.language, country: u.country, active: u.active }); },
    async saveUser(u) {
      need(isAdmin(), 'Solo gli amministratori possono gestire gli utenti');
      const ex = db.users.find(x => x.id === u.id);
      if (ex) {
        need(!(ex.id === me.id && (u.role !== 'admin' || u.active === false)), 'Non puoi togliere a te stesso i permessi di amministratore');
        Object.assign(ex, { full_name: u.full_name, role: u.role, language: u.language, country: u.country, active: u.active !== false });
      }
      persist(); return clone(ex);
    },
    async inviteUser(u) {
      need(isAdmin(), 'Solo gli amministratori possono invitare utenti');
      need(/.+@.+\..+/.test(u.email || ''), 'Email non valida');
      need(!db.users.some(x => x.email.toLowerCase() === u.email.toLowerCase()), 'Esiste già un utente con questa email');
      const n = { id: uid('u'), email: u.email.trim(), full_name: (u.full_name || '').trim(), role: u.role || 'agent', language: u.language || 'it', country: u.country || '', active: true };
      db.users.push(n); persist(); return clone(n);
    },

    // sport, prodotti, impostazioni
    async listSports() { return clone(db.sports).sort((a, b) => a.sort - b.sort); },
    async saveSport(s) { need(isAdmin(), 'Solo amministratori'); const ex = db.sports.find(x => x.id === s.id); Object.assign(ex, clone(s)); persist(); return clone(ex); },
    async listProducts() { return clone(db.products).sort((a, b) => (a.sort || 0) - (b.sort || 0)); },
    async saveProduct(p) {
      need(isAdmin(), 'Solo amministratori');
      need(p.sku && p.sku.trim(), 'Codice articolo obbligatorio');
      need(p.name && (p.name.it || '').trim(), 'Nome italiano obbligatorio');
      need(!db.products.some(x => x.id !== p.id && x.sport_id === p.sport_id && x.sku.toLowerCase() === p.sku.trim().toLowerCase()), 'Codice articolo già presente in questo sport');
      let ex = p.id && db.products.find(x => x.id === p.id);
      if (!ex) { ex = { id: uid('p'), sort: Math.max(0, ...db.products.filter(x => x.sport_id === p.sport_id).map(x => x.sort || 0)) + 1 }; db.products.push(ex); }
      Object.assign(ex, clone(p), { id: ex.id, sku: p.sku.trim(), tiers: (p.tiers || []).filter(t => Number(t.price) > 0) });
      if (ex.sort === undefined) ex.sort = 999;
      persist(); return clone(ex);
    },
    async deleteProduct(id) {
      need(isAdmin(), 'Solo amministratori');
      const used = db.orders.some(o => o.lines.some(l => l.product_id === id));
      if (used) { const p = db.products.find(x => x.id === id); p.active = false; persist(); return { archived: true }; }
      db.products = db.products.filter(x => x.id !== id); persist(); return { deleted: true };
    },
    async reorderProducts(ids) { need(isAdmin()); ids.forEach((id, i) => { const p = db.products.find(x => x.id === id); if (p) p.sort = i + 1; }); persist(); },
    async getSettings() { return clone(db.settings); },
    async saveSettings(s) { need(isAdmin(), 'Solo amministratori'); db.settings = Object.assign(db.settings, clone(s)); persist(); return clone(db.settings); },

    // clienti
    async listClients() { need(me); return clone(db.clients.filter(canSeeClient)).sort((a, b) => a.name.localeCompare(b.name)); },
    async saveClient(c) {
      need(me); need((c.name || '').trim(), 'Nome cliente obbligatorio');
      let ex = c.id && db.clients.find(x => x.id === c.id);
      if (ex) need(canSeeClient(ex));
      if (!ex) { ex = { id: uid('c'), created_at: now(), owner_id: isAgent() ? me.id : (c.owner_id || me.id) }; db.clients.push(ex); }
      const owner = isAgent() ? me.id : (c.owner_id || ex.owner_id);
      Object.assign(ex, clone(c), { id: ex.id, owner_id: owner, created_at: ex.created_at, name: c.name.trim() });
      persist(); return clone(ex);
    },
    async deleteClient(id) {
      need(me); const c = db.clients.find(x => x.id === id); need(c && canSeeClient(c));
      need(!db.orders.some(o => o.client_id === id), 'Il cliente ha ordini collegati e non può essere eliminato');
      db.clients = db.clients.filter(x => x.id !== id); for (const r of db.requests) if (r.client_id === id) r.client_id = null; persist();
    },

    // ordini
    async listOrders() { need(me); return db.orders.filter(canSeeOrder).map(forMe); },
    async getOrder(id) { need(me); const o = db.orders.find(x => x.id === id); need(o && canSeeOrder(o), 'Ordine non trovato'); return forMe(o); },
    async saveOrder(o) { const r = saveOrderSync(o); persist(); return clone(r); },
    async setOrderStatus(id, status, note) {
      need(me); const o = db.orders.find(x => x.id === id); need(o && canSeeOrder(o));
      need(STATUSES.includes(status), 'Stato non valido');
      if (!isStaff()) need(isAgent() && o.status === 'draft' && status === 'submitted', 'Solo l\'ufficio può cambiare lo stato');
      const from = o.status; o.status = status; o.updated_at = now();
      if (status === 'submitted') { o.submitted_at = o.updated_at; o.return_note = ''; }
      if (status === 'draft' && from !== 'draft') o.return_note = note || '';
      addOrderEvent(id, 'status', { from, to: status, note: note || '' }); persist(); return forMe(o);
    },
    /** l'ufficio conferma l'ordine (di solito alla ricezione dell'acconto) */
    async acceptOrder(id, { amount, date, note }) {
      need(isStaff(), 'Solo l\'ufficio può confermare gli ordini');
      const o = db.orders.find(x => x.id === id); need(o, 'Ordine non trovato');
      need(['submitted', 'draft'].includes(o.status), 'Ordine già confermato');
      const from = o.status; const ts = now();
      Object.assign(o, { status: 'approved', approved_at: ts, approved_by: me.id, updated_at: ts, deposit: { amount: Number(amount) || 0, date: date || ts.slice(0, 10), note: note || '' } });
      addOrderEvent(id, 'status', { from, to: 'approved', note: note || '', deposit: Number(amount) || 0 }); persist(); return forMe(o);
    },
    async addOrderNote(id, note) { need(me); const o = db.orders.find(x => x.id === id); need(o && canSeeOrder(o)); addOrderEvent(id, 'note', { note }); persist(); },
    async deleteOrder(id) {
      need(me); const o = db.orders.find(x => x.id === id); need(o && canSeeOrder(o));
      if (isAgent()) need(o.status === 'draft', 'Puoi eliminare solo le bozze');
      db.orders = db.orders.filter(x => x.id !== id); db.order_events = db.order_events.filter(e => e.order_id !== id); db.messages = db.messages.filter(m => m.order_id !== id); persist();
    },
    async listOrderEvents(id) { need(me); const o = db.orders.find(x => x.id === id); need(o && canSeeOrder(o)); return clone(db.order_events.filter(e => e.order_id === id)).sort((a, b) => b.created_at.localeCompare(a.created_at)); },

    // commenti dell'ordine (con file e @menzioni)
    async listMessages(orderId) { need(me); const o = db.orders.find(x => x.id === orderId); need(o && canSeeOrder(o)); return clone(db.messages.filter(m => m.order_id === orderId)).sort((a, b) => a.created_at.localeCompare(b.created_at)); },
    async sendMessage(orderId, { text, files, mentions }) {
      need(me); const o = db.orders.find(x => x.id === orderId); need(o && canSeeOrder(o), 'Ordine non accessibile');
      need((text || '').trim() || (files || []).length, 'Scrivi un commento o allega un file');
      const attachments = [];
      for (const f of files || []) { const id = uid('f'); await idbPut(id, f.blob); attachments.push({ id, name: f.name, type: f.type, size: f.size, w: f.w || 0, h: f.h || 0 }); }
      const m = { id: uid('m'), order_id: orderId, author: me.id, text: (text || '').trim(), kind: 'message', mentions: cleanMentions(mentions, id => userSeesOrder(id, o)), attachments, created_at: now() };
      db.messages.push(m); (db.reads[me.id] = db.reads[me.id] || {})[orderId] = m.created_at; persist(); return clone(m);
    },
    async fileUrl(att) { if (att.url) return att.url; const b = await idbGet(att.id); return b ? URL.createObjectURL(b) : null; },
    async markRead(orderId) { need(me); (db.reads[me.id] = db.reads[me.id] || {})[orderId] = now(); try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* */ } },
    async unreadCounts() {
      need(me); const r = db.reads[me.id] || {}; const out = {};
      for (const m of db.messages) {
        if (m.author === me.id) continue;
        const o = db.orders.find(x => x.id === m.order_id); if (!o || !canSeeOrder(o)) continue;
        if (!r[m.order_id] || m.created_at > r[m.order_id]) out[m.order_id] = (out[m.order_id] || 0) + 1;
      }
      return out;
    },

    // commenti sulle richieste
    async listRequestComments(reqId) { need(me); const r = db.requests.find(x => x.id === reqId); need(r && canSeeRequest(r)); return clone(db.request_comments.filter(c => c.request_id === reqId)).sort((a, b) => a.created_at.localeCompare(b.created_at)); },
    async addRequestComment(reqId, { text, mentions }) {
      need(me); const r = db.requests.find(x => x.id === reqId); need(r && canSeeRequest(r), 'Richiesta non accessibile');
      need((text || '').trim(), 'Commento vuoto');
      const c = { id: uid('rc'), request_id: reqId, author: me.id, text: text.trim(), mentions: cleanMentions(mentions, id => userSeesRequest(id, r)), created_at: now() };
      db.request_comments.push(c); persist(); return clone(c);
    },

    // le mie menzioni
    async listMentions() {
      need(me); const seen = db.mention_seen[me.id] || '';
      const out = [];
      for (const m of db.messages) if ((m.mentions || []).includes(me.id)) { const o = db.orders.find(x => x.id === m.order_id); if (o && canSeeOrder(o)) out.push({ kind: 'order', id: m.id, target_id: o.id, label: o.number + ' · ' + (o.client_snapshot.name || ''), author: m.author, text: m.text, created_at: m.created_at, unread: m.created_at > seen }); }
      for (const c of db.request_comments) if ((c.mentions || []).includes(me.id)) { const r = db.requests.find(x => x.id === c.request_id); if (r && canSeeRequest(r)) out.push({ kind: 'request', id: c.id, target_id: r.id, label: r.team, author: c.author, text: c.text, created_at: c.created_at, unread: c.created_at > seen }); }
      return out.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 60);
    },
    async mentionsSeen() { need(me); db.mention_seen[me.id] = now(); try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* */ } },

    // richieste (CRM)
    async manageSizes(requestId, action='get') {
      const key='bl_demo_sizes_'+requestId; let data=JSON.parse(localStorage.getItem(key)||'null');
      if(action==='create'&&!data) data={token:crypto.randomUUID(),status:'bozza',lines:[]};
      if(action==='reopen'&&data)data.status='bozza';
      if(action==='revoke'&&data){data.token=crypto.randomUUID();data.status='bozza';}
      if(data)localStorage.setItem(key,JSON.stringify(data));return data;
    },
    async listRequests() { need(me); return clone(db.requests.filter(canSeeRequest)).sort((a, b) => b.created_at.localeCompare(a.created_at)); },
    async saveRequest(r) {
      need(me); need((r.team || '').trim(), 'Nome squadra obbligatorio');
      let ex = r.id && db.requests.find(x => x.id === r.id);
      if (ex) need(canSeeRequest(ex));
      const isNew = !ex;
      if (!ex) { ex = { id: uid('r'), created_at: now(), source: 'manual', created_by: me.id }; db.requests.unshift(ex); }
      const before = clone(ex);
      Object.assign(ex, clone(r), { id: ex.id, created_at: ex.created_at, source: ex.source });
      ex.order_total = r.order_total === '' || r.order_total == null || isNaN(Number(r.order_total)) ? null : Math.round(Number(r.order_total) * 100) / 100;
      need(ex.order_total === null || ex.order_total >= 0, 'Il totale non può essere negativo');
      ex.order_date = ex.order_total !== null ? (r.order_date || ex.order_date || now().slice(0, 10)) : (r.order_date || null);
      if (isAgent()) ex.assigned_to = me.id;
      const changed = {};
      for (const k of ['status', 'assigned_to', 'notes', 'order_total']) if (!isNew && before[k] !== ex[k]) changed[k] = true;
      if (!isNew && ['team', 'contact_name', 'email', 'phone', 'sport', 'athletes', 'message'].some(k => before[k] !== ex[k])) changed.contact = true;
      db.request_events.push({ id: uid('re'), request_id: ex.id, actor: me.id, event_type: isNew ? 'created' : 'updated', detail: changed, created_at: now() });
      persist(); return clone(ex);
    },
    async deleteRequest(id) { need(me && !isAgent(), 'Solo l\'ufficio può eliminare le richieste'); db.requests = db.requests.filter(r => r.id !== id); db.request_comments = db.request_comments.filter(c => c.request_id !== id); persist(); },
    async listRequestEvents(id) { need(me); return clone(db.request_events.filter(e => e.request_id === id)).sort((a, b) => b.created_at.localeCompare(a.created_at)); },

    async exportAll() { need(isAdmin()); return clone(db); }
  };

  root.BLLocalStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
