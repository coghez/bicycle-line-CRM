// Edge Function: invita un nuovo utente (agente, ufficio o admin). Solo gli admin possono usarla.
// Deploy: supabase functions deploy bl-invite-user
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = req.headers.get('Authorization') ?? '';

    // chi sta chiamando?
    const asCaller = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await asCaller.auth.getUser();
    if (!user) return json({ error: 'Non autenticato' }, 401);
    const { data: me } = await asCaller.from('profiles').select('role, active').eq('id', user.id).single();
    if (!me || me.role !== 'admin' || me.active === false) return json({ error: 'Solo gli amministratori possono invitare utenti' }, 403);

    const body = await req.json();
    const email = String(body.email ?? '').trim().toLowerCase();
    const role = ['admin', 'staff', 'agent'].includes(body.role) ? body.role : 'agent';
    const language = ['it', 'en', 'fr', 'de', 'es'].includes(body.language) ? body.language : 'it';
    const full_name = String(body.full_name ?? '').trim().slice(0, 200);
    const country = String(body.country ?? '').trim().toUpperCase().slice(0, 2);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Email non valida' }, 400);

    const admin = createClient(url, service);
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name, role, language },
      redirectTo: typeof body.redirect_to === 'string' ? body.redirect_to : undefined
    });
    if (error) return json({ error: error.message }, 400);

    // il profilo può essere creato dal trigger: qui lo completiamo con ruolo, lingua e paese
    const { error: pErr } = await admin.from('profiles').upsert({ id: data.user.id, email, full_name, role, language, country, active: true }, { onConflict: 'id' });
    if (pErr) return json({ error: pErr.message }, 400);
    return json({ ok: true, id: data.user.id });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
