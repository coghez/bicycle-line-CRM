/* Commenti con @menzioni: sugli ordini (con file allegati) e sulle richieste */
(function () {
  'use strict';
  const { t, esc, ic, fmt, S, store } = BL;
  const MAX_FILE = 25 * 1024 * 1024;
  const fsize = (n) => n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const isImg = (type) => /^image\/(png|jpe?g|gif|webp|svg\+xml)$/i.test(type || '');
  const uname = (u) => (u && (u.full_name || u.email)) || '—';
  const time = (d) => new Date(d).toLocaleTimeString(BL.locale(), { hour: '2-digit', minute: '2-digit' });

  /** chi si può taggare: ufficio e amministratori, più l'agente dell'ordine o della richiesta */
  BL.mentionCandidates = (kind, target) => S.users.filter(u => u.active !== false && u.id !== S.me.id &&
    (u.role === 'admin' || u.role === 'staff' || (u.role === 'agent' && (kind === 'order' ? target.agent_id : target.assigned_to) === u.id)));

  /** testo del commento: link cliccabili e @menzioni evidenziate */
  BL.commentText = (text, mentions) => {
    let h = esc(text || '');
    const names = (mentions || []).map(id => S.users.find(u => u.id === id)).filter(Boolean).map(u => ({ me: u.id === S.me.id, n: esc('@' + uname(u)) })).sort((a, b) => b.n.length - a.n.length);
    for (const x of names) h = h.split(x.n).join(`<span class="mention${x.me ? ' self' : ''}">${x.n}</span>`);
    return h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
  };

  function listHTML(messages, events) {
    const items = [
      ...messages.map(m => ({ at: m.created_at, m })),
      ...(events || []).filter(e => e.type === 'status').map(e => ({ at: e.created_at, e }))
    ].sort((a, b) => a.at.localeCompare(b.at));
    let lastDay = '';
    return items.map(it => {
      const day = new Date(it.at).toDateString();
      const sep = day !== lastDay ? `<div class="chat-day"><span>${fmt.date(it.at)}</span></div>` : '';
      lastDay = day;
      if (it.e) {
        const e = it.e;
        return sep + `<div class="chat-sys">${BL.statusPill(e.detail.to)} <span>${esc(e.actor ? BL.userName(e.actor) : '')} · ${time(e.created_at)}</span>${e.detail.note ? `<div class="hint">“${esc(e.detail.note)}”</div>` : ''}</div>`;
      }
      const m = it.m, mine = m.author === S.me.id;
      const u = S.users.find(x => x.id === m.author) || {};
      const tagged = (m.mentions || []).includes(S.me.id);
      return sep + `<div class="msg ${mine ? 'mine' : ''} ${tagged ? 'tagged' : ''}" data-mid="${esc(m.id)}">
        <div class="msg-h"><span class="avatar xs">${esc(BL.initials(uname(u)))}</span><b>${esc(mine ? t('chat.you') : uname(u))}</b>${u.role ? BL.rolePill(u.role) : ''}<span class="hint">${time(m.created_at)}</span></div>
        <div class="bubble">
          ${m.text ? `<div class="msg-t">${BL.commentText(m.text, m.mentions)}</div>` : ''}
          ${m.attachments && m.attachments.length ? `<div class="atts" data-atts="${esc(m.id)}"></div>` : ''}
        </div></div>`;
    }).join('');
  }

  /** riquadro commenti. opts: { files: bool, compact: bool, empty: testo } */
  BL.commentsHTML = (messages, events, opts = {}) => `<div class="card chat ${opts.compact ? 'compact' : ''}">
      <div class="chat-list" id="chat-list">${listHTML(messages, events) || `<div class="chat-empty">${ic('chat')}<b>${esc(t('chat.emptyTitle'))}</b><span>${esc(opts.empty || t('chat.emptyHint'))}</span></div>`}</div>
      <div class="composer" id="composer">
        ${opts.files ? `<div class="dropnote">${ic('up')}${esc(t('chat.drop'))}</div>` : ''}
        <div class="mention-wrap"><textarea class="inp" id="chat-text" rows="2" placeholder="${esc(t('chat.placeholder'))}"></textarea><div class="mention-menu hidden" id="mention-menu" role="listbox"></div></div>
        ${opts.files ? '<div class="pending" id="chat-files"></div>' : ''}
        <div class="row between wrap" style="gap:8px">
          <div class="row wrap" style="gap:8px">
            <button type="button" class="btn ghost sm" data-act="tag">${ic('at')}${esc(t('chat.tag'))}</button>
            ${opts.files ? `<button type="button" class="btn ghost sm" data-act="attach">${ic('clip')}${esc(t('chat.attach'))}</button>` : ''}
          </div>
          <button type="button" class="btn" data-act="send">${ic('send')}${esc(t('chat.send'))}</button>
        </div>
        ${opts.files ? '<input type="file" id="chat-input" multiple class="hidden" accept="image/*,application/pdf,.pdf,.ai,.eps,.svg,.psd,.zip,.cdr">' : ''}
      </div></div>`;

  /** disegna gli allegati (immagini come anteprime, altri file come chip scaricabili) */
  BL.renderAttachments = async (el, atts, big) => {
    el.innerHTML = '';
    for (const a of atts || []) {
      let url = null;
      try { url = await store.fileUrl(a); } catch { url = null; }
      if (!url) { el.insertAdjacentHTML('beforeend', `<span class="filechip off">${ic('file')}${esc(a.name)}</span>`); continue; }
      if (isImg(a.type)) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'att-img' + (big ? ' big' : ''); b.title = a.name;
        b.innerHTML = `<img src="${esc(url)}" alt="${esc(a.name)}" loading="lazy">`;
        b.addEventListener('click', () => BL.zoomImage(url, a.name, a.size ? fsize(a.size) : '', a.name));
        el.appendChild(b);
      } else {
        el.insertAdjacentHTML('beforeend', `<a class="filechip" href="${esc(url)}" download="${esc(a.name)}" target="_blank" rel="noopener">${ic('file')}<span>${esc(a.name)}</span>${a.size ? `<small>${fsize(a.size)}</small>` : ''}${ic('down')}</a>`);
      }
    }
  };

  const dims = (file) => new Promise((res) => {
    if (!isImg(file.type) || /svg/.test(file.type)) return res([0, 0]);
    const u = URL.createObjectURL(file), i = new Image();
    i.onload = () => { res([i.naturalWidth, i.naturalHeight]); URL.revokeObjectURL(u); };
    i.onerror = () => { res([0, 0]); URL.revokeObjectURL(u); };
    i.src = u;
  });

  /** completamento @nome nel campo di testo */
  function mentionInput(text, menu, candidates) {
    const chosen = new Map(); // id -> nome
    let open = false, sel = 0, list = [], start = -1;
    const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const close = () => { open = false; menu.classList.add('hidden'); };
    const draw = () => {
      menu.innerHTML = list.map((u, i) => `<button type="button" role="option" class="${i === sel ? 'on' : ''}" data-i="${i}"><span class="avatar xs">${esc(BL.initials(uname(u)))}</span><b>${esc(uname(u))}</b>${BL.rolePill(u.role)}</button>`).join('')
        || `<div class="hint" style="padding:8px 10px">${esc(t('chat.noOneToTag'))}</div>`;
      menu.classList.remove('hidden'); open = true;
    };
    const check = () => {
      const before = text.value.slice(0, text.selectionStart);
      const m = before.match(/(^|\s)@([^\s@]{0,30})$/);
      if (!m) return close();
      start = before.length - m[2].length - 1;
      const q = norm(m[2]);
      list = candidates.filter(u => !q || norm(uname(u)).split(/\s+/).some(w => w.startsWith(q)) || norm(uname(u)).startsWith(q)).slice(0, 8);
      sel = 0; draw();
    };
    const pick = (u) => {
      const name = uname(u);
      const end = text.selectionStart;
      text.value = text.value.slice(0, start) + '@' + name + ' ' + text.value.slice(end);
      const pos = start + name.length + 2;
      text.setSelectionRange(pos, pos); text.focus();
      chosen.set(u.id, name); close();
      text.dispatchEvent(new Event('input'));
    };
    text.addEventListener('input', check);
    text.addEventListener('click', check);
    text.addEventListener('keydown', e => {
      if (!open) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, list.length); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + list.length) % Math.max(1, list.length); draw(); }
      else if ((e.key === 'Enter' || e.key === 'Tab') && list[sel]) { e.preventDefault(); e.stopImmediatePropagation(); pick(list[sel]); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    text.addEventListener('blur', () => setTimeout(close, 150));
    menu.addEventListener('mousedown', e => { const b = e.target.closest('[data-i]'); if (!b) return; e.preventDefault(); pick(list[Number(b.dataset.i)]); });
    return {
      startTag() {
        const p = text.selectionStart, v = text.value;
        const pre = p > 0 && !/\s/.test(v[p - 1]) ? ' @' : '@';
        text.value = v.slice(0, p) + pre + v.slice(p);
        text.focus(); text.setSelectionRange(p + pre.length, p + pre.length); check();
      },
      // menzioni ancora presenti nel testo (anche scritte a mano per intero)
      ids() {
        const v = text.value; const out = new Set();
        for (const [id, name] of chosen) if (v.includes('@' + name)) out.add(id);
        for (const u of candidates) if (v.includes('@' + uname(u))) out.add(u.id);
        return [...out];
      },
      reset() { chosen.clear(); close(); }
    };
  }

  /**
   * collega il riquadro commenti.
   * cfg: { kind: 'order'|'request', target, messages, files, onSend(text, mentions, files), reload }
   */
  BL.mountComments = (pane, cfg) => {
    const list = pane.querySelector('#chat-list');
    const text = pane.querySelector('#chat-text');
    const input = pane.querySelector('#chat-input');
    const filesEl = pane.querySelector('#chat-files');
    const comp = pane.querySelector('#composer');
    const mi = mentionInput(text, pane.querySelector('#mention-menu'), BL.mentionCandidates(cfg.kind, cfg.target));
    let pending = [];

    for (const m of cfg.messages) {
      const el = list.querySelector(`[data-atts="${CSS.escape(m.id)}"]`);
      if (el) BL.renderAttachments(el, m.attachments);
    }
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });

    const drawPending = () => {
      if (filesEl) filesEl.innerHTML = pending.map((f, i) => `<span class="filechip">${ic(isImg(f.type) ? 'image' : 'file')}<span>${esc(f.name)}</span><small>${fsize(f.size)}</small><button type="button" class="x" data-rm="${i}" aria-label="${esc(t('common.remove'))}">${ic('x')}</button></span>`).join('');
      BL.composing = !!(text.value.trim() || pending.length);
    };
    const addFiles = (fl) => {
      for (const f of fl) {
        if (f.size > MAX_FILE) { BL.toast(t('chat.tooBig', { n: f.name }), true); continue; }
        pending.push(f);
      }
      drawPending();
    };
    pane.querySelector('[data-act=tag]').addEventListener('click', () => mi.startTag());
    text.addEventListener('input', () => { BL.composing = !!(text.value.trim() || pending.length); });
    if (cfg.files) {
      filesEl.addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return; pending.splice(Number(b.dataset.rm), 1); drawPending(); });
      pane.querySelector('[data-act=attach]').addEventListener('click', () => input.click());
      input.addEventListener('change', () => { addFiles([...input.files]); input.value = ''; });
      ['dragenter', 'dragover'].forEach(ev => comp.addEventListener(ev, e => { e.preventDefault(); comp.classList.add('drag'); }));
      ['dragleave', 'drop'].forEach(ev => comp.addEventListener(ev, e => { e.preventDefault(); if (ev === 'dragleave' && comp.contains(e.relatedTarget)) return; comp.classList.remove('drag'); }));
      comp.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });
      text.addEventListener('paste', e => { const fs = [...(e.clipboardData ? e.clipboardData.files : [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });
    }

    const send = async () => {
      const btn = pane.querySelector('[data-act=send]');
      if (!text.value.trim() && !pending.length) return text.focus();
      btn.disabled = true;
      try {
        const files = [];
        for (const f of pending) { const [w, h] = await dims(f); files.push({ name: f.name, type: f.type || 'application/octet-stream', size: f.size, blob: f, w, h }); }
        const mentions = mi.ids();
        await cfg.onSend(text.value, mentions, files);
        if (mentions.length) BL.toast(t('chat.taggedToast', { n: mentions.map(id => BL.userName(id)).join(', ') }));
        pending = []; text.value = ''; mi.reset(); BL.composing = false;
        await cfg.reload();
      } catch (e) { BL.fail(e); btn.disabled = false; }
    };
    pane.querySelector('[data-act=send]').addEventListener('click', send);
    text.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
  };

  /** commenti dell'ordine (scheda nel dettaglio ordine) */
  BL.mountOrderComments = (pane, o, messages, events, reload) => {
    pane.innerHTML = BL.commentsHTML(messages, events, { files: true, empty: t(BL.isAgent() ? 'chat.emptyAgent' : 'chat.emptyStaff') });
    BL.mountComments(pane, {
      kind: 'order', target: o, messages, files: true, reload,
      onSend: (text, mentions, files) => store.sendMessage(o.id, { text, mentions, files })
    });
    if (S.unread[o.id]) {
      store.markRead(o.id).catch(() => {});
      S.unread[o.id] = 0;
      const tb = document.querySelector('#od-tabs [data-tab=chat] .badge'); if (tb) tb.remove();
      const nb = document.querySelector('.navlink[href="#/orders"] .badge.msg');
      if (nb) { const n = BL.unreadTotal(); if (n) nb.lastChild.textContent = n; else nb.remove(); }
    }
  };

  /** commenti della richiesta (nel pannello della richiesta) */
  BL.mountRequestComments = async (box, r) => {
    const draw = async () => {
      let messages = [];
      try { messages = await store.listRequestComments(r.id); } catch (e) { box.innerHTML = `<div class="hint">${esc(t('common.unavailable'))}</div>`; return; }
      box.innerHTML = BL.commentsHTML(messages, [], { compact: true, empty: t('chat.emptyRequest') });
      BL.mountComments(box, {
        kind: 'request', target: r, messages, reload: draw,
        onSend: (text, mentions) => store.addRequestComment(r.id, { text, mentions })
      });
    };
    await draw();
  };

  // ================= MENZIONI =================
  BL.mentionHref = (m) => {
    if (m.kind === 'request') return `#/requests?open=${encodeURIComponent(m.target_id)}`;
    const q = S.orders.find(o => o.id === m.target_id);
    return q && q.request_id ? `#/requests?open=${encodeURIComponent(q.request_id)}` : '#/requests';
  };
  BL.route('/mentions', () => {
    const list = S.mentions || [];
    const item = (m) => {
      const href = BL.mentionHref(m);
      return `<a class="list-item click mention-item ${m.unread ? 'unread' : ''}" href="${esc(href)}">
        <span class="avatar">${esc(BL.initials(BL.userName(m.author)))}</span>
        <div class="grow"><div class="row wrap" style="gap:6px"><b>${esc(BL.userName(m.author))}</b><span class="hint">${esc(t('mentions.taggedYou'))}</span><span class="pill plain">${ic(m.kind === 'order' ? 'file' : 'inbox')}${esc(m.label)}</span>${m.unread ? `<span class="pill new">${esc(t('mentions.new'))}</span>` : ''}</div>
          <div class="mention-text">${BL.commentText(m.text, [S.me.id])}</div></div>
        <span class="hint nowrap">${fmt.dt(m.created_at)}</span></a>`;
    };
    return {
      title: esc(t('nav.mentions')),
      subtitle: esc(t('mentions.sub')),
      body: `<div class="card"><div class="card-b">${list.map(item).join('') || `<div class="empty"><b>${esc(t('mentions.empty'))}</b>${esc(t('mentions.emptySub'))}</div>`}</div></div>`,
      mount: () => {
        if (BL.mentionsUnread()) {
          store.mentionsSeen().catch(() => {});
          // il badge sparisce subito; l'evidenza resta finché non si esce dalla pagina
          const nb = document.querySelector('.navlink[href="#/mentions"] .badge'); if (nb) nb.remove();
          setTimeout(() => { for (const m of S.mentions) m.unread = false; }, 0);
        }
      }
    };
  });
})();
