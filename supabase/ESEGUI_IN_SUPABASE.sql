-- BICYCLE LINE STUDIO — aggiornamento database (01_schema.sql + 02_seed.sql). Si può rieseguire.
-- =====================================================================
-- BICYCLE LINE STUDIO — migrazione Supabase
-- Compatibile con il CRM esistente (tabelle profiles, requests, request_events).
-- Si può rieseguire più volte (idempotente).
-- PRIMA DI ESEGUIRLA: fai un backup (Database → Backups) e leggi LEGGIMI-SUPABASE.md.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. PROFILI (esistente): aggiunge lingua, paese, stato e il ruolo "agent"
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'staff',
  created_at timestamptz not null default now()
);
-- nel CRM attuale il ruolo è un tipo "enum" (crm_role: admin/collaborator): diventa testo, così può avere anche "agent"
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles' and column_name = 'role' and data_type = 'USER-DEFINED') then
    alter table public.profiles alter column role drop default;
    alter table public.profiles alter column role type text using role::text;
  end if;
end $$;
alter table public.profiles add column if not exists language text not null default 'it';
alter table public.profiles add column if not exists country text not null default '';
alter table public.profiles add column if not exists active boolean not null default true;

-- vecchi ruoli del CRM ("collaboratore", "member", ...) diventano "staff" = ufficio
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.profiles'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;
-- il ruolo "grafico" non esiste più (i lavori grafici si gestiscono su Trello): eventuali utenti grafici vengono disattivati
update public.profiles set role = 'agent', active = false where role = 'designer';
update public.profiles set role = 'staff' where role is null or role not in ('admin', 'staff', 'agent');
alter table public.profiles alter column role set default 'staff';
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'staff', 'agent'));

-- ---------------------------------------------------------------------
-- 2. FUNZIONI DI PERMESSO (security definer: leggono il profilo senza RLS)
-- ---------------------------------------------------------------------
create or replace function public.bl_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;
create or replace function public.bl_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.bl_role() = 'admin', false)
$$;
create or replace function public.bl_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.bl_role() in ('admin', 'staff'), false)
$$;
create or replace function public.bl_is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.bl_role() is not null
$$;
revoke all on function public.bl_role(), public.bl_is_admin(), public.bl_is_staff(), public.bl_is_member() from public, anon;
grant execute on function public.bl_role(), public.bl_is_admin(), public.bl_is_staff(), public.bl_is_member() to authenticated;

-- crea il profilo alla registrazione SOLO se non esiste già un trigger su auth.users (quello del vecchio CRM)
create or replace function public.bl_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, language)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', ''),
          case when new.raw_user_meta_data->>'role' in ('admin','staff','agent') then new.raw_user_meta_data->>'role' else 'agent' end,
          coalesce(new.raw_user_meta_data->>'language', 'it'))
  on conflict (id) do nothing;
  return new;
end $$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal) then
    create trigger bl_on_auth_user_created after insert on auth.users
      for each row execute function public.bl_handle_new_user();
  end if;
end $$;

-- un utente non-admin non può cambiare il proprio ruolo o riattivarsi
create or replace function public.bl_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.bl_is_admin() then
    new.role := old.role; new.active := old.active; new.email := old.email;
  end if;
  return new;
end $$;
drop trigger if exists bl_profiles_guard on public.profiles;
create trigger bl_profiles_guard before update on public.profiles for each row execute function public.bl_profiles_guard();

-- ---------------------------------------------------------------------
-- 3. CATALOGO: sport (con regole commerciali), prodotti, impostazioni
-- ---------------------------------------------------------------------
create table if not exists public.sports (
  id text primary key,
  name jsonb not null default '{}',
  code text not null default '',
  color text not null default '#b3243a',
  season text not null default '',
  sort int not null default 0,
  active boolean not null default true,
  rules jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sport_id text not null references public.sports(id) on update cascade,
  sku text not null,
  name jsonb not null default '{}',
  category text not null default 'top',
  gender text not null default 'unisex' check (gender in ('men', 'women', 'both', 'unisex')),
  kids boolean not null default false,
  sizes jsonb not null default '[]',
  tiers jsonb not null default '[]',
  active boolean not null default true,
  sort int not null default 0,
  image text not null default '',
  notes text not null default '',
  updated_at timestamptz not null default now()
);
create unique index if not exists products_sport_sku_uq on public.products (sport_id, lower(sku));

create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id, data) values (1, '{"company_name":"Bicycle Line","order_prefix":"BL","validity_days":30}') on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 4. CLIENTI
-- ---------------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  name text not null check (length(trim(name)) > 0),
  contact_name text not null default '',
  email text not null default '',
  phone text not null default '',
  vat_number text not null default '',
  country text not null default 'IT',
  vat_regime text not null default 'it' check (vat_regime in ('it', 'eu_reverse', 'extra_eu')),
  billing_address text not null default '',
  delivery_address text not null default '',
  language text not null default 'it',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clients_owner_idx on public.clients(owner_id);
alter table public.clients add column if not exists recontacted_at date;

-- ---------------------------------------------------------------------
-- 5. ORDINI + storico
-- ---------------------------------------------------------------------
create table if not exists public.order_counters (year int primary key, last int not null default 0);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  number text unique,
  agent_id uuid not null references public.profiles(id),
  client_id uuid not null references public.clients(id) on delete restrict,
  client_snapshot jsonb not null default '{}',
  sport_id text not null references public.sports(id) on update cascade,
  order_type text not null default 'new' check (order_type in ('new', 'reorder', 'modified')),
  language text not null default 'it',
  status text not null default 'draft',
  lines jsonb not null default '[]',
  options jsonb not null default '{}',
  totals jsonb not null default '{}',
  notes text not null default '',
  request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz
);
alter table public.orders add column if not exists deposit jsonb;
alter table public.orders add column if not exists approved_at timestamptz;
alter table public.orders add column if not exists approved_by uuid;
alter table public.orders add column if not exists return_note text not null default '';
update public.orders set status = 'submitted' where status = 'review';
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.orders'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%'
  loop execute format('alter table public.orders drop constraint %I', c.conname); end loop;
end $$;
-- lo stato "Grafica in corso" non esiste più: quegli ordini tornano "Confermato"
update public.orders set status = 'approved' where status = 'design';
alter table public.orders add constraint orders_status_check check (status in ('draft', 'submitted', 'approved', 'production', 'shipped', 'cancelled'));
create index if not exists orders_agent_idx on public.orders(agent_id);
create index if not exists orders_client_idx on public.orders(client_id);
create index if not exists orders_status_idx on public.orders(status);

create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  actor uuid,
  type text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events(order_id);

-- richieste del CRM esistente: collegamenti a cliente/ordine
create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  team text not null, contact_name text, sport text, email text, athletes text, phone text,
  message text, notes text, status text not null default 'da_rispondere',
  assigned_to uuid references public.profiles(id), created_by uuid, source text default 'manual',
  created_at timestamptz not null default now()
);
alter table public.requests add column if not exists client_id uuid references public.clients(id) on delete set null;
alter table public.requests add column if not exists order_id uuid references public.orders(id) on delete set null;
-- totale dell'ordine chiuso con la squadra (IVA esclusa) e data: alimentano la panoramica e il promemoria di ricontatto
alter table public.requests add column if not exists order_total numeric(12,2);
alter table public.requests add column if not exists order_date date;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'requests_order_total_check') then
    alter table public.requests add constraint requests_order_total_check check (order_total is null or order_total >= 0);
  end if;
end $$;
create index if not exists requests_client_idx on public.requests(client_id);
create table if not exists public.request_events (
  id bigint generated always as identity primary key,
  request_id uuid references public.requests(id) on delete cascade,
  actor uuid, event_type text, detail jsonb default '{}', created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. MOTORE PREZZI (identico a js/pricing.js — i test confrontano le due versioni)
-- ---------------------------------------------------------------------
-- versione precedente (senza paese) sostituita da quella con le zone di trasporto
drop function if exists public.bl_compute_order(jsonb, jsonb, text, text, text);

-- zona di spedizione dal paese: 'it' (anche vuoto, SM, VA) | 'eu' | 'extra'
create or replace function public.bl_shipping_zone(p_country text) returns text
language sql immutable as $$
  select case
    when coalesce(upper(trim(p_country)), '') in ('', 'IT', 'SM', 'VA') then 'it'
    when upper(trim(p_country)) in ('AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU','IE','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK') then 'eu'
    else 'extra' end
$$;

create or replace function public.bl_compute_order(p_lines jsonb, p_options jsonb, p_type text, p_sport text, p_regime text, p_country text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb := coalesce((select rules from public.sports where id = p_sport), '{}'::jsonb);
  basis text := coalesce(r->>'tier_basis', 'product');
  sur jsonb;
  total_qty int := 0;
  prod record; tr record; s record; vl jsonb;
  items jsonb; q int; tq int; base_price numeric; unit numeric; mult numeric; line_total numeric;
  goods numeric := 0; setup numeric := 0; setup_waived boolean := false; extras numeric := 0;
  out_lines jsonb := '[]'; out_extras jsonb := '[]';
  gross numeric; dpct numeric; spct numeric; disc numeric; spons numeric; net numeric;
  zone text := public.bl_shipping_zone(p_country); ship_rule jsonb; base_ship numeric; free_over numeric; ship numeric := 0; ship_free boolean := false;
  taxable numeric; vat_rate numeric; vat numeric; total numeric; dep_pct numeric; deposit numeric;
  opt_extras jsonb := coalesce(p_options->'extras', '{}'::jsonb);
  e jsonb; eq int; et numeric;
begin
  p_type := coalesce(p_type, 'new');
  sur := case when p_type = 'reorder'
              then coalesce(r#>'{surcharge,reorder}', '[{"max":1,"mult":1.5},{"max":4,"mult":1.25}]')
              else coalesce(r#>'{surcharge,new}', '[{"max":1,"mult":2},{"max":4,"mult":1.5},{"max":9,"mult":1.25}]') end;

  -- righe valide (prodotti dello sport, quantità intere > 0)
  select coalesce(jsonb_agg(jsonb_build_object('product_id', pid, 'group', grp, 'size', sz, 'qty', qq, 'ord', ord) order by ord), '[]')
    into vl
    from (select l->>'product_id' as pid, coalesce(l->>'group', 'U') as grp, l->>'size' as sz,
                 greatest(0, floor(coalesce(nullif(l->>'qty', '')::numeric, 0)))::int as qq, ord
            from jsonb_array_elements(coalesce(p_lines, '[]')) with ordinality as x(l, ord)) z
   where qq > 0 and pid in (select id::text from public.products where sport_id = p_sport);
  select coalesce(sum((v->>'qty')::int), 0) into total_qty from jsonb_array_elements(vl) v;

  for prod in select p.* from public.products p
               where p.sport_id = p_sport and p.id::text in (select v->>'product_id' from jsonb_array_elements(vl) v)
               order by p.sort, p.sku loop
    select coalesce(sum((v->>'qty')::int), 0),
           coalesce(jsonb_agg(jsonb_build_object('group', v->>'group', 'size', v->>'size', 'qty', (v->>'qty')::int) order by (v->>'ord')::int), '[]')
      into q, items
      from jsonb_array_elements(vl) v where v->>'product_id' = prod.id::text;
    tq := case when basis = 'order' then total_qty else q end;
    unit := 0; mult := 1; base_price := null;
    -- fascia più alta con min <= tq
    for tr in select (t->>'min')::numeric as mn, (t->>'price')::numeric as pr from jsonb_array_elements(prod.tiers) t
              where (t->>'price')::numeric > 0 order by (t->>'min')::numeric loop
      if base_price is null then base_price := tr.pr; end if;   -- prima fascia = prezzo base
      if tq >= tr.mn then unit := round(tr.pr, 2); end if;
    end loop;
    if base_price is not null and unit = 0 and tq > 0 then
      for s in select (x->>'max')::numeric as mx, (x->>'mult')::numeric as ml from jsonb_array_elements(sur) x order by (x->>'max')::numeric loop
        if tq <= s.mx then mult := s.ml; exit; end if;
      end loop;
      unit := round(base_price * mult, 2);
    end if;
    line_total := round(unit * q, 2);
    goods := round(goods + line_total, 2);
    out_lines := out_lines || jsonb_build_object('product_id', prod.id, 'sku', prod.sku, 'name', prod.name, 'qty', q, 'unit', unit, 'mult', mult, 'total', line_total, 'sizes', items);
  end loop;

  setup := case when total_qty > 0 then coalesce((r#>>array['setup_fee', p_type])::numeric,
                 case p_type when 'new' then 150 when 'modified' then 80 else 0 end) else 0 end;
  if setup > 0 and coalesce((r->>'setup_free_over')::numeric, 1500) > 0 and goods > coalesce((r->>'setup_free_over')::numeric, 1500) then
    setup := 0; setup_waived := true;
  end if;

  for e in select * from jsonb_array_elements(coalesce(r->'extras', '[]')) loop
    eq := greatest(0, floor(coalesce(nullif(opt_extras->>(e->>'id'), '')::numeric, 0)))::int;
    if eq > 0 then
      et := round((e->>'price')::numeric * eq, 2);
      extras := round(extras + et, 2);
      out_extras := out_extras || jsonb_build_object('id', e->>'id', 'name', e->'name', 'qty', eq, 'unit', (e->>'price')::numeric, 'total', et);
    end if;
  end loop;

  gross := round(goods + setup + extras, 2);
  dpct := least(100, greatest(0, coalesce(nullif(p_options->>'discount', '')::numeric, 0)));
  spct := least(100, greatest(0, coalesce(nullif(p_options->>'sponsor', '')::numeric, 0)));
  disc := round(gross * dpct / 100, 2);
  spons := case when coalesce(r->>'discount_mode', 'cascade') = 'sum' then round(gross * spct / 100, 2) else round((gross - disc) * spct / 100, 2) end;
  net := greatest(0, round(gross - disc - spons, 2));

  base_ship := case when p_options ? 'shipping' and jsonb_typeof(p_options->'shipping') <> 'null' and coalesce(p_options->>'shipping', '') <> ''
                    then greatest(0, (p_options->>'shipping')::numeric)
                    else case when jsonb_typeof(r->'shipping') = 'object'
                              then coalesce(nullif(r->'shipping'->>zone, '')::numeric, case when zone = 'extra' then nullif(r->'shipping'->>'eu', '')::numeric end, 0)
                              when jsonb_typeof(r->'shipping') = 'number' then (r->>'shipping')::numeric
                              else case zone when 'it' then 15 else 25 end end end;
  free_over := coalesce((r->>'free_shipping_over')::numeric, 3000);
  ship_free := net > 0 and free_over > 0 and net > free_over;
  ship := case when net > 0 and not ship_free then round(base_ship, 2) else 0 end;

  taxable := round(net + ship, 2);
  vat_rate := case when coalesce(p_regime, 'it') = 'it' then coalesce((r->>'vat')::numeric, 22) else 0 end;
  vat := round(taxable * vat_rate / 100, 2);
  total := round(taxable + vat, 2);
  dep_pct := coalesce((r->>'deposit')::numeric, 50);
  deposit := round(total * dep_pct / 100, 2);

  return jsonb_build_object(
    'lines', out_lines, 'extras_lines', out_extras, 'qty', total_qty,
    'goods', goods, 'setup', setup, 'setup_waived', setup_waived, 'extras', extras, 'gross', gross,
    'discount_pct', dpct, 'discount', disc, 'sponsor_pct', spct, 'sponsor', spons, 'net', net,
    'shipping', ship, 'shipping_free', ship_free, 'shipping_zone', zone, 'taxable', taxable,
    'vat_rate', vat_rate, 'vat', vat, 'total', total, 'deposit_pct', dep_pct, 'deposit', deposit);
end $$;
revoke all on function public.bl_compute_order(jsonb, jsonb, text, text, text, text) from public, anon;
grant execute on function public.bl_compute_order(jsonb, jsonb, text, text, text, text) to authenticated;

-- vecchio formato (un solo importo di trasporto) → tariffe per zona: Italia 15 €, UE 25 €, extra UE 25 €
update public.sports set rules = jsonb_set(rules, '{shipping}', '{"it":15,"eu":25,"extra":25}'::jsonb)
 where jsonb_typeof(rules->'shipping') = 'number' or not (rules ? 'shipping');

-- ---------------------------------------------------------------------
-- 7. TRIGGER ORDINI: numero, dati cliente, ricalcolo prezzi, permessi agente, storico
-- ---------------------------------------------------------------------
create or replace function public.bl_orders_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c public.clients%rowtype;
  yr int; n int; prefix text;
  agent boolean := (public.bl_role() = 'agent') and coalesce(current_setting('bl.system', true), '') <> '1';
begin
  if TG_OP = 'UPDATE' and agent then
    if old.status <> 'draft' then raise exception 'Ordine già inviato: non modificabile'; end if;
    new.agent_id := old.agent_id;
  end if;
  if agent then
    if new.status not in ('draft', 'submitted') then raise exception 'Stato non consentito'; end if;
    if TG_OP = 'INSERT' then new.agent_id := auth.uid(); end if;
  end if;

  select * into c from public.clients where id = new.client_id;
  if not found then raise exception 'Cliente non trovato'; end if;
  if agent and c.owner_id <> auth.uid() then raise exception 'Cliente non accessibile'; end if;
  if new.agent_id is null then new.agent_id := c.owner_id; end if;

  if TG_OP = 'INSERT' then
    yr := extract(year from now())::int;
    insert into public.order_counters(year, last) values (yr, 1)
      on conflict (year) do update set last = public.order_counters.last + 1 returning last into n;
    prefix := coalesce(nullif((select data->>'order_prefix' from public.app_settings where id = 1), ''), 'BL');
    new.number := prefix || '-' || yr || '-' || lpad(n::text, 4, '0');
    new.created_at := now();
  else
    new.number := old.number; new.created_at := old.created_at;
  end if;

  -- ricalcolo SOLO se cambia il contenuto (un cambio di stato non altera i prezzi già confermati)
  if TG_OP = 'INSERT' or new.lines is distinct from old.lines or new.options is distinct from old.options
     or new.order_type is distinct from old.order_type or new.client_id is distinct from old.client_id or new.sport_id is distinct from old.sport_id then
    new.client_snapshot := jsonb_build_object('name', c.name, 'contact_name', c.contact_name, 'email', c.email, 'phone', c.phone,
      'vat_number', c.vat_number, 'country', c.country, 'vat_regime', c.vat_regime, 'billing_address', c.billing_address, 'delivery_address', c.delivery_address);
    new.totals := public.bl_compute_order(new.lines, new.options, new.order_type, new.sport_id, c.vat_regime, c.country);
    if coalesce((new.totals->>'qty')::int, 0) = 0 then raise exception 'Inserisci almeno una quantità'; end if;
    if exists (select 1 from jsonb_array_elements(new.totals->'lines') l where coalesce((l->>'unit')::numeric, 0) <= 0) then
      raise exception 'Prezzo non ancora definito per: %', (select string_agg(l->>'sku', ', ') from jsonb_array_elements(new.totals->'lines') l where coalesce((l->>'unit')::numeric, 0) <= 0);
    end if;
  end if;

  if new.status = 'submitted' and (TG_OP = 'INSERT' or old.status is distinct from 'submitted') then
    new.submitted_at := now(); new.return_note := '';
  end if;
  if agent and TG_OP = 'UPDATE' then new.deposit := old.deposit; new.approved_at := old.approved_at; new.approved_by := old.approved_by; end if;
  if agent and TG_OP = 'INSERT' then new.deposit := null; new.approved_at := null; new.approved_by := null; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists bl_orders_before on public.orders;
create trigger bl_orders_before before insert or update on public.orders for each row execute function public.bl_orders_before();

create or replace function public.bl_orders_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.order_events(order_id, actor, type, detail) values (new.id, auth.uid(), 'created', '{}');
    if new.status <> 'draft' then
      insert into public.order_events(order_id, actor, type, detail) values (new.id, auth.uid(), 'status', jsonb_build_object('from', 'draft', 'to', new.status));
    end if;
  else
    if new.lines is distinct from old.lines or new.options is distinct from old.options or new.notes is distinct from old.notes or new.client_id is distinct from old.client_id or new.order_type is distinct from old.order_type then
      insert into public.order_events(order_id, actor, type, detail) values (new.id, auth.uid(), 'updated', '{}');
    end if;
    if new.status is distinct from old.status then
      insert into public.order_events(order_id, actor, type, detail)
      values (new.id, auth.uid(), 'status', jsonb_build_object('from', old.status, 'to', new.status, 'note', coalesce(current_setting('bl.status_note', true), ''))
        || case when new.status = 'approved' and new.deposit is not null then jsonb_build_object('deposit', new.deposit->'amount') else '{}'::jsonb end);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists bl_orders_after on public.orders;
create trigger bl_orders_after after insert or update on public.orders for each row execute function public.bl_orders_after();

-- cambio stato con nota, in un'unica transazione
create or replace function public.bl_set_order_status(p_order uuid, p_status text, p_note text default '')
returns public.orders language plpgsql security invoker set search_path = public as $$
declare o public.orders;
begin
  perform set_config('bl.status_note', coalesce(p_note, ''), true);
  update public.orders set status = p_status,
         return_note = case when p_status = 'draft' then coalesce(p_note, '') else return_note end
   where id = p_order returning * into o;
  if not found then raise exception 'Ordine non trovato o non modificabile'; end if;
  return o;
end $$;
grant execute on function public.bl_set_order_status(uuid, text, text) to authenticated;

-- l'ufficio conferma l'ordine registrando l'acconto ricevuto
create or replace function public.bl_accept_order(p_order uuid, p_amount numeric, p_date date, p_note text default '')
returns public.orders language plpgsql security invoker set search_path = public as $$
declare o public.orders;
begin
  if not public.bl_is_staff() then raise exception 'Solo l''ufficio può confermare gli ordini'; end if;
  perform set_config('bl.status_note', coalesce(p_note, ''), true);
  update public.orders set status = 'approved', approved_at = now(), approved_by = auth.uid(),
         deposit = jsonb_build_object('amount', coalesce(p_amount, 0), 'date', coalesce(p_date, current_date), 'note', coalesce(p_note, ''))
   where id = p_order and status in ('draft', 'submitted') returning * into o;
  if not found then raise exception 'Ordine non trovato o già confermato'; end if;
  return o;
end $$;
grant execute on function public.bl_accept_order(uuid, numeric, date, text) to authenticated;

-- funzioni e viste del vecchio flusso grafici/bozzetti
drop function if exists public.bl_designer_take(uuid);
drop function if exists public.bl_set_proof_status(uuid, text);
drop view if exists public.orders_designer;
drop view if exists public.products_public;
drop view if exists public.sports_public;

-- chi può vedere un ordine (usato da chat, storico e file)
create or replace function public.bl_can_see_order(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orders o where o.id = p_order and (
    public.bl_is_staff()
    or (public.bl_role() = 'agent' and o.agent_id = auth.uid())))
$$;
revoke all on function public.bl_can_see_order(uuid) from public, anon;
grant execute on function public.bl_can_see_order(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- COMMENTI con @menzioni: sugli ordini (con file) e sulle richieste
-- ---------------------------------------------------------------------
create table if not exists public.order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  author uuid not null default auth.uid() references public.profiles(id),
  text text not null default '',
  kind text not null default 'message',
  attachments jsonb not null default '[]',
  created_at timestamptz not null default now()
);
alter table public.order_messages add column if not exists mentions uuid[] not null default '{}';
create index if not exists order_messages_order_idx on public.order_messages(order_id, created_at);
create index if not exists order_messages_mentions_idx on public.order_messages using gin (mentions);
create table if not exists public.order_reads (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, order_id)
);

-- commenti sulle richieste: request_id ha lo stesso tipo dell'id delle richieste del CRM esistente
do $$
declare idtype text;
begin
  if to_regclass('public.request_comments') is null then
    select format_type(a.atttypid, a.atttypmod) into idtype
      from pg_attribute a where a.attrelid = 'public.requests'::regclass and a.attname = 'id';
    execute format('create table public.request_comments (
      id uuid primary key default gen_random_uuid(),
      request_id %s not null references public.requests(id) on delete cascade,
      author uuid not null default auth.uid() references public.profiles(id),
      text text not null default '''',
      mentions uuid[] not null default ''{}'',
      created_at timestamptz not null default now())', idtype);
  end if;
end $$;
create index if not exists request_comments_req_idx on public.request_comments(request_id, created_at);
create index if not exists request_comments_mentions_idx on public.request_comments using gin (mentions);

-- quando l'utente ha guardato le menzioni l'ultima volta
create table if not exists public.mention_reads (
  user_id uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
  seen_at timestamptz not null default now()
);

-- chi può essere menzionato: solo chi può già vedere l'ordine o la richiesta
create or replace function public.bl_user_sees_order(p_user uuid, p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orders o join public.profiles p on p.id = p_user
                  where o.id = p_order and p.active and (p.role in ('admin', 'staff') or (p.role = 'agent' and o.agent_id = p_user)))
$$;
create or replace function public.bl_user_sees_request(p_user uuid, p_assigned uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                  where p.id = p_user and p.active and (p.role in ('admin', 'staff') or (p.role = 'agent' and p_assigned = p_user)))
$$;
revoke all on function public.bl_user_sees_order(uuid, uuid), public.bl_user_sees_request(uuid, uuid) from public, anon, authenticated;

create or replace function public.bl_messages_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author := auth.uid(); new.created_at := now(); new.kind := 'message';
  new.text := coalesce(new.text, ''); new.attachments := coalesce(new.attachments, '[]');
  if length(trim(new.text)) = 0 and jsonb_array_length(new.attachments) = 0 then raise exception 'Messaggio vuoto'; end if;
  new.mentions := coalesce(array(select distinct u from unnest(coalesce(new.mentions, '{}')) u
                                  where u <> auth.uid() and public.bl_user_sees_order(u, new.order_id)), '{}');
  return new;
end $$;
drop trigger if exists bl_messages_before on public.order_messages;
create trigger bl_messages_before before insert on public.order_messages for each row execute function public.bl_messages_before();

create or replace function public.bl_request_comments_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare assigned uuid;
begin
  new.author := auth.uid(); new.created_at := now(); new.text := trim(coalesce(new.text, ''));
  if length(new.text) = 0 then raise exception 'Commento vuoto'; end if;
  select r.assigned_to into assigned from public.requests r where r.id = new.request_id;
  new.mentions := coalesce(array(select distinct u from unnest(coalesce(new.mentions, '{}')) u
                                  where u <> auth.uid() and public.bl_user_sees_request(u, assigned)), '{}');
  return new;
end $$;
drop trigger if exists bl_request_comments_before on public.request_comments;
create trigger bl_request_comments_before before insert on public.request_comments for each row execute function public.bl_request_comments_before();

create or replace function public.bl_unread_counts()
returns table(order_id uuid, n bigint) language sql stable security invoker set search_path = public as $$
  select m.order_id, count(*) from public.order_messages m
    left join public.order_reads r on r.order_id = m.order_id and r.user_id = auth.uid()
   where m.author <> auth.uid() and (r.read_at is null or m.created_at > r.read_at)
   group by m.order_id
$$;
grant execute on function public.bl_unread_counts() to authenticated;

-- le mie menzioni (ordini + richieste), le più recenti per prime. Le RLS filtrano ciò che non posso vedere.
create or replace function public.bl_my_mentions(p_limit int default 60)
returns table(kind text, id uuid, target_id text, label text, author uuid, text text, created_at timestamptz, unread boolean)
language sql stable security invoker set search_path = public as $$
  with seen as (select coalesce((select seen_at from public.mention_reads where user_id = auth.uid()), '-infinity'::timestamptz) as s)
  select x.* from (
    select 'order'::text, m.id, m.order_id::text, coalesce(o.number, '') || ' · ' || coalesce(o.client_snapshot->>'name', ''),
           m.author, m.text, m.created_at, m.created_at > (select s from seen)
      from public.order_messages m join public.orders o on o.id = m.order_id
     where auth.uid() = any(m.mentions)
    union all
    select 'request'::text, c.id, c.request_id::text, coalesce(r.team, ''),
           c.author, c.text, c.created_at, c.created_at > (select s from seen)
      from public.request_comments c join public.requests r on r.id = c.request_id
     where auth.uid() = any(c.mentions)
  ) x order by x.created_at desc limit greatest(1, least(coalesce(p_limit, 60), 200))
$$;
grant execute on function public.bl_my_mentions(int) to authenticated;

create or replace function public.bl_mentions_seen() returns void
language sql security invoker set search_path = public as $$
  insert into public.mention_reads(user_id, seen_at) values (auth.uid(), now())
  on conflict (user_id) do update set seen_at = excluded.seen_at
$$;
grant execute on function public.bl_mentions_seen() to authenticated;

alter table public.order_messages enable row level security;
alter table public.order_reads enable row level security;
alter table public.request_comments enable row level security;
alter table public.mention_reads enable row level security;
drop policy if exists bl_msg_select on public.order_messages; create policy bl_msg_select on public.order_messages for select to authenticated using (public.bl_can_see_order(order_id));
drop policy if exists bl_msg_insert on public.order_messages; create policy bl_msg_insert on public.order_messages for insert to authenticated with check (author = auth.uid() and public.bl_can_see_order(order_id));
drop policy if exists bl_msg_delete on public.order_messages; create policy bl_msg_delete on public.order_messages for delete to authenticated using (public.bl_is_staff() or author = auth.uid());
drop policy if exists bl_reads_all on public.order_reads; create policy bl_reads_all on public.order_reads for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.bl_can_see_order(order_id));
drop policy if exists bl_rc_select on public.request_comments; create policy bl_rc_select on public.request_comments for select to authenticated using (exists (select 1 from public.requests r where r.id = request_id));
drop policy if exists bl_rc_insert on public.request_comments; create policy bl_rc_insert on public.request_comments for insert to authenticated with check (author = auth.uid() and public.bl_is_member() and exists (select 1 from public.requests r where r.id = request_id));
drop policy if exists bl_rc_delete on public.request_comments; create policy bl_rc_delete on public.request_comments for delete to authenticated using (public.bl_is_staff() or author = auth.uid());
drop policy if exists bl_mr_all on public.mention_reads; create policy bl_mr_all on public.mention_reads for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on public.order_messages, public.request_comments to authenticated;
grant select, insert, update, delete on public.order_reads, public.mention_reads to authenticated;

-- updated_at generico
create or replace function public.bl_touch() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists bl_touch on public.clients;  create trigger bl_touch before update on public.clients  for each row execute function public.bl_touch();
drop trigger if exists bl_touch on public.products; create trigger bl_touch before update on public.products for each row execute function public.bl_touch();
drop trigger if exists bl_touch on public.sports;   create trigger bl_touch before update on public.sports   for each row execute function public.bl_touch();

-- un agente assegna a sé stesso i clienti che crea
create or replace function public.bl_clients_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.bl_role() = 'agent' then
    if TG_OP = 'UPDATE' then new.owner_id := old.owner_id; else new.owner_id := auth.uid(); end if;
  end if;
  return new;
end $$;
drop trigger if exists bl_clients_before on public.clients;
create trigger bl_clients_before before insert or update on public.clients for each row execute function public.bl_clients_before();

-- ---------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.sports         enable row level security;
alter table public.products       enable row level security;
alter table public.app_settings   enable row level security;
alter table public.clients        enable row level security;
alter table public.orders         enable row level security;
alter table public.order_events   enable row level security;
alter table public.order_counters enable row level security;
alter table public.requests       enable row level security;
alter table public.request_events enable row level security;

-- Rimuove le vecchie policy di LETTURA/MODIFICA del CRM su profiles, requests e request_events
-- (che facevano vedere tutto a tutti). Le policy di solo INSERT (es. modulo del sito) vengono mantenute.
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public' and tablename in ('profiles', 'requests', 'request_events')
             and cmd <> 'INSERT' and policyname not like 'bl_%'
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- profili
drop policy if exists bl_profiles_select on public.profiles;
create policy bl_profiles_select on public.profiles for select to authenticated using (public.bl_is_member() or id = auth.uid());
drop policy if exists bl_profiles_update on public.profiles;
create policy bl_profiles_update on public.profiles for update to authenticated using (id = auth.uid() or public.bl_is_admin()) with check (id = auth.uid() or public.bl_is_admin());

-- catalogo e impostazioni: tutti leggono, solo admin scrive
drop policy if exists bl_sports_select on public.sports;     create policy bl_sports_select on public.sports for select to authenticated using (public.bl_is_member());
drop policy if exists bl_sports_write on public.sports;      create policy bl_sports_write on public.sports for all to authenticated using (public.bl_is_admin()) with check (public.bl_is_admin());
drop policy if exists bl_products_select on public.products; create policy bl_products_select on public.products for select to authenticated using (public.bl_is_member());
drop policy if exists bl_products_write on public.products;  create policy bl_products_write on public.products for all to authenticated using (public.bl_is_admin()) with check (public.bl_is_admin());
drop policy if exists bl_settings_select on public.app_settings; create policy bl_settings_select on public.app_settings for select to authenticated using (public.bl_is_member());
drop policy if exists bl_settings_write on public.app_settings;  create policy bl_settings_write on public.app_settings for all to authenticated using (public.bl_is_admin()) with check (public.bl_is_admin());

-- clienti: ufficio tutto, agente solo i suoi
drop policy if exists bl_clients_select on public.clients; create policy bl_clients_select on public.clients for select to authenticated using (public.bl_is_staff() or owner_id = auth.uid());
drop policy if exists bl_clients_insert on public.clients; create policy bl_clients_insert on public.clients for insert to authenticated with check (public.bl_is_staff() or (public.bl_is_member() and owner_id = auth.uid()));
drop policy if exists bl_clients_update on public.clients; create policy bl_clients_update on public.clients for update to authenticated using (public.bl_is_staff() or owner_id = auth.uid()) with check (public.bl_is_staff() or owner_id = auth.uid());
drop policy if exists bl_clients_delete on public.clients; create policy bl_clients_delete on public.clients for delete to authenticated using (public.bl_is_staff() or owner_id = auth.uid());

-- ordini: ufficio tutto, agente solo i suoi e modifica solo le bozze
drop policy if exists bl_orders_select on public.orders; create policy bl_orders_select on public.orders for select to authenticated using (public.bl_is_staff() or agent_id = auth.uid());
drop policy if exists bl_orders_insert on public.orders; create policy bl_orders_insert on public.orders for insert to authenticated with check (public.bl_is_staff() or (public.bl_is_member() and agent_id = auth.uid() and status in ('draft', 'submitted')));
drop policy if exists bl_orders_update on public.orders; create policy bl_orders_update on public.orders for update to authenticated using (public.bl_is_staff() or (agent_id = auth.uid() and status = 'draft')) with check (public.bl_is_staff() or (agent_id = auth.uid() and status in ('draft', 'submitted')));
drop policy if exists bl_orders_delete on public.orders; create policy bl_orders_delete on public.orders for delete to authenticated using (public.bl_is_staff() or (agent_id = auth.uid() and status = 'draft'));

drop policy if exists bl_oe_select on public.order_events; create policy bl_oe_select on public.order_events for select to authenticated using (public.bl_can_see_order(order_id));

drop policy if exists bl_oe_insert on public.order_events; create policy bl_oe_insert on public.order_events for insert to authenticated with check (type = 'note' and actor = auth.uid() and exists (select 1 from public.orders o where o.id = order_id));

-- richieste: ufficio tutte, agente solo quelle assegnate
drop policy if exists bl_requests_select on public.requests; create policy bl_requests_select on public.requests for select to authenticated using (public.bl_is_staff() or assigned_to = auth.uid());
drop policy if exists bl_requests_insert on public.requests; create policy bl_requests_insert on public.requests for insert to authenticated with check (public.bl_is_staff() or (public.bl_is_member() and assigned_to = auth.uid()));
drop policy if exists bl_requests_update on public.requests; create policy bl_requests_update on public.requests for update to authenticated using (public.bl_is_staff() or assigned_to = auth.uid()) with check (public.bl_is_staff() or assigned_to = auth.uid());
drop policy if exists bl_requests_delete on public.requests; create policy bl_requests_delete on public.requests for delete to authenticated using (public.bl_is_staff());
drop policy if exists bl_re_select on public.request_events; create policy bl_re_select on public.request_events for select to authenticated using (exists (select 1 from public.requests r where r.id = request_id));

grant select, insert, update, delete on public.sports, public.products, public.app_settings, public.clients, public.orders, public.requests to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert on public.order_events to authenticated;
grant select on public.request_events to authenticated;

-- ---------------------------------------------------------------------
-- 9. REALTIME (aggiornamento live tra più PC)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['requests', 'orders', 'clients', 'products', 'sports', 'order_messages', 'request_comments'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 10. FILE DELLA CHAT (Supabase Storage, bucket privato "order-files")
--     percorso: <id ordine>/<nome file>. Accesso solo a chi vede l'ordine.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('order-files', 'order-files', false) on conflict (id) do nothing;
    execute 'drop policy if exists bl_files_select on storage.objects';
    execute 'drop policy if exists bl_files_insert on storage.objects';
    execute 'drop policy if exists bl_files_delete on storage.objects';
    execute $p$create policy bl_files_select on storage.objects for select to authenticated
      using (bucket_id = 'order-files' and public.bl_can_see_order(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy bl_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'order-files' and public.bl_can_see_order(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy bl_files_delete on storage.objects for delete to authenticated
      using (bucket_id = 'order-files' and public.bl_is_staff())$p$;
  end if;
exception when insufficient_privilege or undefined_table or undefined_column then
  raise notice 'Bucket file non configurato (permessi Storage): il resto dello script prosegue';
end $$;

-- ---------------------------------------------------------------------
-- 11. PULIZIA: il ruolo grafico non esiste più
-- ---------------------------------------------------------------------
drop function if exists public.bl_is_designer();

-- BICYCLE LINE STUDIO — dati iniziali: 5 sport con regole commerciali + catalogo prodotti dei 5 sport (con foto) e prezzi Running 2027.
-- Sicuro da rieseguire: non sovrascrive sport/prodotti già esistenti.

insert into public.sports (id, name, code, color, season, sort, active, rules) values ('cycling', '{"it":"Ciclismo","en":"Cycling","fr":"Cyclisme","de":"Radsport","es":"Ciclismo"}'::jsonb, 'CY', '#b3243a', '2027', 1, true, '{"tier_basis":"product","surcharge":{"new":[{"max":1,"mult":2},{"max":4,"mult":1.5},{"max":9,"mult":1.25}],"reorder":[{"max":1,"mult":1.5},{"max":4,"mult":1.25}]},"setup_fee":{"new":150,"modified":80,"reorder":0},"setup_free_over":1500,"extras":[{"id":"logo_rebuild","name":{"it":"Logo da ricostruire","en":"Logo rebuild","fr":"Logo à reconstruire","de":"Logo-Rekonstruktion","es":"Reconstrucción de logo"},"price":30},{"id":"extra_graphic","name":{"it":"Grafica aggiuntiva","en":"Additional artwork","fr":"Graphisme supplémentaire","de":"Zusätzliche Grafik","es":"Diseño adicional"},"price":50},{"id":"print_proof","name":{"it":"Prova stampa","en":"Print proof","fr":"Épreuve d''impression","de":"Druckprobe","es":"Prueba de impresión"},"price":50},{"id":"line_change","name":{"it":"Modifica linea","en":"Line change","fr":"Modification de ligne","de":"Linienänderung","es":"Modificación de línea"},"price":50}],"discount_mode":"cascade","discount_options":[0,5,10,15],"sponsor_options":[0,5,10,15],"shipping":{"it":15,"eu":25,"extra":25},"free_shipping_over":3000,"vat":22,"deposit":50}'::jsonb) on conflict (id) do nothing;
insert into public.sports (id, name, code, color, season, sort, active, rules) values ('running', '{"it":"Running","en":"Running","fr":"Running","de":"Laufen","es":"Running"}'::jsonb, 'RU', '#d9622b', '2027', 2, true, '{"tier_basis":"product","surcharge":{"new":[{"max":1,"mult":2},{"max":4,"mult":1.5},{"max":9,"mult":1.25}],"reorder":[{"max":1,"mult":1.5},{"max":4,"mult":1.25}]},"setup_fee":{"new":150,"modified":80,"reorder":0},"setup_free_over":1500,"extras":[{"id":"logo_rebuild","name":{"it":"Logo da ricostruire","en":"Logo rebuild","fr":"Logo à reconstruire","de":"Logo-Rekonstruktion","es":"Reconstrucción de logo"},"price":30},{"id":"extra_graphic","name":{"it":"Grafica aggiuntiva","en":"Additional artwork","fr":"Graphisme supplémentaire","de":"Zusätzliche Grafik","es":"Diseño adicional"},"price":50},{"id":"print_proof","name":{"it":"Prova stampa","en":"Print proof","fr":"Épreuve d''impression","de":"Druckprobe","es":"Prueba de impresión"},"price":50},{"id":"line_change","name":{"it":"Modifica linea","en":"Line change","fr":"Modification de ligne","de":"Linienänderung","es":"Modificación de línea"},"price":50}],"discount_mode":"cascade","discount_options":[0,5,10,15],"sponsor_options":[0,5,10,15],"shipping":{"it":15,"eu":25,"extra":25},"free_shipping_over":3000,"vat":22,"deposit":50}'::jsonb) on conflict (id) do nothing;
insert into public.sports (id, name, code, color, season, sort, active, rules) values ('triathlon', '{"it":"Triathlon","en":"Triathlon","fr":"Triathlon","de":"Triathlon","es":"Triatlón"}'::jsonb, 'TR', '#2f6db5', '2027', 3, true, '{"tier_basis":"product","surcharge":{"new":[{"max":1,"mult":2},{"max":4,"mult":1.5},{"max":9,"mult":1.25}],"reorder":[{"max":1,"mult":1.5},{"max":4,"mult":1.25}]},"setup_fee":{"new":150,"modified":80,"reorder":0},"setup_free_over":1500,"extras":[{"id":"logo_rebuild","name":{"it":"Logo da ricostruire","en":"Logo rebuild","fr":"Logo à reconstruire","de":"Logo-Rekonstruktion","es":"Reconstrucción de logo"},"price":30},{"id":"extra_graphic","name":{"it":"Grafica aggiuntiva","en":"Additional artwork","fr":"Graphisme supplémentaire","de":"Zusätzliche Grafik","es":"Diseño adicional"},"price":50},{"id":"print_proof","name":{"it":"Prova stampa","en":"Print proof","fr":"Épreuve d''impression","de":"Druckprobe","es":"Prueba de impresión"},"price":50},{"id":"line_change","name":{"it":"Modifica linea","en":"Line change","fr":"Modification de ligne","de":"Linienänderung","es":"Modificación de línea"},"price":50}],"discount_mode":"cascade","discount_options":[0,5,10,15],"sponsor_options":[0,5,10,15],"shipping":{"it":15,"eu":25,"extra":25},"free_shipping_over":3000,"vat":22,"deposit":50}'::jsonb) on conflict (id) do nothing;
insert into public.sports (id, name, code, color, season, sort, active, rules) values ('speed_skating', '{"it":"Pattinaggio di velocità","en":"Speed skating","fr":"Patinage de vitesse","de":"Eisschnelllauf / Speedskating","es":"Patinaje de velocidad"}'::jsonb, 'SK', '#6b4fbb', '2027', 4, true, '{"tier_basis":"product","surcharge":{"new":[{"max":1,"mult":2},{"max":4,"mult":1.5},{"max":9,"mult":1.25}],"reorder":[{"max":1,"mult":1.5},{"max":4,"mult":1.25}]},"setup_fee":{"new":150,"modified":80,"reorder":0},"setup_free_over":1500,"extras":[{"id":"logo_rebuild","name":{"it":"Logo da ricostruire","en":"Logo rebuild","fr":"Logo à reconstruire","de":"Logo-Rekonstruktion","es":"Reconstrucción de logo"},"price":30},{"id":"extra_graphic","name":{"it":"Grafica aggiuntiva","en":"Additional artwork","fr":"Graphisme supplémentaire","de":"Zusätzliche Grafik","es":"Diseño adicional"},"price":50},{"id":"print_proof","name":{"it":"Prova stampa","en":"Print proof","fr":"Épreuve d''impression","de":"Druckprobe","es":"Prueba de impresión"},"price":50},{"id":"line_change","name":{"it":"Modifica linea","en":"Line change","fr":"Modification de ligne","de":"Linienänderung","es":"Modificación de línea"},"price":50}],"discount_mode":"cascade","discount_options":[0,5,10,15],"sponsor_options":[0,5,10,15],"shipping":{"it":15,"eu":25,"extra":25},"free_shipping_over":3000,"vat":22,"deposit":50}'::jsonb) on conflict (id) do nothing;
insert into public.sports (id, name, code, color, season, sort, active, rules) values ('rowing', '{"it":"Canottaggio","en":"Rowing","fr":"Aviron","de":"Rudern","es":"Remo"}'::jsonb, 'RW', '#1f8a7a', '2027', 5, true, '{"tier_basis":"product","surcharge":{"new":[{"max":1,"mult":2},{"max":4,"mult":1.5},{"max":9,"mult":1.25}],"reorder":[{"max":1,"mult":1.5},{"max":4,"mult":1.25}]},"setup_fee":{"new":150,"modified":80,"reorder":0},"setup_free_over":1500,"extras":[{"id":"logo_rebuild","name":{"it":"Logo da ricostruire","en":"Logo rebuild","fr":"Logo à reconstruire","de":"Logo-Rekonstruktion","es":"Reconstrucción de logo"},"price":30},{"id":"extra_graphic","name":{"it":"Grafica aggiuntiva","en":"Additional artwork","fr":"Graphisme supplémentaire","de":"Zusätzliche Grafik","es":"Diseño adicional"},"price":50},{"id":"print_proof","name":{"it":"Prova stampa","en":"Print proof","fr":"Épreuve d''impression","de":"Druckprobe","es":"Prueba de impresión"},"price":50},{"id":"line_change","name":{"it":"Modifica linea","en":"Line change","fr":"Modification de ligne","de":"Linienänderung","es":"Modificación de línea"},"price":50}],"discount_mode":"cascade","discount_options":[0,5,10,15],"sponsor_options":[0,5,10,15],"shipping":{"it":15,"eu":25,"extra":25},"free_shipping_over":3000,"vat":22,"deposit":50}'::jsonb) on conflict (id) do nothing;

insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6006', '{"it":"ECHELON · Maglia manica corta","en":"ECHELON · Short-sleeve jersey","fr":"ECHELON · Maillot manches courtes","de":"ECHELON · Kurzarmtrikot","es":"ECHELON · Maillot manga corta"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 1, 'img/products/cycling/W6006.jpg', 'Catalogo pag. 11.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6511', '{"it":"APEX · Maglia manica corta","en":"APEX · Short-sleeved jersey","fr":"APEX · Maillot manches courtes","de":"APEX · Kurzarmtrikot","es":"APEX · Maillot manga corta"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 2, 'img/products/cycling/W6511.jpg', 'Catalogo pag. 11.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6521', '{"it":"APEX ULTRA · Maglia manica corta mezza stagione","en":"APEX ULTRA · Midweight short-sleeved jersey","fr":"APEX ULTRA · Maillot manches courtes mi-saison","de":"APEX ULTRA · Kurzarmtrikot Übergang","es":"APEX ULTRA · Maillot manga corta entretiempo"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 3, 'img/products/cycling/W6521.jpg', 'Catalogo pag. 12.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6551', '{"it":"BASECAMP · Maglia manica corta","en":"BASECAMP · Short-sleeved jersey","fr":"BASECAMP · Maillot manches courtes","de":"BASECAMP · Kurzarmtrikot","es":"BASECAMP · Maillot manga corta"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 4, 'img/products/cycling/W6551.jpg', 'Catalogo pag. 12.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6301', '{"it":"DRAFT · Maglia manica corta","en":"DRAFT · Short-sleeved jersey","fr":"DRAFT · Maillot manches courtes","de":"DRAFT · Kurzarmtrikot","es":"DRAFT · Maillot manga corta"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 5, 'img/products/cycling/W6301.jpg', 'Catalogo pag. 13.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6701', '{"it":"B-CORE · Maglia manica corta","en":"B-CORE · Short-sleeved jersey","fr":"B-CORE · Maillot manches courtes","de":"B-CORE · Kurzarmtrikot","es":"B-CORE · Maillot manga corta"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 6, 'img/products/cycling/W6701.jpg', 'Catalogo pag. 13.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6526', '{"it":"APEX · Maglia smanicata","en":"APEX · Sleeveless jersey","fr":"APEX · Maillot sans manches","de":"APEX · Ärmelloses Trikot","es":"APEX · Maillot sin mangas"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 7, 'img/products/cycling/W6526.jpg', 'Catalogo pag. 14.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6005', '{"it":"ECHELON · Salopette","en":"ECHELON · Bib shorts","fr":"ECHELON · Cuissard à bretelles","de":"ECHELON · Trägerhose","es":"ECHELON · Culotte con tirantes"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 8, 'img/products/cycling/W6005.jpg', 'Catalogo pag. 15.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6028', '{"it":"ECHELON AIR · Salopette","en":"ECHELON AIR · Bib shorts","fr":"ECHELON AIR · Cuissard à bretelles","de":"ECHELON AIR · Trägerhose","es":"ECHELON AIR · Culotte con tirantes"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 9, 'img/products/cycling/W6028.jpg', 'Catalogo pag. 15.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6510', '{"it":"APEX · Salopette","en":"APEX · Bib shorts","fr":"APEX · Cuissard à bretelles","de":"APEX · Trägerhose","es":"APEX · Culotte con tirantes"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 10, 'img/products/cycling/W6510.jpg', 'Catalogo pag. 16.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6550', '{"it":"BASECAMP · Salopette","en":"BASECAMP · Bib shorts","fr":"BASECAMP · Cuissard à bretelles","de":"BASECAMP · Trägerhose","es":"BASECAMP · Culotte con tirantes"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 11, 'img/products/cycling/W6550.jpg', 'Catalogo pag. 16.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6308', '{"it":"DRAFT · Salopette","en":"DRAFT · Bib shorts","fr":"DRAFT · Cuissard à bretelles","de":"DRAFT · Trägerhose","es":"DRAFT · Culotte con tirantes"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 12, 'img/products/cycling/W6308.jpg', 'Catalogo pag. 17.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6702', '{"it":"B-CORE · Salopette","en":"B-CORE · Bib shorts","fr":"B-CORE · Cuissard à bretelles","de":"B-CORE · Trägerhose","es":"B-CORE · Culotte con tirantes"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 13, 'img/products/cycling/W6702.jpg', 'Catalogo pag. 17.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6040', '{"it":"ECHELON AIR CARGO · Salopette","en":"ECHELON AIR CARGO · Bib shorts","fr":"ECHELON AIR CARGO · Cuissard à bretelles","de":"ECHELON AIR CARGO · Trägerhose","es":"ECHELON AIR CARGO · Culotte con tirantes"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 14, 'img/products/cycling/W6040.jpg', 'Catalogo pag. 18.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6038', '{"it":"ECHELON AIR · Shorts","en":"ECHELON AIR · Shorts","fr":"ECHELON AIR · Short","de":"ECHELON AIR · Shorts","es":"ECHELON AIR · Pantalón corto"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 15, 'img/products/cycling/W6038.jpg', 'Catalogo pag. 18.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6535', '{"it":"APEX · Shorts","en":"APEX · Shorts","fr":"APEX · Short","de":"APEX · Shorts","es":"APEX · Pantalón corto"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 16, 'img/products/cycling/W6535.jpg', 'Catalogo pag. 19.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6008', '{"it":"ECHELON · Maglia manica lunga","en":"ECHELON · Long-sleeved jersey","fr":"ECHELON · Maillot manches longues","de":"ECHELON · Langarmtrikot","es":"ECHELON · Maillot manga larga"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 17, 'img/products/cycling/W6008.jpg', 'Catalogo pag. 20.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6017', '{"it":"ECHELON · Maglia manica lunga idrorepellente","en":"ECHELON · Water-repellent long-sleeved jersey","fr":"ECHELON · Maillot manches longues déperlant","de":"ECHELON · Wasserabweisendes Langarmtrikot","es":"ECHELON · Maillot manga larga hidrófugo"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 18, 'img/products/cycling/W6017.jpg', 'Catalogo pag. 20.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6512', '{"it":"APEX · Maglia manica lunga","en":"APEX · Long-sleeved jersey","fr":"APEX · Maillot manches longues","de":"APEX · Langarmtrikot","es":"APEX · Maillot manga larga"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 19, 'img/products/cycling/W6512.jpg', 'Catalogo pag. 21.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6007', '{"it":"ECHELON · Gilet antivento","en":"ECHELON · Windproof gilet","fr":"ECHELON · Gilet coupe-vent","de":"ECHELON · Windweste","es":"ECHELON · Chaleco cortavientos"}'::jsonb, 'outer', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 20, 'img/products/cycling/W6007.jpg', 'Catalogo pag. 22.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6513', '{"it":"APEX · Gilet antivento","en":"APEX · Windproof gilet","fr":"APEX · Gilet coupe-vent","de":"APEX · Windweste","es":"APEX · Chaleco cortavientos"}'::jsonb, 'outer', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 21, 'img/products/cycling/W6513.jpg', 'Catalogo pag. 22.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6013', '{"it":"ECHELON · Giacca invernale","en":"ECHELON · Winter jacket","fr":"ECHELON · Veste hiver","de":"ECHELON · Winterjacke","es":"ECHELON · Chaqueta de invierno"}'::jsonb, 'outer', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 22, 'img/products/cycling/W6013.jpg', 'Catalogo pag. 23.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6519', '{"it":"APEX · Giacca invernale","en":"APEX · Winter jacket","fr":"APEX · Veste hiver","de":"APEX · Winterjacke","es":"APEX · Chaqueta de invierno"}'::jsonb, 'outer', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 23, 'img/products/cycling/W6519.jpg', 'Catalogo pag. 23.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6100', '{"it":"APEX · Giacca antivento","en":"APEX · Windproof jacket","fr":"APEX · Veste coupe-vent","de":"APEX · Windjacke","es":"APEX · Chaqueta cortavientos"}'::jsonb, 'outer', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 24, 'img/products/cycling/W6100.jpg', 'Catalogo pag. 24.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6553', '{"it":"BASECAMP · Giacca antivento","en":"BASECAMP · Windproof jacket","fr":"BASECAMP · Veste coupe-vent","de":"BASECAMP · Windjacke","es":"BASECAMP · Chaqueta cortavientos"}'::jsonb, 'outer', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 25, 'img/products/cycling/W6553.jpg', 'Catalogo pag. 24.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6101', '{"it":"ECHELON · Giacca impermeabile manica corta","en":"ECHELON · Short-sleeved waterproof jacket","fr":"ECHELON · Veste imperméable manches courtes","de":"ECHELON · Wasserdichte Kurzarmjacke","es":"ECHELON · Chaqueta impermeable manga corta"}'::jsonb, 'outer', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 26, 'img/products/cycling/W6101.jpg', 'Catalogo pag. 25.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6014', '{"it":"ECHELON · Salopette termica","en":"ECHELON · Thermal bib shorts","fr":"ECHELON · Cuissard thermique à bretelles","de":"ECHELON · Thermo-Trägerhose kurz","es":"ECHELON · Culotte térmico con tirantes"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 27, 'img/products/cycling/W6014.jpg', 'Catalogo pag. 26.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6520', '{"it":"APEX · Salopette termica","en":"APEX · Thermal bib shorts","fr":"APEX · Cuissard thermique à bretelles","de":"APEX · Thermo-Trägerhose kurz","es":"APEX · Culotte térmico con tirantes"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 28, 'img/products/cycling/W6520.jpg', 'Catalogo pag. 26.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6009', '{"it":"ECHELON · Calzamaglia con bretelle","en":"ECHELON · Bib tights","fr":"ECHELON · Collant à bretelles","de":"ECHELON · Lange Trägerhose","es":"ECHELON · Culotte largo con tirantes"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 29, 'img/products/cycling/W6009.jpg', 'Catalogo pag. 27.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6518', '{"it":"APEX · Calzamaglia con bretelle","en":"APEX · Bib tights","fr":"APEX · Collant à bretelles","de":"APEX · Lange Trägerhose","es":"APEX · Culotte largo con tirantes"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 30, 'img/products/cycling/W6518.jpg', 'Catalogo pag. 27.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6534', '{"it":"APEX · Salopette 3/4 termica","en":"APEX · Thermal 3/4 bib knickers","fr":"APEX · Corsaire thermique à bretelles","de":"APEX · Thermo-3/4-Trägerhose","es":"APEX · Culotte 3/4 térmico con tirantes"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 31, 'img/products/cycling/W6534.jpg', 'Catalogo pag. 28.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6012', '{"it":"ECHELON · Body crono manica lunga stampato","en":"ECHELON · Printed long-sleeved chronosuit","fr":"ECHELON · Combinaison chrono manches longues imprimée","de":"ECHELON · Bedruckter Zeitfahranzug langarm","es":"ECHELON · Mono contrarreloj manga larga estampado"}'::jsonb, 'body', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 32, 'img/products/cycling/W6012.jpg', 'Catalogo pag. 29.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6015', '{"it":"ECHELON · Body crono manica lunga con loghi in silicone","en":"ECHELON · Long-sleeved chronosuit with silicone logos","fr":"ECHELON · Combinaison chrono manches longues logos silicone","de":"ECHELON · Zeitfahranzug langarm mit Silikonlogos","es":"ECHELON · Mono contrarreloj manga larga con logos de silicona"}'::jsonb, 'body', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 33, 'img/products/cycling/W6015.jpg', 'Catalogo pag. 29.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6024', '{"it":"ECHELON · Body crono manica corta con loghi in silicone","en":"ECHELON · Short-sleeved chronosuit with silicone logos","fr":"ECHELON · Combinaison chrono manches courtes logos silicone","de":"ECHELON · Zeitfahranzug kurzarm mit Silikonlogos","es":"ECHELON · Mono contrarreloj manga corta con logos de silicona"}'::jsonb, 'body', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 34, 'img/products/cycling/W6024.jpg', 'Catalogo pag. 30.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6011', '{"it":"APEX · Body strada manica corta","en":"APEX · Short-sleeved road racesuit","fr":"APEX · Combinaison route manches courtes","de":"APEX · Straßen-Rennanzug kurzarm","es":"APEX · Mono de carretera manga corta"}'::jsonb, 'body', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 35, 'img/products/cycling/W6011.jpg', 'Catalogo pag. 30.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6036', '{"it":"ECHELON · CYCLE-01 · Body aerodinamico","en":"ECHELON · CYCLE-01 · Aerodynamic skinsuit","fr":"ECHELON · CYCLE-01 · Combinaison aérodynamique","de":"ECHELON · CYCLE-01 · Aero-Einteiler","es":"ECHELON · CYCLE-01 · Mono aerodinámico"}'::jsonb, 'body', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 36, 'img/products/cycling/W6036.jpg', 'Catalogo pag. 31.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6004', '{"it":"ECHELON · Maglia manica corta","en":"ECHELON · Short-sleeved jersey","fr":"ECHELON · Maillot manches courtes","de":"ECHELON · Kurzarmtrikot","es":"ECHELON · Maillot manga corta"}'::jsonb, 'top', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 37, 'img/products/cycling/W6004.jpg', 'Catalogo pag. 33.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6514', '{"it":"APEX · Maglia manica corta","en":"APEX · Short-sleeved jersey","fr":"APEX · Maillot manches courtes","de":"APEX · Kurzarmtrikot","es":"APEX · Maillot manga corta"}'::jsonb, 'top', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 38, 'img/products/cycling/W6514.jpg', 'Catalogo pag. 33.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6529', '{"it":"APEX ULTRA · Maglia manica corta mezza stagione","en":"APEX ULTRA · Midweight short-sleeved jersey","fr":"APEX ULTRA · Maillot manches courtes mi-saison","de":"APEX ULTRA · Kurzarmtrikot Übergang","es":"APEX ULTRA · Maillot manga corta entretiempo"}'::jsonb, 'top', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 39, 'img/products/cycling/W6529.jpg', 'Catalogo pag. 34.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6302', '{"it":"DRAFT · Maglia manica corta","en":"DRAFT · Short-sleeved jersey","fr":"DRAFT · Maillot manches courtes","de":"DRAFT · Kurzarmtrikot","es":"DRAFT · Maillot manga corta"}'::jsonb, 'top', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 40, 'img/products/cycling/W6302.jpg', 'Catalogo pag. 34.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6045', '{"it":"ECHELON ASIA · Salopette","en":"ECHELON ASIA · Bib shorts","fr":"ECHELON ASIA · Cuissard à bretelles","de":"ECHELON ASIA · Trägerhose","es":"ECHELON ASIA · Culotte con tirantes"}'::jsonb, 'bottom', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 41, 'img/products/cycling/W6045.jpg', 'Catalogo pag. 35.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6046', '{"it":"ECHELON AIR · Salopette","en":"ECHELON AIR · Bib shorts","fr":"ECHELON AIR · Cuissard à bretelles","de":"ECHELON AIR · Trägerhose","es":"ECHELON AIR · Culotte con tirantes"}'::jsonb, 'bottom', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 42, 'img/products/cycling/W6046.jpg', 'Catalogo pag. 35.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6515', '{"it":"APEX · Salopette","en":"APEX · Bib shorts","fr":"APEX · Cuissard à bretelles","de":"APEX · Trägerhose","es":"APEX · Culotte con tirantes"}'::jsonb, 'bottom', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 43, 'img/products/cycling/W6515.jpg', 'Catalogo pag. 36.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6047', '{"it":"ECHELON AIR CARGO · Salopette","en":"ECHELON AIR CARGO · Bib shorts","fr":"ECHELON AIR CARGO · Cuissard à bretelles","de":"ECHELON AIR CARGO · Trägerhose","es":"ECHELON AIR CARGO · Culotte con tirantes"}'::jsonb, 'bottom', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 44, 'img/products/cycling/W6047.jpg', 'Catalogo pag. 36.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6516', '{"it":"APEX · Maglia manica lunga","en":"APEX · Long-sleeved jersey","fr":"APEX · Maillot manches longues","de":"APEX · Langarmtrikot","es":"APEX · Maillot manga larga"}'::jsonb, 'top', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 45, 'img/products/cycling/W6516.jpg', 'Catalogo pag. 37.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6517', '{"it":"APEX · Gilet antivento","en":"APEX · Windproof gilet","fr":"APEX · Gilet coupe-vent","de":"APEX · Windweste","es":"APEX · Chaleco cortavientos"}'::jsonb, 'outer', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 46, 'img/products/cycling/W6517.jpg', 'Catalogo pag. 37.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6541', '{"it":"APEX · Giacca invernale","en":"APEX · Winter jacket","fr":"APEX · Veste hiver","de":"APEX · Winterjacke","es":"APEX · Chaqueta de invierno"}'::jsonb, 'outer', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 47, 'img/products/cycling/W6541.jpg', 'Catalogo pag. 38.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W7201', '{"it":"FREE RIDE · T-shirt manica corta","en":"FREE RIDE · Short-sleeved T-shirt","fr":"FREE RIDE · T-shirt manches courtes","de":"FREE RIDE · Kurzarm-T-Shirt","es":"FREE RIDE · Camiseta manga corta"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 48, 'img/products/cycling/W7201.jpg', 'Catalogo pag. 40.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W7204', '{"it":"FREE RIDE · Maglia manica corta con zip","en":"FREE RIDE · Short-sleeved jersey with zip","fr":"FREE RIDE · Maillot manches courtes zippé","de":"FREE RIDE · Kurzarmtrikot mit Reißverschluss","es":"FREE RIDE · Maillot manga corta con cremallera"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 49, 'img/products/cycling/W7204.jpg', 'Catalogo pag. 41.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W7200', '{"it":"FREE RIDE · T-shirt manica lunga","en":"FREE RIDE · Long-sleeved T-shirt","fr":"FREE RIDE · T-shirt manches longues","de":"FREE RIDE · Langarm-T-Shirt","es":"FREE RIDE · Camiseta manga larga"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 50, 'img/products/cycling/W7200.jpg', 'Catalogo pag. 41.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W7203', '{"it":"FREE RIDE · T-shirt manica corta","en":"FREE RIDE · Short-sleeved T-shirt","fr":"FREE RIDE · T-shirt manches courtes","de":"FREE RIDE · Kurzarm-T-Shirt","es":"FREE RIDE · Camiseta manga corta"}'::jsonb, 'top', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 51, 'img/products/cycling/W7203.jpg', 'Catalogo pag. 42.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W7202', '{"it":"FREE RIDE · T-shirt manica lunga","en":"FREE RIDE · Long-sleeved T-shirt","fr":"FREE RIDE · T-shirt manches longues","de":"FREE RIDE · Langarm-T-Shirt","es":"FREE RIDE · Camiseta manga larga"}'::jsonb, 'top', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 52, 'img/products/cycling/W7202.jpg', 'Catalogo pag. 42.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W7205', '{"it":"FREE RIDE · Maglia manica corta con zip","en":"FREE RIDE · Short-sleeved zipped jersey","fr":"FREE RIDE · Maillot manches courtes zippé","de":"FREE RIDE · Kurzarmtrikot mit Reißverschluss","es":"FREE RIDE · Maillot manga corta con cremallera"}'::jsonb, 'top', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 53, 'img/products/cycling/W7205.jpg', 'Catalogo pag. 43.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6303', '{"it":"DRAFT · Maglia manica corta zip intera","en":"DRAFT · Full-zip short-sleeve jersey","fr":"DRAFT · Maillot manches courtes zip intégral","de":"DRAFT · Kurzarmtrikot mit durchgehendem Reißverschluss","es":"DRAFT · Maillot manga corta cremallera completa"}'::jsonb, 'top', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 54, 'img/products/cycling/W6303.jpg', 'Catalogo pag. 44.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W2200', '{"it":"ECHELON · Maglia manica corta zip intera","en":"ECHELON · Full-zip short-sleeve jersey","fr":"ECHELON · Maillot manches courtes zip intégral","de":"ECHELON · Kurzarmtrikot mit durchgehendem Reißverschluss","es":"ECHELON · Maillot manga corta cremallera completa"}'::jsonb, 'top', 'unisex', true, '["104","116","128","140","152","164"]'::jsonb, '[]'::jsonb, true, 55, 'img/products/cycling/W2200.jpg', 'Catalogo pag. 45.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W2201', '{"it":"KID · Maglia manica lunga","en":"KID · Long-sleeved jersey","fr":"KID · Maillot manches longues","de":"KID · Langarmtrikot","es":"KID · Maillot manga larga"}'::jsonb, 'top', 'unisex', true, '["104","116","128","140","152","164"]'::jsonb, '[]'::jsonb, true, 56, 'img/products/cycling/W2201.jpg', 'Catalogo pag. 45.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W2202', '{"it":"KID · Salopette","en":"KID · Bib shorts","fr":"KID · Cuissard à bretelles","de":"KID · Trägerhose","es":"KID · Culotte con tirantes"}'::jsonb, 'bottom', 'unisex', true, '["104","116","128","140","152","164"]'::jsonb, '[]'::jsonb, true, 57, 'img/products/cycling/W2202.jpg', 'Catalogo pag. 46.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W2219', '{"it":"KID · Pantaloncino senza bretelle","en":"KID · Shorts without bib straps","fr":"KID · Cuissard sans bretelles","de":"KID · Radhose ohne Träger","es":"KID · Culotte sin tirantes"}'::jsonb, 'bottom', 'unisex', true, '["104","116","128","140","152","164"]'::jsonb, '[]'::jsonb, true, 58, 'img/products/cycling/W2219.jpg', 'Catalogo pag. 46.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W2212', '{"it":"KID · Calzamaglia con bretelle","en":"KID · Bib tights","fr":"KID · Collant à bretelles","de":"KID · Lange Trägerhose","es":"KID · Culotte largo con tirantes"}'::jsonb, 'bottom', 'unisex', true, '["104","116","128","140","152","164"]'::jsonb, '[]'::jsonb, true, 59, 'img/products/cycling/W2212.jpg', 'Catalogo pag. 47.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W2218', '{"it":"KID · Calzamaglia senza bretelle","en":"KID · Tights","fr":"KID · Collant","de":"KID · Lange Radhose","es":"KID · Mallas"}'::jsonb, 'bottom', 'unisex', true, '["104","116","128","140","152","164"]'::jsonb, '[]'::jsonb, true, 60, 'img/products/cycling/W2218.jpg', 'Catalogo pag. 47.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W2210', '{"it":"KID · Giacca","en":"KID · Jacket","fr":"KID · Veste","de":"KID · Jacke","es":"KID · Chaqueta"}'::jsonb, 'outer', 'unisex', true, '["104","116","128","140","152","164"]'::jsonb, '[]'::jsonb, true, 61, 'img/products/cycling/W2210.jpg', 'Catalogo pag. 48.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W2204', '{"it":"KID · Gilet antivento","en":"KID · Windproof gilet","fr":"KID · Gilet coupe-vent","de":"KID · Windweste","es":"KID · Chaleco cortavientos"}'::jsonb, 'outer', 'unisex', true, '["104","116","128","140","152","164"]'::jsonb, '[]'::jsonb, true, 62, 'img/products/cycling/W2204.jpg', 'Catalogo pag. 48.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W2216', '{"it":"KID · Body manica corta","en":"KID · Short-sleeve skinsuit","fr":"KID · Combinaison manches courtes","de":"KID · Kurzarm-Einteiler","es":"KID · Mono manga corta"}'::jsonb, 'body', 'unisex', true, '["104","116","128","140","152","164"]'::jsonb, '[]'::jsonb, true, 63, 'img/products/cycling/W2216.jpg', 'Catalogo pag. 49.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W2217', '{"it":"KID · Body manica lunga","en":"KID · Long-sleeve skinsuit","fr":"KID · Combinaison manches longues","de":"KID · Langarm-Einteiler","es":"KID · Mono manga larga"}'::jsonb, 'body', 'unisex', true, '["104","116","128","140","152","164"]'::jsonb, '[]'::jsonb, true, 64, 'img/products/cycling/W2217.jpg', 'Catalogo pag. 49.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6604', '{"it":"Guanti estivi","en":"Summer gloves","fr":"Gants été","de":"Sommerhandschuhe","es":"Guantes de verano"}'::jsonb, 'accessory', 'unisex', false, '["XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 65, 'img/products/cycling/W6604.jpg', 'Catalogo pag. 51.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6605', '{"it":"Guanti estivi dita lunghe","en":"Full-finger summer gloves","fr":"Gants été doigts longs","de":"Langfinger-Sommerhandschuhe","es":"Guantes de verano dedos largos"}'::jsonb, 'accessory', 'unisex', false, '["XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 66, 'img/products/cycling/W6605.jpg', 'Catalogo pag. 51.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6606', '{"it":"Guanti invernali","en":"Winter gloves","fr":"Gants hiver","de":"Winterhandschuhe","es":"Guantes de invierno"}'::jsonb, 'accessory', 'unisex', false, '["XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 67, 'img/products/cycling/W6606.jpg', 'Catalogo pag. 52.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6602', '{"it":"Manicotti invernali","en":"Winter arm warmers","fr":"Manchettes hiver","de":"Winter-Armlinge","es":"Manguitos de invierno"}'::jsonb, 'accessory', 'unisex', false, '["XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 68, 'img/products/cycling/W6602.jpg', 'Catalogo pag. 53.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6607', '{"it":"Manicotti invernali stampati","en":"Fully printed winter arm warmers","fr":"Manchettes hiver imprimées","de":"Bedruckte Winter-Armlinge","es":"Manguitos de invierno estampados"}'::jsonb, 'accessory', 'unisex', false, '["XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 69, 'img/products/cycling/W6607.jpg', 'Catalogo pag. 53.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6603', '{"it":"Gambali invernali","en":"Winter leg warmers","fr":"Jambières hiver","de":"Winter-Beinlinge","es":"Perneras de invierno"}'::jsonb, 'accessory', 'unisex', false, '["XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 70, 'img/products/cycling/W6603.jpg', 'Catalogo pag. 54.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6608', '{"it":"Gambali invernali stampati","en":"Fully printed winter leg warmers","fr":"Jambières hiver imprimées","de":"Bedruckte Winter-Beinlinge","es":"Perneras de invierno estampadas"}'::jsonb, 'accessory', 'unisex', false, '["XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 71, 'img/products/cycling/W6608.jpg', 'Catalogo pag. 54.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W2632', '{"it":"Scaldacollo","en":"Neck tube","fr":"Tour de cou","de":"Halstuch","es":"Braga de cuello"}'::jsonb, 'accessory', 'unisex', false, '["TU"]'::jsonb, '[]'::jsonb, true, 72, 'img/products/cycling/W2632.jpg', 'Catalogo pag. 55.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6612', '{"it":"Cappellino Air-cap","en":"Air-cap","fr":"Casquette Air-cap","de":"Air-Cap","es":"Gorra Air-cap"}'::jsonb, 'accessory', 'unisex', false, '["S/M","L/XL"]'::jsonb, '[]'::jsonb, true, 73, 'img/products/cycling/W6612.jpg', 'Catalogo pag. 55.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W0274', '{"it":"Calze estive (polsino 13 cm)","en":"Summer socks (13 cm cuff)","fr":"Chaussettes été (tige 13 cm)","de":"Sommersocken (13 cm Bund)","es":"Calcetines de verano (puño 13 cm)"}'::jsonb, 'accessory', 'unisex', false, '["XS","S","M","L"]'::jsonb, '[]'::jsonb, true, 74, 'img/products/cycling/W0274.jpg', 'Catalogo pag. 56.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6610', '{"it":"Calze estive (polsino 18 cm)","en":"Summer socks (18 cm cuff)","fr":"Chaussettes été (tige 18 cm)","de":"Sommersocken (18 cm Bund)","es":"Calcetines de verano (puño 18 cm)"}'::jsonb, 'accessory', 'unisex', false, '["XS","S","M","L"]'::jsonb, '[]'::jsonb, true, 75, 'img/products/cycling/W6610.jpg', 'Catalogo pag. 56.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6600', '{"it":"Calze aero estive (piede nero)","en":"Aero summer socks (black foot)","fr":"Chaussettes aéro été (pied noir)","de":"Aero-Sommersocken (schwarzer Fuß)","es":"Calcetines aero de verano (pie negro)"}'::jsonb, 'accessory', 'unisex', false, '["XS","S","M","L"]'::jsonb, '[]'::jsonb, true, 76, 'img/products/cycling/W6600.jpg', 'Catalogo pag. 57.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('cycling', 'W6601', '{"it":"Calze aero estive (piede bianco)","en":"Aero summer socks (white foot)","fr":"Chaussettes aéro été (pied blanc)","de":"Aero-Sommersocken (weißer Fuß)","es":"Calcetines aero de verano (pie blanco)"}'::jsonb, 'accessory', 'unisex', false, '["XS","S","M","L"]'::jsonb, '[]'::jsonb, true, 77, 'img/products/cycling/W6601.jpg', 'Catalogo pag. 57.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7100', '{"it":"SPEED RUN · T-shirt manica corta girocollo","en":"SPEED RUN · Short-sleeve crew-neck T-shirt","fr":"SPEED RUN · T-shirt manches courtes col rond","de":"SPEED RUN · Kurzarm-T-Shirt Rundhals","es":"SPEED RUN · Camiseta manga corta cuello redondo"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[{"min":10,"price":34.2},{"min":30,"price":32.5},{"min":60,"price":31.4}]'::jsonb, true, 1, 'img/products/running/W7100.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 22). Catalogo pag. 5.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7114', '{"it":"SPEED RUN · T-shirt manica corta collo a V","en":"SPEED RUN · Short-sleeve V-neck T-shirt","fr":"SPEED RUN · T-shirt manches courtes col en V","de":"SPEED RUN · Kurzarm-T-Shirt mit V-Ausschnitt","es":"SPEED RUN · Camiseta manga corta cuello en V"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[{"min":10,"price":33.8},{"min":30,"price":32.3},{"min":60,"price":31.2}]'::jsonb, true, 2, 'img/products/running/W7114.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 28). Catalogo pag. 5.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7101', '{"it":"SPEED RUN · Canotta","en":"SPEED RUN · Singlet","fr":"SPEED RUN · Débardeur","de":"SPEED RUN · Singlet","es":"SPEED RUN · Camiseta de tirantes"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[{"min":10,"price":27.7},{"min":30,"price":26.4},{"min":60,"price":25.6}]'::jsonb, true, 3, 'img/products/running/W7101.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 34). Catalogo pag. 6.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7901', '{"it":"PROFLEX · Body atletica manica corta","en":"PROFLEX · Short-sleeve athletics suit","fr":"PROFLEX · Combinaison athlétisme manches courtes","de":"PROFLEX · Leichtathletik-Einteiler kurzarm","es":"PROFLEX · Mono de atletismo manga corta"}'::jsonb, 'body', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[{"min":10,"price":53},{"min":30,"price":50.6},{"min":60,"price":49.2}]'::jsonb, true, 4, 'img/products/running/W7901.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 114). Catalogo pag. 6.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7102', '{"it":"SPEED RUN · Pantaloncini con slip","en":"SPEED RUN · Shorts with brief","fr":"SPEED RUN · Short avec slip","de":"SPEED RUN · Shorts mit Innenslip","es":"SPEED RUN · Pantalón corto con slip"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[{"min":10,"price":45.6},{"min":30,"price":43.8},{"min":60,"price":42.5}]'::jsonb, true, 5, 'img/products/running/W7102.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 92). Catalogo pag. 7.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7112', '{"it":"SPEED RUN · Pantaloncini senza slip","en":"SPEED RUN · Shorts without brief","fr":"SPEED RUN · Short sans slip","de":"SPEED RUN · Shorts ohne Innenslip","es":"SPEED RUN · Pantalón corto sin slip"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[{"min":10,"price":42.8},{"min":30,"price":41.2},{"min":60,"price":40}]'::jsonb, true, 6, 'img/products/running/W7112.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 86). Catalogo pag. 7.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W2919', '{"it":"SPEED RUN · Pantaloncini elasticizzati","en":"SPEED RUN · Stretch shorts","fr":"SPEED RUN · Short élastique","de":"SPEED RUN · Elastische Shorts","es":"SPEED RUN · Pantalón corto elástico"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[{"min":10,"price":34},{"min":30,"price":32.6},{"min":60,"price":31.6}]'::jsonb, true, 7, 'img/products/running/W2919.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 80). Catalogo pag. 8.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W2901', '{"it":"SPEED RUN · Maglia termica manica lunga con zip corta","en":"SPEED RUN · Thermal long-sleeve top with short zip","fr":"SPEED RUN · Maillot thermique manches longues zip court","de":"SPEED RUN · Thermo-Langarmshirt mit kurzem Reißverschluss","es":"SPEED RUN · Camiseta térmica manga larga con cremallera corta"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[{"min":10,"price":50.3},{"min":30,"price":47.9},{"min":60,"price":46.3}]'::jsonb, true, 8, 'img/products/running/W2901.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 40). Catalogo pag. 8.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7106', '{"it":"SPEED RUN · T-shirt manica lunga termica","en":"SPEED RUN · Thermal long-sleeve T-shirt","fr":"SPEED RUN · T-shirt thermique manches longues","de":"SPEED RUN · Thermo-Langarm-T-Shirt","es":"SPEED RUN · Camiseta térmica manga larga"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[{"min":10,"price":45.3},{"min":30,"price":43.2},{"min":60,"price":41.8}]'::jsonb, true, 9, 'img/products/running/W7106.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 46). Catalogo pag. 9.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7107', '{"it":"SPEED RUN · T-shirt manica lunga leggera","en":"SPEED RUN · Lightweight long-sleeve T-shirt","fr":"SPEED RUN · T-shirt manches longues légère","de":"SPEED RUN · Leichtes Langarm-T-Shirt","es":"SPEED RUN · Camiseta manga larga ligera"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[{"min":10,"price":36.6},{"min":30,"price":34.9},{"min":60,"price":33.6}]'::jsonb, true, 10, 'img/products/running/W7107.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 52). Catalogo pag. 9.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7108', '{"it":"SPEED RUN · Mantellina leggera antivento","en":"SPEED RUN · Lightweight windproof jacket","fr":"SPEED RUN · Veste coupe-vent légère","de":"SPEED RUN · Leichte Windjacke","es":"SPEED RUN · Chaqueta cortavientos ligera"}'::jsonb, 'outer', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[{"min":10,"price":50.5},{"min":30,"price":48.5},{"min":60,"price":47}]'::jsonb, true, 11, 'img/products/running/W7108.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 68). Catalogo pag. 10.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W3701', '{"it":"SPEED RUN · Gilet leggero antivento","en":"SPEED RUN · Lightweight windproof gilet","fr":"SPEED RUN · Gilet coupe-vent léger","de":"SPEED RUN · Leichte Windweste","es":"SPEED RUN · Chaleco cortavientos ligero"}'::jsonb, 'outer', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[{"min":10,"price":38.5},{"min":30,"price":36.9},{"min":60,"price":35.8}]'::jsonb, true, 12, 'img/products/running/W3701.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 74). Catalogo pag. 10.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W2912', '{"it":"SPEED RUN · Fuseaux lungo","en":"SPEED RUN · Long tights","fr":"SPEED RUN · Collant long","de":"SPEED RUN · Lange Tights","es":"SPEED RUN · Mallas largas"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[{"min":10,"price":43.9},{"min":30,"price":42.1},{"min":60,"price":40.9}]'::jsonb, true, 13, 'img/products/running/W2912.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 108). Catalogo pag. 11.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7015', '{"it":"HYBRID S · Pantaloncino con slip interno","en":"HYBRID S · Shorts with inner brief","fr":"HYBRID S · Short avec slip intérieur","de":"HYBRID S · Shorts mit Innenslip","es":"HYBRID S · Pantalón corto con slip interior"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[{"min":10,"price":59.5},{"min":30,"price":57.2},{"min":60,"price":55.6}]'::jsonb, true, 14, 'img/products/running/W7015.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 98). Catalogo pag. 11.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7103', '{"it":"SPEED RUN · T-shirt manica corta girocollo","en":"SPEED RUN · Short-sleeve crew-neck T-shirt","fr":"SPEED RUN · T-shirt manches courtes col rond","de":"SPEED RUN · Kurzarm-T-Shirt Rundhals","es":"SPEED RUN · Camiseta manga corta cuello redondo"}'::jsonb, 'top', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[{"min":10,"price":34.2},{"min":30,"price":32.5},{"min":60,"price":31.4}]'::jsonb, true, 15, 'img/products/running/W7103.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 22). Catalogo pag. 13.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7116', '{"it":"SPEED RUN · T-shirt manica corta collo a V","en":"SPEED RUN · Short-sleeve V-neck T-shirt","fr":"SPEED RUN · T-shirt manches courtes col en V","de":"SPEED RUN · Kurzarm-T-Shirt mit V-Ausschnitt","es":"SPEED RUN · Camiseta manga corta cuello en V"}'::jsonb, 'top', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[{"min":10,"price":33.8},{"min":30,"price":32.3},{"min":60,"price":31.2}]'::jsonb, true, 16, 'img/products/running/W7116.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 28). Catalogo pag. 13.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7104', '{"it":"SPEED RUN · Canotta","en":"SPEED RUN · Singlet","fr":"SPEED RUN · Débardeur","de":"SPEED RUN · Singlet","es":"SPEED RUN · Camiseta de tirantes"}'::jsonb, 'top', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[{"min":10,"price":27.7},{"min":30,"price":26.4},{"min":60,"price":25.6}]'::jsonb, true, 17, 'img/products/running/W7104.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 34). Catalogo pag. 14.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7118', '{"it":"FIONA · Reggiseno sportivo","en":"FIONA · Sports bra","fr":"FIONA · Brassière de sport","de":"FIONA · Sport-BH","es":"FIONA · Sujetador deportivo"}'::jsonb, 'top', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[{"min":10,"price":28.9},{"min":30,"price":27.7},{"min":60,"price":26.8}]'::jsonb, true, 18, 'img/products/running/W7118.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 58). Catalogo pag. 14.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7119', '{"it":"LARY · Top","en":"LARY · Top","fr":"LARY · Top","de":"LARY · Top","es":"LARY · Top"}'::jsonb, 'top', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[{"min":10,"price":31.1},{"min":30,"price":29.9},{"min":60,"price":29}]'::jsonb, true, 19, 'img/products/running/W7119.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 63). Catalogo pag. 15.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7105', '{"it":"SPEED RUN · Pantaloncino 2-in-1","en":"SPEED RUN · 2-in-1 shorts","fr":"SPEED RUN · Short 2 en 1","de":"SPEED RUN · 2-in-1-Shorts","es":"SPEED RUN · Pantalón corto 2 en 1"}'::jsonb, 'bottom', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[{"min":10,"price":42},{"min":30,"price":40},{"min":60,"price":38}]'::jsonb, true, 20, 'img/products/running/W7105.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 103). Catalogo pag. 15.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7113', '{"it":"SPEED RUN · Pantaloncini senza slip","en":"SPEED RUN · Shorts without brief","fr":"SPEED RUN · Short sans slip","de":"SPEED RUN · Shorts ohne Innenslip","es":"SPEED RUN · Pantalón corto sin slip"}'::jsonb, 'bottom', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[{"min":10,"price":42.8},{"min":30,"price":41.2},{"min":60,"price":40}]'::jsonb, true, 21, 'img/products/running/W7113.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 86). Catalogo pag. 16.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7115', '{"it":"SPEED RUN · Pantaloncini con perizoma","en":"SPEED RUN · Shorts with thong brief","fr":"SPEED RUN · Short avec string intégré","de":"SPEED RUN · Shorts mit String-Innenslip","es":"SPEED RUN · Pantalón corto con tanga interior"}'::jsonb, 'bottom', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[{"min":10,"price":45.6},{"min":30,"price":43.8},{"min":60,"price":42.5}]'::jsonb, true, 22, 'img/products/running/W7115.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 92). Catalogo pag. 16.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W2915', '{"it":"SPEED RUN · Pantaloncini elasticizzati","en":"SPEED RUN · Stretch shorts","fr":"SPEED RUN · Short élastique","de":"SPEED RUN · Elastische Shorts","es":"SPEED RUN · Pantalón corto elástico"}'::jsonb, 'bottom', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[{"min":10,"price":34},{"min":30,"price":32.6},{"min":60,"price":31.6}]'::jsonb, true, 23, 'img/products/running/W2915.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 80). Catalogo pag. 17.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W2930', '{"it":"SPEED RUN · Maglia termica manica lunga con zip corta","en":"SPEED RUN · Thermal long-sleeve top with short zip","fr":"SPEED RUN · Maillot thermique manches longues zip court","de":"SPEED RUN · Thermo-Langarmshirt mit kurzem Reißverschluss","es":"SPEED RUN · Camiseta térmica manga larga con cremallera corta"}'::jsonb, 'top', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[{"min":10,"price":50.3},{"min":30,"price":47.9},{"min":60,"price":46.3}]'::jsonb, true, 24, 'img/products/running/W2930.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 40). Catalogo pag. 17.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7109', '{"it":"SPEED RUN · T-shirt manica lunga termica","en":"SPEED RUN · Thermal long-sleeve T-shirt","fr":"SPEED RUN · T-shirt thermique manches longues","de":"SPEED RUN · Thermo-Langarm-T-Shirt","es":"SPEED RUN · Camiseta térmica manga larga"}'::jsonb, 'top', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[{"min":10,"price":45.3},{"min":30,"price":43.2},{"min":60,"price":41.8}]'::jsonb, true, 25, 'img/products/running/W7109.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 46). Catalogo pag. 18.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7110', '{"it":"SPEED RUN · T-shirt manica lunga leggera","en":"SPEED RUN · Lightweight long-sleeve T-shirt","fr":"SPEED RUN · T-shirt manches longues légère","de":"SPEED RUN · Leichtes Langarm-T-Shirt","es":"SPEED RUN · Camiseta manga larga ligera"}'::jsonb, 'top', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[{"min":10,"price":36.6},{"min":30,"price":34.9},{"min":60,"price":33.6}]'::jsonb, true, 26, 'img/products/running/W7110.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 52). Catalogo pag. 18.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7111', '{"it":"SPEED RUN · Mantellina leggera antivento","en":"SPEED RUN · Lightweight windproof jacket","fr":"SPEED RUN · Veste coupe-vent légère","de":"SPEED RUN · Leichte Windjacke","es":"SPEED RUN · Chaqueta cortavientos ligera"}'::jsonb, 'outer', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[{"min":10,"price":50.5},{"min":30,"price":48.5},{"min":60,"price":47}]'::jsonb, true, 27, 'img/products/running/W7111.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 68). Catalogo pag. 19.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W3705', '{"it":"SPEED RUN · Gilet leggero antivento","en":"SPEED RUN · Lightweight windproof gilet","fr":"SPEED RUN · Gilet coupe-vent léger","de":"SPEED RUN · Leichte Windweste","es":"SPEED RUN · Chaleco cortavientos ligero"}'::jsonb, 'outer', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[{"min":10,"price":38.5},{"min":30,"price":36.9},{"min":60,"price":35.8}]'::jsonb, true, 28, 'img/products/running/W3705.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 74). Catalogo pag. 19.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W2960', '{"it":"SPEED RUN · Fuseaux 3/4","en":"SPEED RUN · 3/4 tights","fr":"SPEED RUN · Corsaire 3/4","de":"SPEED RUN · 3/4-Tights","es":"SPEED RUN · Mallas 3/4"}'::jsonb, 'bottom', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[]'::jsonb, true, 29, 'img/products/running/W2960.jpg', 'Catalogo pag. 20.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W2913', '{"it":"SPEED RUN · Fuseaux lungo","en":"SPEED RUN · Long tights","fr":"SPEED RUN · Collant long","de":"SPEED RUN · Lange Tights","es":"SPEED RUN · Mallas largas"}'::jsonb, 'bottom', 'women', false, '["XXS","XS","S","M","L","XL","XXL"]'::jsonb, '[{"min":10,"price":43.9},{"min":30,"price":42.1},{"min":60,"price":40.9}]'::jsonb, true, 30, 'img/products/running/W2913.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 108). Catalogo pag. 20.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7120', '{"it":"SPEED RUN · T-shirt manica corta girocollo","en":"SPEED RUN · Short-sleeve crew-neck T-shirt","fr":"SPEED RUN · T-shirt manches courtes col rond","de":"SPEED RUN · Kurzarm-T-Shirt Rundhals","es":"SPEED RUN · Camiseta manga corta cuello redondo"}'::jsonb, 'top', 'unisex', true, '["128","140","152","164"]'::jsonb, '[{"min":10,"price":31.6},{"min":30,"price":30.1},{"min":60,"price":29}]'::jsonb, true, 31, 'img/products/running/W7120.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 120). Catalogo pag. 23.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W7121', '{"it":"SPEED RUN · Canotta","en":"SPEED RUN · Singlet","fr":"SPEED RUN · Débardeur","de":"SPEED RUN · Singlet","es":"SPEED RUN · Camiseta de tirantes"}'::jsonb, 'top', 'unisex', true, '["128","140","152","164"]'::jsonb, '[]'::jsonb, true, 32, 'img/products/running/W7121.jpg', 'Catalogo pag. 23.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('running', 'W2948', '{"it":"SPEED RUN · Pantaloncini elasticizzati","en":"SPEED RUN · Stretch shorts","fr":"SPEED RUN · Short élastique","de":"SPEED RUN · Elastische Shorts","es":"SPEED RUN · Pantalón corto elástico"}'::jsonb, 'bottom', 'unisex', true, '["128","140","152","164"]'::jsonb, '[{"min":10,"price":30.3},{"min":30,"price":29.1},{"min":60,"price":28.3}]'::jsonb, true, 33, 'img/products/running/W2948.jpg', 'Prezzi dal listino Excel Team Running 2027 (riga 122). Catalogo pag. 24.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('triathlon', 'W7000', '{"it":"EXTREME EVO · Body manica corta con zip divisibile","en":"EXTREME EVO · Short-sleeve suit with full-length zip","fr":"EXTREME EVO · Trifonction manches courtes zip intégral","de":"EXTREME EVO · Einteiler kurzarm mit durchgehendem Reißverschluss","es":"EXTREME EVO · Mono manga corta con cremallera completa"}'::jsonb, 'body', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL"]'::jsonb, '[]'::jsonb, true, 1, 'img/products/triathlon/W7000.jpg', 'Catalogo pag. 5.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('triathlon', 'W7006', '{"it":"EXTREME EVO · Body manica corta con zip corta","en":"EXTREME EVO · Short-sleeve suit with short zip","fr":"EXTREME EVO · Trifonction manches courtes zip court","de":"EXTREME EVO · Einteiler kurzarm mit kurzem Reißverschluss","es":"EXTREME EVO · Mono manga corta con cremallera corta"}'::jsonb, 'body', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL"]'::jsonb, '[]'::jsonb, true, 2, 'img/products/triathlon/W7006.jpg', 'Catalogo pag. 6.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('triathlon', 'W7002', '{"it":"EXTREME EVO · Body triathlon senza maniche con zip corta","en":"EXTREME EVO · Sleeveless triathlon suit with short zip","fr":"EXTREME EVO · Trifonction sans manches zip court","de":"EXTREME EVO · Ärmelloser Triathlon-Einteiler mit kurzem Reißverschluss","es":"EXTREME EVO · Mono de triatlón sin mangas con cremallera corta"}'::jsonb, 'body', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL"]'::jsonb, '[]'::jsonb, true, 3, 'img/products/triathlon/W7002.jpg', 'Catalogo pag. 7.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('triathlon', 'W7004', '{"it":"HYDRO · Body senza maniche con zip posteriore","en":"HYDRO · Sleeveless suit with back zip","fr":"HYDRO · Trifonction sans manches zip dans le dos","de":"HYDRO · Ärmelloser Einteiler mit Rückenreißverschluss","es":"HYDRO · Mono sin mangas con cremallera trasera"}'::jsonb, 'body', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL"]'::jsonb, '[]'::jsonb, true, 4, 'img/products/triathlon/W7004.jpg', 'Catalogo pag. 8.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('triathlon', 'W7014', '{"it":"FLEX PULSE TRI · Top","en":"FLEX PULSE TRI · Top","fr":"FLEX PULSE TRI · Top","de":"FLEX PULSE TRI · Top","es":"FLEX PULSE TRI · Top"}'::jsonb, 'top', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL"]'::jsonb, '[]'::jsonb, true, 5, 'img/products/triathlon/W7014.jpg', 'Catalogo pag. 9.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('triathlon', 'W7012', '{"it":"FLEX PULSE TRI · Shorts","en":"FLEX PULSE TRI · Shorts","fr":"FLEX PULSE TRI · Short","de":"FLEX PULSE TRI · Shorts","es":"FLEX PULSE TRI · Pantalón corto"}'::jsonb, 'bottom', 'men', false, '["XXS","XS","S","M","L","XL","XXL","3XL"]'::jsonb, '[]'::jsonb, true, 6, 'img/products/triathlon/W7012.jpg', 'Catalogo pag. 10.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('triathlon', 'W7001', '{"it":"EXTREME EVO · Body manica corta con zip divisibile","en":"EXTREME EVO · Short-sleeve suit with full-length zip","fr":"EXTREME EVO · Trifonction manches courtes zip intégral","de":"EXTREME EVO · Einteiler kurzarm mit durchgehendem Reißverschluss","es":"EXTREME EVO · Mono manga corta con cremallera completa"}'::jsonb, 'body', 'women', false, '["XS","S","M","L","XL"]'::jsonb, '[]'::jsonb, true, 7, 'img/products/triathlon/W7001.jpg', 'Catalogo pag. 13.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('triathlon', 'W7007', '{"it":"EXTREME EVO · Body manica corta con zip corta","en":"EXTREME EVO · Short-sleeve suit with short zip","fr":"EXTREME EVO · Trifonction manches courtes zip court","de":"EXTREME EVO · Einteiler kurzarm mit kurzem Reißverschluss","es":"EXTREME EVO · Mono manga corta con cremallera corta"}'::jsonb, 'body', 'women', false, '["XS","S","M","L","XL"]'::jsonb, '[]'::jsonb, true, 8, 'img/products/triathlon/W7007.jpg', 'Catalogo pag. 14.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('triathlon', 'W7003', '{"it":"EXTREME EVO · Body triathlon senza maniche con zip corta","en":"EXTREME EVO · Sleeveless triathlon suit with short zip","fr":"EXTREME EVO · Trifonction sans manches zip court","de":"EXTREME EVO · Ärmelloser Triathlon-Einteiler mit kurzem Reißverschluss","es":"EXTREME EVO · Mono de triatlón sin mangas con cremallera corta"}'::jsonb, 'body', 'women', false, '["XS","S","M","L","XL"]'::jsonb, '[]'::jsonb, true, 9, 'img/products/triathlon/W7003.jpg', 'Catalogo pag. 15.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('triathlon', 'W7005', '{"it":"HYDRO · Body senza maniche con zip posteriore","en":"HYDRO · Sleeveless suit with back zip","fr":"HYDRO · Trifonction sans manches zip dans le dos","de":"HYDRO · Ärmelloser Einteiler mit Rückenreißverschluss","es":"HYDRO · Mono sin mangas con cremallera trasera"}'::jsonb, 'body', 'women', false, '["XS","S","M","L","XL"]'::jsonb, '[]'::jsonb, true, 10, 'img/products/triathlon/W7005.jpg', 'Catalogo pag. 16.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('triathlon', 'W7019', '{"it":"FLEX PULSE TRI · Top","en":"FLEX PULSE TRI · Top","fr":"FLEX PULSE TRI · Top","de":"FLEX PULSE TRI · Top","es":"FLEX PULSE TRI · Top"}'::jsonb, 'top', 'women', false, '["XS","S","M","L","XL"]'::jsonb, '[]'::jsonb, true, 11, 'img/products/triathlon/W7019.jpg', 'Catalogo pag. 17.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('triathlon', 'W7020', '{"it":"FLEX PULSE TRI · Shorts","en":"FLEX PULSE TRI · Shorts","fr":"FLEX PULSE TRI · Short","de":"FLEX PULSE TRI · Shorts","es":"FLEX PULSE TRI · Pantalón corto"}'::jsonb, 'bottom', 'women', false, '["XS","S","M","L","XL"]'::jsonb, '[]'::jsonb, true, 12, 'img/products/triathlon/W7020.jpg', 'Catalogo pag. 18.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('triathlon', 'W7016', '{"it":"ARONA · Costume maniche corte","en":"ARONA · Short-sleeve swimsuit","fr":"ARONA · Maillot de bain manches courtes","de":"ARONA · Badeanzug kurzarm","es":"ARONA · Bañador manga corta"}'::jsonb, 'body', 'women', false, '["XS","S","M","L","XL"]'::jsonb, '[]'::jsonb, true, 13, 'img/products/triathlon/W7016.jpg', 'Catalogo pag. 19.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('triathlon', 'W7017', '{"it":"ARONA · Costume senza maniche","en":"ARONA · Sleeveless swimsuit","fr":"ARONA · Maillot de bain sans manches","de":"ARONA · Ärmelloser Badeanzug","es":"ARONA · Bañador sin mangas"}'::jsonb, 'body', 'women', false, '["XS","S","M","L","XL"]'::jsonb, '[]'::jsonb, true, 14, 'img/products/triathlon/W7017.jpg', 'Catalogo pag. 20.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('triathlon', 'W7018', '{"it":"HYDRO O-BACK · Body triathlon","en":"HYDRO O-BACK · Triathlon suit","fr":"HYDRO O-BACK · Trifonction","de":"HYDRO O-BACK · Triathlon-Einteiler","es":"HYDRO O-BACK · Mono de triatlón"}'::jsonb, 'body', 'women', false, '["XS","S","M","L","XL"]'::jsonb, '[]'::jsonb, true, 15, 'img/products/triathlon/W7018.jpg', 'Catalogo pag. 21.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('speed_skating', 'W7802', '{"it":"SPEED PRO · Body pattinaggio velocità manica corta","en":"SPEED PRO · Short-sleeve speed skating suit","fr":"SPEED PRO · Combinaison patinage de vitesse manches courtes","de":"SPEED PRO · Speedskating-Einteiler kurzarm","es":"SPEED PRO · Mono de patinaje de velocidad manga corta"}'::jsonb, 'body', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 1, 'img/products/speed_skating/W7802.jpg', 'Catalogo pag. 4.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('speed_skating', 'W7810', '{"it":"AEROFLOW · Body pattinaggio velocità manica corta","en":"AEROFLOW · Short-sleeve speed skating suit","fr":"AEROFLOW · Combinaison patinage de vitesse manches courtes","de":"AEROFLOW · Speedskating-Einteiler kurzarm","es":"AEROFLOW · Mono de patinaje de velocidad manga corta"}'::jsonb, 'body', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 2, 'img/products/speed_skating/W7810.jpg', 'Catalogo pag. 5.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('speed_skating', 'W7811', '{"it":"GLIDEPRO · Body pattinaggio velocità manica corta","en":"GLIDEPRO · Short-sleeve speed skating suit","fr":"GLIDEPRO · Combinaison patinage de vitesse manches courtes","de":"GLIDEPRO · Speedskating-Einteiler kurzarm","es":"GLIDEPRO · Mono de patinaje de velocidad manga corta"}'::jsonb, 'body', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 3, 'img/products/speed_skating/W7811.jpg', 'Catalogo pag. 6.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('speed_skating', 'W7807', '{"it":"COMP · Body pattinaggio velocità manica corta","en":"COMP · Short-sleeve speed skating suit","fr":"COMP · Combinaison patinage de vitesse manches courtes","de":"COMP · Speedskating-Einteiler kurzarm","es":"COMP · Mono de patinaje de velocidad manga corta"}'::jsonb, 'body', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 4, 'img/products/speed_skating/W7807.jpg', 'Catalogo pag. 7.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('speed_skating', 'W7800', '{"it":"SPEED · Body pattinaggio velocità manica corta","en":"SPEED · Short-sleeve speed skating suit","fr":"SPEED · Combinaison patinage de vitesse manches courtes","de":"SPEED · Speedskating-Einteiler kurzarm","es":"SPEED · Mono de patinaje de velocidad manga corta"}'::jsonb, 'body', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 5, 'img/products/speed_skating/W7800.jpg', 'Catalogo pag. 8.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('speed_skating', 'W7804', '{"it":"PISTA · Pantaloni da riscaldamento invernali","en":"PISTA · Winter warm-up trousers","fr":"PISTA · Pantalon d''échauffement hiver","de":"PISTA · Winter-Aufwärmhose","es":"PISTA · Pantalón de calentamiento de invierno"}'::jsonb, 'bottom', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 6, 'img/products/speed_skating/W7804.jpg', 'Catalogo pag. 9.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('speed_skating', 'W7803', '{"it":"SPRINT · Giacca antivento","en":"SPRINT · Windproof jacket","fr":"SPRINT · Veste coupe-vent","de":"SPRINT · Windjacke","es":"SPRINT · Chaqueta cortavientos"}'::jsonb, 'outer', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 7, 'img/products/speed_skating/W7803.jpg', 'Catalogo pag. 10.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('speed_skating', 'W7808', '{"it":"COMP · Body pattinaggio manica corta","en":"COMP · Short-sleeve skating suit","fr":"COMP · Combinaison patinage manches courtes","de":"COMP · Skating-Einteiler kurzarm","es":"COMP · Mono de patinaje manga corta"}'::jsonb, 'body', 'unisex', true, '["116","128","140","152","164"]'::jsonb, '[]'::jsonb, true, 8, 'img/products/speed_skating/W7808.jpg', 'Catalogo pag. 11.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('speed_skating', 'W7801', '{"it":"SPEED · Body pattinaggio manica corta","en":"SPEED · Short-sleeve skating suit","fr":"SPEED · Combinaison patinage manches courtes","de":"SPEED · Skating-Einteiler kurzarm","es":"SPEED · Mono de patinaje manga corta"}'::jsonb, 'body', 'unisex', true, '["116","128","140","152","164"]'::jsonb, '[]'::jsonb, true, 9, 'img/products/speed_skating/W7801.jpg', 'Catalogo pag. 12.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('speed_skating', 'W7806', '{"it":"PISTA · Pantaloni da riscaldamento","en":"PISTA · Warm-up trousers","fr":"PISTA · Pantalon d''échauffement","de":"PISTA · Aufwärmhose","es":"PISTA · Pantalón de calentamiento"}'::jsonb, 'bottom', 'unisex', true, '["116","128","140","152","164"]'::jsonb, '[]'::jsonb, true, 10, 'img/products/speed_skating/W7806.jpg', 'Catalogo pag. 13.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('speed_skating', 'W7805', '{"it":"SPRINT · Giacca antivento","en":"SPRINT · Windproof jacket","fr":"SPRINT · Veste coupe-vent","de":"SPRINT · Windjacke","es":"SPRINT · Chaqueta cortavientos"}'::jsonb, 'outer', 'unisex', true, '["116","128","140","152","164"]'::jsonb, '[]'::jsonb, true, 11, 'img/products/speed_skating/W7805.jpg', 'Catalogo pag. 14.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('rowing', 'W3620', '{"it":"ADIGE · Body smanicato","en":"ADIGE · Sleeveless rowing suit","fr":"ADIGE · Combinaison d''aviron sans manches","de":"ADIGE · Ärmelloser Ruderanzug","es":"ADIGE · Mono de remo sin mangas"}'::jsonb, 'body', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 1, 'img/products/rowing/W3620.jpg', 'Catalogo pag. 4.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('rowing', 'W7014', '{"it":"FLEX PULSE · Canottiera aderente","en":"FLEX PULSE · Fitted tank top","fr":"FLEX PULSE · Débardeur ajusté","de":"FLEX PULSE · Enges Tanktop","es":"FLEX PULSE · Camiseta de tirantes ajustada"}'::jsonb, 'top', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 2, 'img/products/rowing/W7014.jpg', 'Catalogo pag. 5.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('rowing', 'W3602', '{"it":"SILE · Pantaloncino senza bretelle","en":"SILE · Shorts without straps","fr":"SILE · Cuissard sans bretelles","de":"SILE · Shorts ohne Träger","es":"SILE · Pantalón corto sin tirantes"}'::jsonb, 'bottom', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 3, 'img/products/rowing/W3602.jpg', 'Catalogo pag. 6.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('rowing', 'W3630', '{"it":"TEVERE · Gilet invernale (tutto Windtex)","en":"TEVERE · Winter gilet (full Windtex)","fr":"TEVERE · Gilet hiver (entièrement Windtex)","de":"TEVERE · Winterweste (komplett Windtex)","es":"TEVERE · Chaleco de invierno (todo Windtex)"}'::jsonb, 'outer', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 4, 'img/products/rowing/W3630.jpg', 'Catalogo pag. 8.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('rowing', 'W3604', '{"it":"PIAVE · Gilet invernale (tutto Windtex)","en":"PIAVE · Winter gilet (full Windtex)","fr":"PIAVE · Gilet hiver (entièrement Windtex)","de":"PIAVE · Winterweste (komplett Windtex)","es":"PIAVE · Chaleco de invierno (todo Windtex)"}'::jsonb, 'outer', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 5, 'img/products/rowing/W3604.jpg', 'Catalogo pag. 9.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('rowing', 'W3631', '{"it":"TANARO · Gilet invernale (dietro Windtex, davanti Roubaix)","en":"TANARO · Winter gilet (Windtex back, Roubaix front)","fr":"TANARO · Gilet hiver (dos Windtex, devant Roubaix)","de":"TANARO · Winterweste (Rücken Windtex, Front Roubaix)","es":"TANARO · Chaleco de invierno (espalda Windtex, delantero Roubaix)"}'::jsonb, 'outer', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 6, 'img/products/rowing/W3631.jpg', 'Catalogo pag. 10.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('rowing', 'W3614', '{"it":"DESE · Gilet invernale (dietro Windtex, davanti Roubaix)","en":"DESE · Winter gilet (Windtex back, Roubaix front)","fr":"DESE · Gilet hiver (dos Windtex, devant Roubaix)","de":"DESE · Winterweste (Rücken Windtex, Front Roubaix)","es":"DESE · Chaleco de invierno (espalda Windtex, delantero Roubaix)"}'::jsonb, 'outer', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 7, 'img/products/rowing/W3614.jpg', 'Catalogo pag. 11.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('rowing', 'W3615', '{"it":"SENNA · Gilet estivo (antivento dietro, elastico davanti)","en":"SENNA · Summer gilet (windproof back, stretch front)","fr":"SENNA · Gilet été (dos coupe-vent, devant élastique)","de":"SENNA · Sommerweste (Rücken winddicht, Front elastisch)","es":"SENNA · Chaleco de verano (espalda cortavientos, delantero elástico)"}'::jsonb, 'outer', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 8, 'img/products/rowing/W3615.jpg', 'Catalogo pag. 12.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('rowing', 'W3601', '{"it":"LIVENZA · Maglia manica lunga","en":"LIVENZA · Long-sleeve top","fr":"LIVENZA · Maillot manches longues","de":"LIVENZA · Langarmshirt","es":"LIVENZA · Camiseta manga larga"}'::jsonb, 'top', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 9, 'img/products/rowing/W3601.jpg', 'Catalogo pag. 14.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('rowing', 'W3616', '{"it":"TAMIGI · Maglia manica lunga con zip corta","en":"TAMIGI · Long-sleeve top with short zip","fr":"TAMIGI · Maillot manches longues zip court","de":"TAMIGI · Langarmshirt mit kurzem Reißverschluss","es":"TAMIGI · Camiseta manga larga con cremallera corta"}'::jsonb, 'top', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 10, 'img/products/rowing/W3616.jpg', 'Catalogo pag. 15.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('rowing', 'W3617', '{"it":"DANUBIO · T-shirt manica lunga girocollo","en":"DANUBIO · Long-sleeve crew-neck T-shirt","fr":"DANUBIO · T-shirt manches longues col rond","de":"DANUBIO · Langarm-T-Shirt Rundhals","es":"DANUBIO · Camiseta manga larga cuello redondo"}'::jsonb, 'top', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 11, 'img/products/rowing/W3617.jpg', 'Catalogo pag. 16.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('rowing', 'W3618', '{"it":"SESIA · Calzamaglia","en":"SESIA · Tights","fr":"SESIA · Collant","de":"SESIA · Tights","es":"SESIA · Mallas"}'::jsonb, 'bottom', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 12, 'img/products/rowing/W3618.jpg', 'Catalogo pag. 17.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('rowing', 'W3625', '{"it":"ADIGE · Body smanicato","en":"ADIGE · Sleeveless rowing suit","fr":"ADIGE · Combinaison d''aviron sans manches","de":"ADIGE · Ärmelloser Ruderanzug","es":"ADIGE · Mono de remo sin mangas"}'::jsonb, 'body', 'unisex', true, '["116","128","140","152","164"]'::jsonb, '[]'::jsonb, true, 13, 'img/products/rowing/W3625.jpg', 'Catalogo pag. 18.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('rowing', 'W8000', '{"it":"WAVE · Maglia manica corta","en":"WAVE · Short-sleeve top","fr":"WAVE · Maillot manches courtes","de":"WAVE · Kurzarmshirt","es":"WAVE · Camiseta manga corta"}'::jsonb, 'top', 'unisex', false, '["XXS","XS","S","M","L","XL","XXL","3XL","4XL","5XL"]'::jsonb, '[]'::jsonb, true, 14, 'img/products/rowing/W8000.jpg', 'Catalogo pag. 20.') on conflict (sport_id, lower(sku)) do nothing;
insert into public.products (sport_id, sku, name, category, gender, kids, sizes, tiers, active, sort, image, notes) values ('rowing', 'W8001', '{"it":"WAVE · Maglia manica corta","en":"WAVE · Short-sleeve top","fr":"WAVE · Maillot manches courtes","de":"WAVE · Kurzarmshirt","es":"WAVE · Camiseta manga corta"}'::jsonb, 'top', 'unisex', true, '["116","128","140","152","164"]'::jsonb, '[]'::jsonb, true, 15, 'img/products/rowing/W8001.jpg', 'Catalogo pag. 21.') on conflict (sport_id, lower(sku)) do nothing;

update public.app_settings set data = data || '{"company_name":"Bicycle Line Srl","company_address":"Via F. Ferrara, 2–4\n31030 Dosson di Casier,\nTreviso, Italy","company_vat":"02027450267","company_email":"info@bicycle-line.com","company_phone":"+39 0422 490156","company_web":"www.bicycle-line.com","footer":"CF. P. IVA e Reg. Imp. IT 02027450267     R.E.A. di TV 182795     N. Mecc. TV 013516     Cap. Soc. € 100.000,00 i.v.","doc_place":"Casier (TV)","delivery_weeks":6,"order_prefix":"BL","validity_days":30}'::jsonb where id = 1 and coalesce(data->>'company_address', '') = '';
