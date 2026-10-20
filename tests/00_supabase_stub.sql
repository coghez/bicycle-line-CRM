-- Simula l'ambiente Supabase (schema auth, ruoli) + il VECCHIO CRM, per testare la migrazione in locale.
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
grant usage on schema public to authenticated, anon;
create publication supabase_realtime;

-- vecchio CRM
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, email text, full_name text, role text default 'collaboratore' check (role in ('admin','collaboratore')), created_at timestamptz default now());
create function public.handle_new_user() returns trigger language plpgsql security definer as $$ begin insert into public.profiles(id,email,full_name) values (new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name','')); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create table public.requests (id uuid primary key default gen_random_uuid(), team text not null, contact_name text, sport text, email text, athletes text, phone text, message text, notes text, status text default 'da_rispondere', assigned_to uuid references public.profiles(id), created_by uuid, source text default 'website', created_at timestamptz default now());
create table public.request_events (id bigint generated always as identity primary key, request_id uuid references public.requests(id) on delete cascade, actor uuid, event_type text, detail jsonb, created_at timestamptz default now());
alter table public.profiles enable row level security; alter table public.requests enable row level security; alter table public.request_events enable row level security;
create policy "everyone reads profiles" on public.profiles for select to authenticated using (true);
create policy "crm all" on public.requests for all to authenticated using (true) with check (true);
create policy "website insert" on public.requests for insert to anon with check (true);
create policy "events read" on public.request_events for select to authenticated using (true);
grant select, insert, update, delete on public.requests to authenticated; grant insert on public.requests to anon;

insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','admin@bl.it','{"full_name":"Admin"}'),
 ('00000000-0000-0000-0000-00000000000b','ufficio@bl.it','{"full_name":"Ufficio"}'),
 ('00000000-0000-0000-0000-0000000000a1','agente1@bl.it','{"full_name":"Agente Uno"}'),
 ('00000000-0000-0000-0000-0000000000a2','agente2@bl.it','{"full_name":"Agente Due"}');
update public.profiles set role='admin' where email='admin@bl.it';
insert into public.requests(team,status) values ('Vecchia richiesta 1','da_rispondere'),('Vecchia richiesta 2','in_trattativa');

-- storage (semplificato)
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to authenticated; grant select, insert, delete on storage.objects to authenticated;
insert into auth.users(id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000d1','grafica@bl.it','{"full_name":"Grafica"}');
