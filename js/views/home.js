/* Login + Panoramica */
(function () {
  'use strict';
  const { t, esc, ic, fmt, S, store } = BL;

  // ---------- Login ----------
  BL.views.login = () => {
    const langs = `<div class="langsel">${BL.LANGS.map(l => `<button data-lang="${l.id}" class="${l.id === BL.lang ? 'on' : ''}">${l.id.toUpperCase()}</button>`).join('')}</div>`;
    const demo = store.mode === 'demo';
    const users = demo ? store.demoUsers() : [];
    return `<div class="auth">
      <div class="auth-art">
        <div class="brand"><img class="brand-logo" src="img/brand/bl-logo.png" alt="BL"><div><b>BICYCLE LINE</b><small>STUDIO</small></div></div>
        <div><img class="bigslogan" src="img/brand/bl-slogan.png" alt="Belong to your ride"><h1>${esc(t('login.hero'))}</h1><p>${esc(t('login.heroSub'))}</p></div>
        <div class="hint" style="color:#6c6f78;position:relative;z-index:1">Treviso · Italy</div>
      </div>
      <div class="auth-form"><div class="auth-card">
        <div class="row between" style="margin-bottom:28px"><span class="hint">${esc(t('login.language'))}</span>${langs}</div>
        <h2>${esc(t('login.title'))}</h2>
        <div class="subtitle">${esc(demo ? t('login.demoSub') : t('login.sub'))}</div>
        ${demo ? `<div class="demo-users">${users.map(u => `<button class="demo-user" data-user="${esc(u.id)}"><span class="avatar" style="background:#e9e9e6;color:#17191e">${esc(BL.initials(u.full_name))}</span><span class="grow"><b>${esc(u.full_name)}</b><br><span class="hint">${esc(u.email)} · ${esc((u.language || '').toUpperCase())}</span></span>${BL.rolePill(u.role)}</button>`).join('')}</div>
          <p class="hint mt">${esc(t('login.demoNote'))}</p>`
        : `<form class="stack mt" id="loginForm">
            <label class="f"><span>${esc(t('login.email'))}</span><input class="inp" id="lgEmail" type="email" autocomplete="email" required></label>
            <label class="f"><span>${esc(t('login.password'))}</span><input class="inp" id="lgPw" type="password" autocomplete="current-password" required></label>
            <button class="btn block">${esc(t('login.submit'))}</button>
            <button type="button" class="linkbtn" id="lgReset">${esc(t('login.forgot'))}</button>
            <div id="lgMsg" role="status"></div>
          </form>`}
      </div></div>
    </div>`;
  };
  BL.views.loginMount = (root) => {
    root.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => BL.setLang(b.dataset.lang)));
    root.querySelectorAll('[data-user]').forEach(b => b.addEventListener('click', async () => {
      try { S.me = await store.signIn(b.dataset.user); S.loaded = false; if (S.me.language) BL.setLang(S.me.language); location.hash = '#/dashboard'; BL.render(); } catch (e) { BL.fail(e); }
    }));
    const form = root.querySelector('#loginForm');
    if (!form) return;
    const msg = (txt, kind) => { root.querySelector('#lgMsg').innerHTML = txt ? `<div class="alert ${kind || 'err'}">${esc(txt)}</div>` : ''; };
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); msg('');
      const btn = form.querySelector('button.btn'); btn.disabled = true;
      try { await store.signIn(root.querySelector('#lgEmail').value.trim(), root.querySelector('#lgPw').value); }
      catch (err) { msg(err.message || t('login.error')); }
      finally { btn.disabled = false; }
    });
    root.querySelector('#lgReset').addEventListener('click', async () => {
      const email = root.querySelector('#lgEmail').value.trim();
      if (!email) return msg(t('login.needEmail'));
      try { await store.resetPassword(email); msg(t('login.resetSent'), 'ok'); } catch (err) { msg(err.message); }
    });
  };

  // ---------- Panoramica: guadagni dalle squadre (totale ordine delle richieste) ----------
  const PALETTE = ['#b3243a', '#2c62a8', '#1f7a4d', '#d08a1e', '#6046b0', '#0f8a8a', '#7a5c3e', '#a43b8e', '#5b6170'];
  const PERIODS = ['month', '90', 'year', '365', 'all'];
  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const pct = (a, b) => b ? Math.round(a / b * 100) : null;
  const dash = { period: 'year', agent: '', sport: '' };

  function range(p) {
    const now = new Date(), to = now.toISOString().slice(0, 10);
    if (p === 'all') return { from: '', to, prev: null };
    let from;
    if (p === 'month') from = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (p === 'year') from = new Date(now.getFullYear(), 0, 1);
    else { from = new Date(now); from.setDate(from.getDate() - Number(p)); }
    const len = now - from, f = from.toISOString().slice(0, 10);
    return { from: f, to, prev: { from: new Date(from - len).toISOString().slice(0, 10), to: f } };
  }
  const inR = (d, r, open) => !!d && (!r.from || d >= r.from) && (open ? d < r.to : d <= r.to);

  function compute(f) {
    const r = range(f.period);
    const tot = BL.reqTotal, od = BL.reqOrderDate;
    const reqs = S.requests.filter(q => (!f.agent || (f.agent === 'none' ? !q.assigned_to : q.assigned_to === f.agent)) && (!f.sport || BL.guessSport(q.sport) === f.sport));
    const won = reqs.filter(q => tot(q) > 0 && inR(od(q), r));
    const prevWon = r.prev ? reqs.filter(q => tot(q) > 0 && inR(od(q), r.prev, true)) : null;
    const received = reqs.filter(q => inR(String(q.created_at).slice(0, 10), r));
    const receivedWon = received.filter(q => tot(q) > 0);
    const ids = [...new Set(reqs.map(q => q.assigned_to || 'none'))];
    const agents = ids.map(id => {
      const rs = reqs.filter(q => (q.assigned_to || 'none') === id);
      const w = rs.filter(q => won.includes(q)), rc = rs.filter(q => received.includes(q));
      return { id, name: id === 'none' ? t('req.unassigned') : BL.userName(id), role: id === 'none' ? '' : (S.users.find(u => u.id === id) || {}).role,
        received: rc.length, won: w.length, value: sum(w, tot), avg: w.length ? sum(w, tot) / w.length : 0,
        conv: pct(rc.filter(q => tot(q) > 0).length, rc.length), open: rs.filter(q => q.status === 'da_rispondere').length };
    }).filter(a => a.received || a.won || a.open).sort((a, b) => b.value - a.value || b.received - a.received);
    agents.forEach((a, i) => { a.color = a.id === 'none' ? '#9a9ea6' : PALETTE[i % PALETTE.length]; });
    const now = new Date();
    const monthly = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      const rs = reqs.filter(q => tot(q) > 0 && (od(q) || '').slice(0, 7) === key);
      return { y: d.getFullYear(), m: d.getMonth(), total: sum(rs, tot), parts: agents.map(a => ({ id: a.id, color: a.color, v: sum(rs.filter(q => (q.assigned_to || 'none') === a.id), tot) })) };
    });
    const bySport = Object.values(won.reduce((m, q) => { const k = BL.guessSport(q.sport) || '_other'; (m[k] = m[k] || { k, v: 0, n: 0 }); m[k].v += tot(q); m[k].n++; return m; }, {})).sort((a, b) => b.v - a.v);
    const teams = Object.values(won.reduce((m, q) => {
      const c = q.client_id && S.clients.find(x => String(x.id) === String(q.client_id));
      const k = c ? 'c' + c.id : 't' + String(q.team).toLowerCase();
      (m[k] = m[k] || { name: c ? c.name : q.team, client: c, req: q, agent: q.assigned_to, v: 0, n: 0 }); m[k].v += tot(q); m[k].n++; return m;
    }, {})).sort((a, b) => b.v - a.v).slice(0, 8);
    const byStatus = BL.REQ_STATUSES.map(st => { const rs = reqs.filter(q => q.status === st); return { st, n: rs.length, v: sum(rs, tot) }; });
    return { r, won, value: sum(won, tot), prevValue: prevWon ? sum(prevWon, tot) : null, received, receivedWon, agents, monthly, bySport, teams, byStatus };
  }

  const delta = (cur, prev) => {
    if (prev === null || prev === undefined) return '';
    if (!prev) return cur ? `<span class="delta up">${esc(t('an.new'))}</span>` : '';
    const d = Math.round((cur - prev) / prev * 100);
    return `<span class="delta ${d >= 0 ? 'up' : 'down'}" title="${esc(t('an.vsPrev'))}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}%</span>`;
  };
  function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1)))); const n = x / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
  function monthlyChart(monthly) {
    const W = 720, H = 220, pad = { l: 50, r: 8, t: 12, b: 26 };
    const max = Math.max(1, ...monthly.map(m => m.total));
    const step = niceStep(max / 4), top = Math.ceil(max / step) * step;
    const bw = (W - pad.l - pad.r) / monthly.length;
    const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
    let g = '';
    for (let v = 0; v <= top + 1e-9; v += step) g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${esc(fmt.num(v))}</text>`;
    const bars = monthly.map((m, i) => {
      let acc = 0;
      const x = pad.l + i * bw + bw * .18, w = bw * .64;
      const rects = m.parts.filter(p => p.v > 0).map(p => { const y0 = y(acc), y1 = y(acc + p.v); acc += p.v; return `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0, y0 - y1).toFixed(1)}" fill="${p.color}"/>`; }).join('');
      const d = new Date(m.y, m.m, 1);
      return `<g><title>${esc(d.toLocaleDateString(BL.locale(), { month: 'long', year: 'numeric' }))}: ${esc(fmt.eur(m.total))}</title>${rects}<rect x="${(pad.l + i * bw).toFixed(1)}" y="${pad.t}" width="${bw.toFixed(1)}" height="${H - pad.t - pad.b}" fill="transparent"/></g><text x="${(x + w / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="ax">${esc(d.toLocaleDateString(BL.locale(), { month: 'short' }).replace('.', ''))}</text>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('an.monthly'))}">${g}${bars}</svg>`;
  }

  BL.route('/dashboard', () => {
    const staff = BL.isStaff();
    const view = () => {
      const d = compute(dash);
      const kpi = (l, v, s, accent, go) => `<div class="card kpi ${accent ? 'accent' : ''} ${go ? 'click' : ''}" ${go ? `data-go="${go}"` : ''}><small>${esc(l)}</small><strong>${v}</strong><span>${s}</span></div>`;
      const due = BL.recontactDue().filter(x => !dash.agent || x.c.owner_id === dash.agent);
      const conv = pct(d.receivedWon.length, d.received.length);
      const kpis = `<div class="kpis">
        ${kpi(t('home.earnings'), esc(fmt.eurShort(d.value)), esc(t('home.earningsSub')) + ' ' + delta(d.value, d.prevValue), true)}
        ${kpi(t('home.orders'), esc(d.won.length), esc(t('home.avg', { v: fmt.eurShort(d.won.length ? d.value / d.won.length : 0) })))}
        ${kpi(t('home.received'), esc(d.received.length), esc(conv !== null ? t('an.conversion', { p: conv }) : t('home.noReceived')), false, '#/requests')}
        ${kpi(t('home.recall'), esc(due.length), esc(t('home.recallSub', { m: Number(S.settings.recontact_months) || 12 })), false, '#/clients?tab=recall')}
      </div>`;
      const maxA = Math.max(1, ...d.agents.map(a => a.value));
      const agentsCard = staff ? `<div class="card"><div class="card-h"><h3>${esc(t('an.byAgent'))}</h3><span class="hint">${esc(t('an.clickAgent'))}</span></div>
        <div class="tablewrap"><table class="t an-table"><thead><tr><th>${esc(t('common.agent'))}</th><th class="num">${esc(t('home.colReceived'))}</th><th class="num">${esc(t('home.colWon'))}</th><th class="num">${esc(t('an.colConv'))}</th><th>${esc(t('home.earnings'))}</th><th class="num">${esc(t('an.colAvg'))}</th><th class="num">${esc(t('req.da_rispondere'))}</th></tr></thead>
        <tbody>${d.agents.map(a => `<tr class="click ${dash.agent === a.id ? 'sel' : ''}" data-agent="${esc(a.id)}">
          <td><div class="row" style="gap:8px"><span class="swatch" style="background:${a.color}"></span><div><div class="cell-title">${esc(a.name)}</div>${a.role ? `<div class="cell-sub">${esc(t('role.' + a.role))}</div>` : ''}</div></div></td>
          <td class="num">${a.received}</td><td class="num"><b>${a.won}</b></td><td class="num">${a.conv !== null ? a.conv + '%' : '—'}</td>
          <td style="min-width:170px"><div class="row" style="gap:8px"><div class="bar grow"><i style="width:${(a.value / maxA * 100).toFixed(1)}%;background:${a.color}"></i></div><b class="nowrap">${esc(fmt.eurShort(a.value))}</b></div></td>
          <td class="num">${a.won ? esc(fmt.eurShort(a.avg)) : '—'}</td><td class="num">${a.open || '—'}</td></tr>`).join('') || `<tr><td colspan="7"><div class="empty">${esc(t('an.empty'))}</div></td></tr>`}</tbody></table></div></div>` : '';
      const legend = staff ? d.agents.filter(a => d.monthly.some(m => m.parts.some(p => p.id === a.id && p.v))).map(a => `<span><i style="background:${a.color}"></i>${esc(a.name)}</span>`).join('') : '';
      const monthlyCard = `<div class="card"><div class="card-h"><h3>${esc(t('an.monthly'))}</h3><span class="hint">${esc(t('home.monthlySub'))}</span></div><div class="card-b">${monthlyChart(d.monthly)}${legend ? `<div class="legend">${legend}</div>` : ''}</div></div>`;
      const fresh = S.requests.filter(q => q.status === 'da_rispondere').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const freshCard = `<div class="card ${fresh.length ? 'attn-card' : ''}"><div class="card-h"><h3>${esc(t('dash.openRequests'))}</h3><a class="btn ghost sm" href="#/requests">${esc(t('common.open'))} ${ic('chev')}</a></div><div class="card-b">
          ${fresh.slice(0, 5).map(q => `<a class="list-item click" href="#/requests?open=${esc(encodeURIComponent(q.id))}"><div class="initials">${esc(BL.initials(q.team))}</div><div class="grow"><div class="cell-title">${esc(q.team)}</div><div class="cell-sub">${esc(q.sport || '—')} · ${fmt.date(q.created_at)}${q.source && q.source !== 'manual' ? ' · ' + esc(t('req.fromWebsite')) : ''}</div></div></a>`).join('') || `<div class="empty" style="padding:22px">${esc(t('dash.noRequests'))}</div>`}</div></div>`;
      const newMentions = (S.mentions || []).filter(m => m.unread);
      const mentionsCard = newMentions.length ? `<div class="card attn-card"><div class="card-h"><h3>${ic('at')} ${esc(t('dash.mentionsTitle'))}</h3><a class="btn ghost sm" href="#/mentions">${esc(t('common.seeAll'))} ${ic('chev')}</a></div><div class="card-b">${newMentions.slice(0, 4).map(m => `<a class="list-item click" href="${esc(BL.mentionHref(m))}"><span class="avatar xs">${esc(BL.initials(BL.userName(m.author)))}</span><div class="grow"><div class="cell-title">${esc(BL.userName(m.author))} · <span class="hint">${esc(m.label)}</span></div><div class="cell-sub clamp2">${esc(m.text)}</div></div></a>`).join('')}</div></div>` : '';
      const teamsCard = `<div class="card"><div class="card-h"><h3>${esc(t('home.topTeams'))}</h3></div><div class="card-b">${d.teams.map((x, i) => `
          <a class="list-item click" href="${x.client ? '#/clients?open=' + esc(x.client.id) : '#/requests?open=' + esc(encodeURIComponent(x.req.id))}"><div class="initials">${i + 1}</div><div class="grow"><div class="cell-title">${esc(x.name)}</div><div class="cell-sub">${esc(x.agent ? BL.userName(x.agent) : t('req.unassigned'))} · ${esc(t('an.nOrders', { n: x.n }))}</div></div><b class="nowrap">${esc(fmt.eurShort(x.v))}</b></a>`).join('') || `<div class="empty" style="padding:22px">${esc(t('home.noEarnings'))}</div>`}</div></div>`;
      const maxS = Math.max(1, ...d.bySport.map(x => x.v));
      const sportCard = `<div class="card"><div class="card-h"><h3>${esc(t('dash.bySport'))}</h3></div><div class="card-b"><div class="bars">${d.bySport.map(x => {
          const sp = BL.sport(x.k);
          return `<div class="bar-row"><span>${sp ? BL.sportChip(sp.id) : esc(t('home.otherSport'))}</span><div class="bar"><i style="width:${(x.v / maxS * 100).toFixed(1)}%;background:${esc(sp ? sp.color : '#9a9ea6')}"></i></div><span class="right nowrap" style="font-variant-numeric:tabular-nums">${esc(fmt.eurShort(x.v))}</span></div>`;
        }).join('') || `<div class="hint">${esc(t('home.noEarnings'))}</div>`}</div></div></div>`;
      const maxF = Math.max(1, ...d.byStatus.map(x => x.n));
      const statusCard = `<div class="card"><div class="card-h"><h3>${esc(t('home.byStatus'))}</h3><span class="hint">${esc(t('an.funnelSub'))}</span></div><div class="card-b"><div class="bars">${d.byStatus.map(x => `
          <a class="bar-row click" href="#/requests"><span><span class="dot" style="background:${BL.REQ_COLORS[x.st]}"></span> ${esc(t('req.' + x.st))}</span><div class="bar"><i style="width:${(x.n / maxF * 100).toFixed(1)}%;background:${BL.REQ_COLORS[x.st]}"></i></div><span class="right nowrap"><b>${x.n}</b>${x.v ? ' · ' + esc(fmt.eurShort(x.v)) : ''}</span></a>`).join('')}</div></div></div>`;
      const recallCard = `<div class="card ${due.length ? 'attn-card' : ''}"><div class="card-h"><h3>${ic('phone')} ${esc(t('home.recall'))}</h3><a class="btn ghost sm" href="#/clients?tab=recall">${esc(t('common.seeAll'))} ${ic('chev')}</a></div><div class="card-b">
          ${due.slice(0, 5).map(x => `<a class="list-item click" href="#/clients?open=${esc(x.c.id)}"><div class="initials">${esc(BL.initials(x.c.name))}</div><div class="grow"><div class="cell-title">${esc(x.c.name)}</div><div class="cell-sub">${esc(t('home.lastOrder', { d: fmt.date(x.s.last), v: fmt.eurShort(x.s.value) }))}</div></div>${BL.recontactPill(x.s)}</a>`).join('') || `<div class="empty" style="padding:22px">${esc(t('home.noRecall'))}</div>`}</div></div>`;
      return `${kpis}${agentsCard ? `<div class="mb">${agentsCard}</div>` : ''}
        <div class="an-grid"><div class="stack">${monthlyCard}${statusCard}${teamsCard}</div><div class="stack">${mentionsCard}${freshCard}${recallCard}${sportCard}</div></div>
        <p class="hint">${esc(t('home.note'))}</p>`;
    };
    const hour = new Date().getHours();
    const greet = hour < 13 ? t('dash.morning') : hour < 18 ? t('dash.afternoon') : t('dash.evening');
    return {
      title: `${esc(greet)}, ${esc((S.me.full_name || '').split(' ')[0])}`,
      titleText: t('nav.dashboard'),
      subtitle: esc(new Date().toLocaleDateString(BL.locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })),
      actions: `${staff ? `<button class="btn ghost" data-act="csv">${ic('down')}CSV</button>` : ''}<a class="btn" href="#/requests?add=1">${ic('plus')}${esc(t('req.new'))}</a>`,
      body: `<div class="toolbar">
          <div class="tabs" id="an-per">${PERIODS.map(p => `<button class="tab ${dash.period === p ? 'active' : ''}" data-p="${p}">${esc(t('period.' + p))}</button>`).join('')}</div>
          ${staff ? `<select class="inp" id="an-ag" style="max-width:220px"><option value="">${esc(t('common.allAgents'))}</option>${S.users.filter(u => u.active !== false).map(u => `<option value="${esc(u.id)}" ${dash.agent === u.id ? 'selected' : ''}>${esc(u.full_name || u.email)}</option>`).join('')}<option value="none" ${dash.agent === 'none' ? 'selected' : ''}>${esc(t('req.unassigned'))}</option></select>` : ''}
          <select class="inp" id="an-sp" style="max-width:190px"><option value="">${esc(t('common.allSports'))}</option>${S.sports.map(x => `<option value="${x.id}" ${dash.sport === x.id ? 'selected' : ''}>${esc(BL.tl(x.name))}</option>`).join('')}</select>
        </div>
        <div id="an-view">${view()}</div>`,
      mount: (v, actions) => {
        const redraw = () => { v.querySelector('#an-view').innerHTML = view(); bind(); };
        const bind = () => {
          v.querySelectorAll('[data-agent]').forEach(tr => tr.addEventListener('click', () => { dash.agent = dash.agent === tr.dataset.agent ? '' : tr.dataset.agent; const s = v.querySelector('#an-ag'); if (s) s.value = dash.agent; redraw(); }));
          v.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => BL.go(el.dataset.go)));
        };
        bind();
        v.querySelector('#an-per').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (!b) return; dash.period = b.dataset.p; v.querySelectorAll('#an-per .tab').forEach(x => x.classList.toggle('active', x === b)); redraw(); });
        const ag = v.querySelector('#an-ag'); ag && ag.addEventListener('change', e => { dash.agent = e.target.value; redraw(); });
        v.querySelector('#an-sp').addEventListener('change', e => { dash.sport = e.target.value; redraw(); });
        const csv = actions.querySelector('[data-act=csv]');
        csv && csv.addEventListener('click', () => {
          const d = compute(dash);
          const n = (x) => String(Math.round((Number(x) || 0) * 100) / 100).replace('.', ',');
          const rows = d.won.slice().sort((a, b) => String(BL.reqOrderDate(a)).localeCompare(String(BL.reqOrderDate(b)))).map(q => [BL.reqOrderDate(q), q.team, q.sport || '', q.assigned_to ? BL.userName(q.assigned_to) : '', t('req.' + q.status), n(q.order_total)]);
          BL.download(`guadagni-${dash.period}-${new Date().toISOString().slice(0, 10)}.csv`, BL.toCSV([['data_ordine', 'squadra', 'sport', 'agente', 'stato', 'totale_iva_esclusa'], ...rows]), 'text/csv;charset=utf-8');
        });
      }
    };
  });
})();
