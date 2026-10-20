-- Numerazione automatica dei preventivi: 01.26, 02.26, … e dal 2027 di nuovo 01.27.
-- Un numero per ogni task (richiesta): se il preventivo della task viene modificato, il numero resta lo stesso.
create table if not exists public.bl_quote_counters (year int primary key, last_n int not null default 0);
create table if not exists public.bl_quote_numbers (
  request_id uuid primary key references public.requests(id) on delete cascade,
  year int not null, n int not null, label text not null unique,
  created_at timestamptz not null default now()
);
alter table public.bl_quote_counters enable row level security;
alter table public.bl_quote_numbers enable row level security;
revoke all on public.bl_quote_counters, public.bl_quote_numbers from public, anon, authenticated;

create or replace function public.bl_quote_number(p_request uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.requests%rowtype; lab text; y int; nn int;
begin
  if auth.uid() is null or not public.bl_is_member() then raise exception 'Accesso negato'; end if;
  select * into r from public.requests where id = p_request;
  if not found then raise exception 'Richiesta inesistente'; end if;
  if not (public.bl_is_staff() or r.assigned_to = auth.uid()) then raise exception 'Accesso negato'; end if;
  perform pg_advisory_xact_lock(hashtext('bl_quote_number'));
  select label into lab from public.bl_quote_numbers where request_id = p_request;
  if found then return lab; end if;
  y := extract(year from (now() at time zone 'Europe/Rome'))::int;
  insert into public.bl_quote_counters(year, last_n) values (y, 1)
    on conflict (year) do update set last_n = public.bl_quote_counters.last_n + 1
    returning last_n into nn;
  lab := lpad(nn::text, 2, '0') || '.' || lpad((y % 100)::text, 2, '0');
  insert into public.bl_quote_numbers(request_id, year, n, label) values (p_request, y, nn, lab);
  return lab;
end $$;
revoke all on function public.bl_quote_number(uuid) from public, anon;
grant execute on function public.bl_quote_number(uuid) to authenticated;
-- Inviti utenti senza Edge Function + protezione delle registrazioni.
-- 1) L'amministratore prepara l'invito (email, ruolo, lingua) e il CRM manda all'invitato un link di accesso via email.
-- 2) Al primo accesso l'invitato sceglie la sua password.
-- 3) Chi si registra da solo senza invito NON ottiene accesso (profilo disattivato finché un admin non lo attiva).
alter table public.profiles add column if not exists must_set_password boolean not null default false;

create table if not exists public.bl_invites (
  email text primary key,
  full_name text not null default '',
  role text not null default 'agent' check (role in ('admin','staff','agent')),
  language text not null default 'it',
  country text not null default '',
  invited_by uuid,
  created_at timestamptz not null default now()
);
alter table public.bl_invites enable row level security;
revoke all on public.bl_invites from public, anon, authenticated;

create or replace function public.bl_invite_prepare(p_email text, p_full_name text, p_role text, p_language text, p_country text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare em text := lower(trim(coalesce(p_email,''))); pr public.profiles%rowtype;
begin
  if auth.uid() is null or not public.bl_is_admin() then raise exception 'Solo gli amministratori possono invitare utenti'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email non valida'; end if;
  if coalesce(p_role,'') not in ('admin','staff','agent') then raise exception 'Ruolo non valido'; end if;
  select * into pr from public.profiles where lower(email) = em limit 1;
  if found then
    if pr.must_set_password then
      update public.profiles set full_name = coalesce(nullif(trim(p_full_name),''), full_name), role = p_role,
        language = coalesce(nullif(p_language,''),'it'), country = upper(left(coalesce(p_country,''),2)), active = true where id = pr.id;
      return 'resend';
    end if;
    raise exception 'Questa email ha già un account nel CRM: per cambiare ruolo modificalo dalla lista utenti.';
  end if;
  insert into public.bl_invites(email, full_name, role, language, country, invited_by)
  values (em, left(trim(coalesce(p_full_name,'')),200), p_role, coalesce(nullif(p_language,''),'it'), upper(left(coalesce(p_country,''),2)), auth.uid())
  on conflict (email) do update set full_name = excluded.full_name, role = excluded.role, language = excluded.language,
    country = excluded.country, invited_by = excluded.invited_by, created_at = now();
  return 'new';
end $$;
revoke all on function public.bl_invite_prepare(text,text,text,text,text) from public, anon;
grant execute on function public.bl_invite_prepare(text,text,text,text,text) to authenticated;

create or replace function public.bl_password_set() returns void
language sql security definer set search_path = public as $$
  update public.profiles set must_set_password = false where id = auth.uid();
$$;
revoke all on function public.bl_password_set() from public, anon;
grant execute on function public.bl_password_set() to authenticated;

-- Eseguito DOPO gli altri trigger di creazione profilo (ordine alfabetico: "zzz"):
-- invitato -> profilo attivo con il ruolo scelto dall'admin; non invitato -> profilo disattivato.
create or replace function public.bl_secure_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare inv public.bl_invites%rowtype;
begin
  select * into inv from public.bl_invites where email = lower(new.email);
  if found then
    insert into public.profiles(id, email, full_name, role, language, country, active, must_set_password)
    values (new.id, new.email, inv.full_name, inv.role, inv.language, inv.country, true, true)
    on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, role = excluded.role,
      language = excluded.language, country = excluded.country, active = true, must_set_password = true;
    delete from public.bl_invites where email = inv.email;
  elsif (to_jsonb(new)->>'invited_at') is null then
    -- registrazione spontanea (non invitata da un amministratore): nessun accesso
    insert into public.profiles(id, email, full_name, role, active)
    values (new.id, new.email, '', 'agent', false)
    on conflict (id) do update set role = 'agent', active = false;
  end if;
  return new;
end $$;
drop trigger if exists zzz_bl_secure_new_user on auth.users;
create trigger zzz_bl_secure_new_user after insert on auth.users for each row execute function public.bl_secure_new_user();
