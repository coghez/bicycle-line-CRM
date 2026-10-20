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
