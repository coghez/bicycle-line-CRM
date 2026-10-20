/* Archivio SUPABASE: stessa interfaccia di store-local.js.
 * I permessi reali sono applicati dal database (RLS + trigger in supabase/01_schema.sql):
 * il browser non può vedere dati altrui né alterare i prezzi, che vengono ricalcolati dal server. */
(function (root) {
  'use strict';
  const SDK = 'vendor/supabase.min.js'; // supabase-js 2.45.4, incluso: niente CDN esterno
  let db = null, me = null, channel = null, passwordSetup = false, cfgUrl = '', cfgKey = '';
  const urlCache = new Map();
  const authListeners = new Set(), changeListeners = new Set();

  const ok = ({ data, error }) => { if (error) throw new Error(error.message || String(error)); return data; };
  const pick = (o, keys) => { const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; };
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Impossibile caricare Supabase (' + src + ')')); document.head.appendChild(s); });

  async function loadProfile(session) {
    if (!session) { me = null; return null; }
    const { data, error } = await db.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    if (error || !data) { me = null; throw new Error('Profilo non trovato: chiedi all\'amministratore di invitarti.'); }
    if (data.active === false) { await db.auth.signOut(); me = null; throw new Error('Utente disattivato.'); }
    me = data; return me;
  }

  function subscribe() {
    if (channel) db.removeChannel(channel);
    const fire = () => changeListeners.forEach(f => { try { f(); } catch (e) { console.error(e); } });
    channel = db.channel('bl-studio');
    for (const table of ['requests', 'orders', 'clients', 'products', 'sports', 'order_messages', 'request_comments']) channel.on('postgres_changes', { event: '*', schema: 'public', table }, fire);
    channel.subscribe();
  }

  const CLIENT_COLS = ['recontacted_at', 'name', 'contact_name', 'email', 'phone', 'vat_number', 'country', 'vat_regime', 'billing_address', 'delivery_address', 'language', 'notes', 'owner_id'];
  const PRODUCT_COLS = ['sport_id', 'sku', 'name', 'category', 'gender', 'kids', 'sizes', 'tiers', 'active', 'sort', 'image', 'notes'];
  const REQUEST_COLS = ['team', 'contact_name', 'sport', 'email', 'athletes', 'phone', 'message', 'notes', 'status', 'assigned_to', 'client_id', 'order_id', 'order_total', 'order_date'];

  const api = {
    mode: 'supabase',
    async init(cfg) {
      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error('Configura supabaseUrl e supabaseAnonKey in js/config.js');
      const h = location.hash || '';
      passwordSetup = /type=(invite|recovery)/.test(h);
      if (!root.supabase) await loadScript(SDK);
      cfgUrl = cfg.supabaseUrl; cfgKey = cfg.supabaseAnonKey;
      db = root.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
        // Blocco interno semplice al posto di navigator.locks: con il blocco del browser, dopo un cambio scheda
        // o un rinnovo della sessione, le chiamate al database potevano restare in attesa per sempre.
        lock: async (_name, _timeout, fn) => await fn() } });
      const { data: { session } } = await db.auth.getSession();
      if (/access_token=|type=/.test(h)) history.replaceState(null, '', location.pathname + '#/dashboard');
      try { await loadProfile(session); } catch (e) { console.warn(e); }
      if (me) subscribe();
      db.auth.onAuthStateChange((event, s) => {
        if (event === 'SIGNED_OUT') { me = null; authListeners.forEach(f => f(null)); return; }
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
          setTimeout(async () => {
            const was = me && me.id;
            try { await loadProfile(s); } catch (e) { authListeners.forEach(f => f(null)); alert(e.message); return; }
            if (was !== me.id) { subscribe(); authListeners.forEach(f => f({ ...me })); }
          }, 0);
        }
      });
    },
    onAuth(f) { authListeners.add(f); },
    onChange(f) { changeListeners.add(f); },
    me() { return me ? { ...me } : null; },
    consumePasswordSetup() { const v = !!me && (passwordSetup || !!me.must_set_password); passwordSetup = false; return v; },
    async signIn(email, password) { ok(await db.auth.signInWithPassword({ email, password })); },
    async signOut() { await db.auth.signOut(); me = null; },
    async resetPassword(email) { ok(await db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })); },
    async changePassword(pw) {
      ok(await db.auth.updateUser({ password: pw }));
      if (me && me.must_set_password) { try { ok(await db.rpc('bl_password_set')); me.must_set_password = false; } catch (e) { console.warn(e); } }
    },
    async updateMyProfile(patch) {
      const row = ok(await db.from('profiles').update(pick(patch, ['full_name', 'language'])).eq('id', me.id).select().single());
      me = row; return { ...row };
    },

    // utenti
    async listUsers() { return ok(await db.from('profiles').select('*').order('full_name')); },
    async saveUser(u) { return ok(await db.from('profiles').update(pick(u, ['full_name', 'role', 'language', 'country', 'active'])).eq('id', u.id).select().single()); },
    // Invito: l'admin prepara l'invito nel database (ruolo, lingua) e Supabase manda all'invitato un link di accesso.
    // Al primo accesso il CRM gli chiede di scegliere la password. Nessuna Edge Function necessaria.
    async inviteUser(u) {
      const email = String(u.email || '').trim().toLowerCase();
      const r = await db.rpc('bl_invite_prepare', { p_email: email, p_full_name: u.full_name || '', p_role: u.role || 'agent', p_language: u.language || 'it', p_country: u.country || '' });
      if (r.error) {
        if (/could not find|does not exist|schema cache/i.test(r.error.message || '')) { root.BL && root.BL.checkQuoteNumbering && root.BL.checkQuoteNumbering(true); throw new Error('Per invitare utenti serve l\'aggiornamento del database: segui il riquadro «Aggiornamento database» in basso a sinistra (una volta sola).'); }
        throw new Error(r.error.message);
      }
      // client separato: l'invio del link non tocca la sessione dell'amministratore
      const tmp = root.supabase.createClient(cfgUrl, cfgKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'bl-invite-tmp' } });
      const { error } = await tmp.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
      if (error) {
        const m = error.message || '';
        if (/rate|too many|seconds/i.test(m)) throw new Error('Supabase ha già inviato troppe email in poco tempo: l\'invito è pronto, riprova a premere «Invia invito» tra qualche minuto.');
        if (/signup|not allowed/i.test(m)) throw new Error('In Supabase le nuove registrazioni via email sono disattivate (Authentication → Sign In / Providers → Email → «Allow new users to sign up»).');
        throw new Error(m);
      }
      return { ok: true };
    },

    // catalogo
    async listSports() { return ok(await db.from('sports').select('*').order('sort')); },
    async saveSport(s) { return ok(await db.from('sports').update(pick(s, ['name', 'code', 'color', 'season', 'sort', 'active', 'rules'])).eq('id', s.id).select().single()); },
    async listProducts() { return ok(await db.from('products').select('*').order('sort').order('sku')); },
    async saveProduct(p) {
      const row = pick(p, PRODUCT_COLS);
      if (p.id) return ok(await db.from('products').update(row).eq('id', p.id).select().single());
      if (row.sort === undefined) {
        const last = ok(await db.from('products').select('sort').eq('sport_id', p.sport_id).order('sort', { ascending: false }).limit(1));
        row.sort = last.length ? last[0].sort + 1 : 1;
      }
      return ok(await db.from('products').insert(row).select().single());
    },
    async deleteProduct(id) {
      const used = ok(await db.from('orders').select('id').contains('lines', [{ product_id: id }]).limit(1));
      if (used.length) { ok(await db.from('products').update({ active: false }).eq('id', id)); return { archived: true }; }
      ok(await db.from('products').delete().eq('id', id)); return { deleted: true };
    },
    async reorderProducts(ids) { await Promise.all(ids.map((id, i) => db.from('products').update({ sort: i + 1 }).eq('id', id).then(ok))); },
    async getSettings() { const r = ok(await db.from('app_settings').select('data').eq('id', 1).maybeSingle()); return (r && r.data) || {}; },
    async saveSettings(s) { return ok(await db.from('app_settings').upsert({ id: 1, data: s }).select().single()).data; },

    // clienti
    async listClients() { return ok(await db.from('clients').select('*').order('name')); },
    async saveClient(c) {
      const row = pick(c, CLIENT_COLS);
      if (me.role === 'agent') delete row.owner_id; else if (!row.owner_id && !c.id) row.owner_id = me.id;
      if (c.id) return ok(await db.from('clients').update(row).eq('id', c.id).select().single());
      if (me.role === 'agent') row.owner_id = me.id;
      return ok(await db.from('clients').insert(row).select().single());
    },
    async deleteClient(id) {
      const { error } = await db.from('clients').delete().eq('id', id);
      if (error) throw new Error(/foreign key|violates/i.test(error.message) ? 'Il cliente ha ordini collegati e non può essere eliminato' : error.message);
    },

    // ordini
    async listOrders() { return ok(await db.from('orders').select('*').order('updated_at', { ascending: false }).limit(5000)); },
    async getOrder(id) { const o = ok(await db.from('orders').select('*').eq('id', id).maybeSingle()); if (!o) throw new Error('Ordine non trovato'); return o; },
    async saveOrder(o) {
      const row = pick(o, ['client_id', 'sport_id', 'order_type', 'language', 'lines', 'options', 'notes', 'status', 'request_id']);
      if (me.role !== 'agent' && o.agent_id) row.agent_id = o.agent_id;
      if (!o.id && !row.agent_id) row.agent_id = me.role === 'agent' ? me.id : null; // il trigger usa l'agente del cliente
      if (row.agent_id === null) delete row.agent_id;
      if (o.id) return ok(await db.from('orders').update(row).eq('id', o.id).select().single());
      if (!row.agent_id) {
        const c = ok(await db.from('clients').select('owner_id').eq('id', row.client_id).single());
        row.agent_id = c.owner_id;
      }
      return ok(await db.from('orders').insert(row).select().single());
    },
    async setOrderStatus(id, status, note) {
      return ok(await db.rpc('bl_set_order_status', { p_order: id, p_status: status, p_note: note || '' }));
    },
    async acceptOrder(id, { amount, date, note }) { return ok(await db.rpc('bl_accept_order', { p_order: id, p_amount: Number(amount) || 0, p_date: date || null, p_note: note || '' })); },

    // commenti dell'ordine (file nel bucket privato "order-files", cartella = id ordine)
    async listMessages(orderId) { return ok(await db.from('order_messages').select('*').eq('order_id', orderId).order('created_at')); },
    async sendMessage(orderId, { text, files, mentions }) {
      const attachments = [];
      for (const f of files || []) {
        const safe = String(f.name || 'file').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\-]+/g, '_').slice(-80);
        const path = `${orderId}/${crypto.randomUUID()}-${safe}`;
        ok(await db.storage.from('order-files').upload(path, f.blob, { contentType: f.type, upsert: false }));
        attachments.push({ path, name: f.name, type: f.type, size: f.size, w: f.w || 0, h: f.h || 0 });
      }
      return ok(await db.from('order_messages').insert({ order_id: orderId, text: (text || '').trim(), attachments, mentions: mentions || [] }).select().single());
    },
    async fileUrl(att) {
      if (att.url) return att.url;
      const c = urlCache.get(att.path); if (c && c.exp > Date.now()) return c.url;
      const d = ok(await db.storage.from('order-files').createSignedUrl(att.path, 3600));
      urlCache.set(att.path, { url: d.signedUrl, exp: Date.now() + 3300 * 1000 }); return d.signedUrl;
    },
    async markRead(orderId) { ok(await db.from('order_reads').upsert({ user_id: me.id, order_id: orderId, read_at: new Date().toISOString() })); },
    async unreadCounts() { const rows = ok(await db.rpc('bl_unread_counts')); const o = {}; for (const r of rows || []) o[r.order_id] = Number(r.n); return o; },
    async addOrderNote(id, note) { ok(await db.from('order_events').insert({ order_id: id, actor: me.id, type: 'note', detail: { note } })); },
    async deleteOrder(id) { ok(await db.from('orders').delete().eq('id', id)); },
    async listOrderEvents(id) { return ok(await db.from('order_events').select('*').eq('order_id', id).order('created_at', { ascending: false })); },

    // richieste
    async checkSchema() {
      const { error } = await db.from('requests').select('order_total, order_date, client_id').limit(1);
      if (error) throw new Error('Il database Supabase non è ancora aggiornato: apri Supabase → SQL Editor, incolla tutto il file supabase/ESEGUI_IN_SUPABASE.sql e premi Run (una volta sola). Dettaglio: ' + error.message);
      const c = await db.from('clients').select('id, recontacted_at').limit(1);
      if (c.error) throw new Error('Il database Supabase non è ancora aggiornato: esegui supabase/ESEGUI_IN_SUPABASE.sql. Dettaglio: ' + c.error.message);
    },
    async getRequestById(requestId) { return ok(await db.from('requests').select('id,order_total,order_date').eq('id',requestId).single()); },
    async manageCiclismoQuote(requestId, action='get', quote=null) { return ok(await db.rpc('bl_cycling_quote_manage',{p_request:requestId,p_action:action,p_quote:quote})); },
    async manageSizes(requestId, action='get') { return ok(await db.rpc('bl_sizes_manage',{p_request:requestId,p_action:action})); },
    // Scrive i prodotti del preventivo nel modulo TAGLIE (come bozza): funziona con lo script 03 già installato.
    async quoteNumber(requestId) { return ok(await db.rpc('bl_quote_number',{p_request:requestId})); },
    async hasQuoteNumbering() {
      const missing = (e) => !!(e && /could not find|does not exist|schema cache/i.test(e.message || ''));
      const a = await db.rpc('bl_quote_number', { p_request: null });
      const b = await db.rpc('bl_invite_prepare', { p_email: '', p_full_name: '', p_role: '', p_language: '', p_country: '' });
      return !missing(a.error) && !missing(b.error);
    },
    async syncSizeLines(token, lines) { return ok(await db.rpc('bl_sizes_public_save',{p_token:token,p_lines:lines,p_submit:false})); },
    async setRequestTotal(requestId, totalNet) {
      const cur = ok(await db.from('requests').select('order_date').eq('id', requestId).single());
      return ok(await db.from('requests').update({ order_total: totalNet, order_date: cur.order_date || new Date().toISOString().slice(0, 10) }).eq('id', requestId).select('id,order_total,order_date').single());
    },
    async listRequests() { return ok(await db.from('requests').select('*').order('created_at', { ascending: false }).limit(2000)); },
    async saveRequest(r) {
      const row = pick(r, REQUEST_COLS);
      if ('order_total' in row) row.order_total = row.order_total === '' || row.order_total == null || isNaN(Number(row.order_total)) ? null : Number(row.order_total);
      if (row.order_total != null && !row.order_date) row.order_date = new Date().toISOString().slice(0, 10);
      if (row.order_date === '') row.order_date = null;
      if (row.client_id === '') row.client_id = null;
      if (me.role === 'agent') row.assigned_to = me.id;
      if (r.id) return ok(await db.from('requests').update(row).eq('id', r.id).select().single());
      return ok(await db.from('requests').insert({ ...row, created_by: me.id, source: 'manual' }).select().single());
    },
    async deleteRequest(id) { ok(await db.from('requests').delete().eq('id', id)); },
    async listRequestComments(id) { return ok(await db.from('request_comments').select('*').eq('request_id', id).order('created_at')); },
    async addRequestComment(id, { text, mentions }) { return ok(await db.from('request_comments').insert({ request_id: id, text: (text || '').trim(), mentions: mentions || [] }).select().single()); },
    async listMentions() { return ok(await db.rpc('bl_my_mentions', { p_limit: 60 })) || []; },
    async mentionsSeen() { ok(await db.rpc('bl_mentions_seen')); },
    async listRequestEvents(id) { return ok(await db.from('request_events').select('*').eq('request_id', id).order('created_at', { ascending: false }).limit(80)); },

    async exportAll() {
      const t = async (n) => ok(await db.from(n).select('*'));
      return { exported_at: new Date().toISOString(), sports: await t('sports'), products: await t('products'), settings: await api.getSettings(), profiles: await t('profiles'), clients: await t('clients'), orders: await t('orders'), requests: await t('requests') };
    }
  };

  root.BLSupabaseStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
