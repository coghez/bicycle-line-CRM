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
