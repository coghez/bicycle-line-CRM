-- TAGLIE | Eseguire una volta nel SQL Editor del progetto Supabase esistente.
create table if not exists public.bl_size_forms (
 request_id uuid primary key references public.requests(id) on delete cascade,
 token uuid not null unique default gen_random_uuid(),
 lines jsonb not null default '[]'::jsonb,
 status text not null default 'bozza' check (status in ('bozza','ricevuto')),
 updated_at timestamptz not null default now(), submitted_at timestamptz
);
create index if not exists bl_size_forms_token_idx on public.bl_size_forms(token);
alter table public.bl_size_forms enable row level security;
-- Nessun accesso diretto, nemmeno ai membri autenticati: solo funzioni controllate.
revoke all on public.bl_size_forms from anon, authenticated;

create or replace function public.bl_sizes_manage(p_request uuid, p_action text default 'get')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.requests%rowtype; f public.bl_size_forms%rowtype;
begin
 if auth.uid() is null or not public.bl_is_member() then raise exception 'Accesso negato'; end if;
 select * into r from public.requests where id=p_request;
 if not found then raise exception 'Richiesta inesistente'; end if;
 if not (public.bl_is_staff() or r.assigned_to=auth.uid()) then raise exception 'Accesso negato'; end if;
 if p_action='create' then
   insert into public.bl_size_forms(request_id) values(p_request) on conflict(request_id) do nothing;
 elsif p_action='reopen' then
   update public.bl_size_forms set status='bozza', submitted_at=null, updated_at=now() where request_id=p_request;
 elsif p_action='revoke' then
   update public.bl_size_forms set token=gen_random_uuid(), status='bozza', submitted_at=null, updated_at=now() where request_id=p_request;
 elsif p_action<>'get' then raise exception 'Operazione sconosciuta'; end if;
 select * into f from public.bl_size_forms where request_id=p_request;
 if not found then return null; end if;
 return jsonb_build_object('token',f.token,'status',f.status,'lines',f.lines,'updated_at',f.updated_at,'submitted_at',f.submitted_at);
end $$;

create or replace function public.bl_sizes_public_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare f public.bl_size_forms%rowtype; r public.requests%rowtype;
begin
 select * into f from public.bl_size_forms where token=p_token;
 if not found then raise exception 'Link non valido o revocato'; end if;
 select * into r from public.requests where id=f.request_id;
 return jsonb_build_object('team',r.team,'sport',r.sport,'status',f.status,'lines',f.lines,'submitted_at',f.submitted_at);
end $$;

create or replace function public.bl_sizes_public_save(p_token uuid, p_lines jsonb, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare f public.bl_size_forms%rowtype; ln jsonb; sz text; qty text; n int; tot int:=0;
begin
 select * into f from public.bl_size_forms where token=p_token for update;
 if not found then raise exception 'Link non valido o revocato'; end if;
 if f.status='ricevuto' then raise exception 'Taglie già confermate: contattare Bicycle Line'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)>100 then raise exception 'Elenco prodotti non valido'; end if;
 for ln in select value from jsonb_array_elements(p_lines) loop
   if jsonb_typeof(ln)<>'object' or length(coalesce(ln->>'product',''))>160 or length(coalesce(ln->>'sku',''))>80 or length(coalesce(ln->>'gender',''))>40 then raise exception 'Dati prodotto non validi'; end if;
   if jsonb_typeof(ln->'sizes')<>'object' then raise exception 'Taglie non valide'; end if;
   for sz, qty in select key, value from jsonb_each_text(ln->'sizes') loop
     if length(sz)>20 or qty !~ '^[0-9]{1,5}$' then raise exception 'Quantità non valida'; end if;
     n:=qty::int; if n>10000 then raise exception 'Quantità eccessiva'; end if;
     tot:=tot+n; if tot>100000 then raise exception 'Totale eccessivo'; end if;
   end loop;
 end loop;
 if p_submit and (jsonb_array_length(p_lines)=0 or tot=0) then raise exception 'Inserire almeno una quantità'; end if;
 update public.bl_size_forms set lines=p_lines,status=case when p_submit then 'ricevuto' else 'bozza' end,
   updated_at=now(), submitted_at=case when p_submit then now() else null end where token=p_token;
 return jsonb_build_object('status',case when p_submit then 'ricevuto' else 'bozza' end,'total',tot);
end $$;
revoke all on function public.bl_sizes_manage(uuid,text), public.bl_sizes_public_get(uuid), public.bl_sizes_public_save(uuid,jsonb,boolean) from public;
grant execute on function public.bl_sizes_manage(uuid,text) to authenticated;
grant execute on function public.bl_sizes_public_get(uuid),public.bl_sizes_public_save(uuid,jsonb,boolean) to anon,authenticated;
