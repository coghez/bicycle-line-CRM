-- Eseguire DOPO 03_taglie.sql nel SQL Editor Supabase del CRM.
-- Conserva i vecchi preventivi; aggiunge il nuovo modello ciclismo collegato alla richiesta.
create table if not exists public.bl_cycling_quotes (
 request_id uuid primary key references public.requests(id) on delete cascade,
 quote jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id)
);
alter table public.bl_cycling_quotes enable row level security;
revoke all on public.bl_cycling_quotes from public, anon, authenticated;

create or replace function public.bl_cycling_quote_manage(p_request uuid, p_action text default 'get', p_quote jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.requests%rowtype; q public.bl_cycling_quotes%rowtype; item jsonb; entries jsonb='[]'::jsonb;
 code text; name_ text; gender_ text; count_ integer; line jsonb; f public.bl_size_forms%rowtype;
begin
 if auth.uid() is null or not public.bl_is_member() then raise exception 'Accesso negato'; end if;
 select * into r from public.requests where id=p_request;
 if not found then raise exception 'Richiesta inesistente'; end if;
 if not (public.bl_is_staff() or r.assigned_to=auth.uid()) then raise exception 'Accesso negato'; end if;
 if p_action='get' then
   select * into q from public.bl_cycling_quotes where request_id=p_request;
   if not found then return null; end if;
   return jsonb_build_object('quote',q.quote,'updated_at',q.updated_at);
 elsif p_action<>'save' then raise exception 'Azione sconosciuta'; end if;
 if p_quote is null or jsonb_typeof(p_quote)<>'object' or jsonb_typeof(p_quote->'items')<>'array'
    or jsonb_array_length(p_quote->'items')>100 or pg_column_size(p_quote)>1200000 then
   raise exception 'Preventivo non valido o troppo grande';
 end if;
 for item in select value from jsonb_array_elements(p_quote->'items') loop
   code:=left(trim(coalesce(item->>'code','')),80);
   name_:=left(trim(coalesce(item->>'name','')),160);
   gender_:=case when coalesce(item->>'audience','') in ('Uomo','Donna','Unisex','Bambino','Bambina') then item->>'audience'
           when lower(coalesce(item->>'name','')) like '%donna%' then 'Donna'
           when lower(coalesce(item->>'name','')) like '%uomo%' then 'Uomo'
           else 'Unisex' end;
   if coalesce(item->>'qty','') !~ '^[0-9]{1,5}$' then raise exception 'Quantità articolo non valida'; end if;
   count_:=(item->>'qty')::int;
   if code='' or name_='' or count_<1 or count_>10000 then raise exception 'Prodotto, codice o quantità mancanti'; end if;
   entries:=entries||jsonb_build_array(jsonb_build_object('sku',code,'product',name_,'gender',gender_,
     'expected',count_,'sizes','{}'::jsonb));
 end loop;
 if jsonb_array_length(entries)=0 then raise exception 'Aggiungi almeno un prodotto'; end if;
 if coalesce(p_quote->>'crmNet','') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' then raise exception 'Totale preventivo mancante o non valido'; end if;
 insert into public.bl_cycling_quotes(request_id,quote,updated_by)
 values(p_request,p_quote,auth.uid()) on conflict(request_id) do update
 set quote=excluded.quote,updated_by=excluded.updated_by,updated_at=now();
 -- Le taglie già confermate non vengono sovrascritte. Si richiede la riapertura prima di cambiare articoli.
 select * into f from public.bl_size_forms where request_id=p_request for update;
 if found and f.status='ricevuto' then raise exception 'Le taglie sono definitive: riaprile prima di modificare il preventivo'; end if;
 -- Mantieni le taglie già inserite se l'elenco e le quantità ordinate non cambiano.
 -- Se cambiano gli articoli, riparti da una nuova distribuzione soltanto se non confermata.
 if found and jsonb_array_length(f.lines)=jsonb_array_length(entries) and
    not exists (
      select 1 from jsonb_array_elements(f.lines) with ordinality oldline(value,idx)
      join jsonb_array_elements(entries) with ordinality newline(value,idx) using (idx)
      where oldline.value->>'sku' is distinct from newline.value->>'sku'
        or oldline.value->>'product' is distinct from newline.value->>'product'
        or oldline.value->>'gender' is distinct from newline.value->>'gender'
        or oldline.value->>'expected' is distinct from newline.value->>'expected'
    ) then
    entries := f.lines;
 end if;
 insert into public.bl_size_forms(request_id,lines) values(p_request,entries)
 on conflict(request_id) do update set lines=excluded.lines,updated_at=now();
 update public.requests set order_total=(p_quote->>'crmNet')::numeric,
   order_date=coalesce(order_date,current_date) where id=p_request;
 return jsonb_build_object('saved',true,'products',jsonb_array_length(entries));
end $$;
revoke all on function public.bl_cycling_quote_manage(uuid,text,jsonb) from public;
grant execute on function public.bl_cycling_quote_manage(uuid,text,jsonb) to authenticated;

-- Immutabilità dei prodotti: il link pubblico può compilare SOLO taglie di articoli già preventivati.
create or replace function public.bl_sizes_public_save(p_token uuid, p_lines jsonb, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.bl_size_forms%rowtype; current_line jsonb; provided jsonb;
 sz text; qty text; n integer; tot integer:=0; line_tot integer; i integer;
begin
 select * into f from public.bl_size_forms where token=p_token for update;
 if not found then raise exception 'Link non valido o revocato'; end if;
 if f.status='ricevuto' then raise exception 'Taglie già confermate: contattare Bicycle Line'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)>100 then raise exception 'Prodotti non validi'; end if;
 if exists(select 1 from public.bl_cycling_quotes where request_id=f.request_id) then
   if jsonb_array_length(p_lines)<>jsonb_array_length(f.lines) then raise exception 'Impossibile cambiare gli articoli'; end if;
   for i in 0..jsonb_array_length(f.lines)-1 loop
      current_line:=f.lines->i; provided:=p_lines->i;
      if current_line->>'sku' is distinct from provided->>'sku' or
         current_line->>'product' is distinct from provided->>'product' or
         current_line->>'gender' is distinct from provided->>'gender' or
         current_line->>'expected' is distinct from provided->>'expected' then
           raise exception 'Non puoi modificare i prodotti ordinati'; end if;
   end loop;
 end if;
 for provided in select value from jsonb_array_elements(p_lines) loop
   if jsonb_typeof(provided)<>'object' or length(coalesce(provided->>'product',''))>160 or length(coalesce(provided->>'sku',''))>80
      or length(coalesce(provided->>'gender',''))>40 or jsonb_typeof(provided->'sizes')<>'object' then raise exception 'Dati prodotto non validi'; end if;
   line_tot:=0;
   for sz, qty in select key,value from jsonb_each_text(provided->'sizes') loop
      if length(sz)>20 or qty !~ '^[0-9]{1,5}$' then raise exception 'Quantità non valida'; end if;
      n:=qty::int; if n>10000 then raise exception 'Quantità eccessiva'; end if;
      line_tot:=line_tot+n; tot:=tot+n; if tot>100000 then raise exception 'Totale eccessivo'; end if;
   end loop;
   if p_submit and provided ? 'expected' and line_tot<>(provided->>'expected')::integer then
      raise exception 'Distribuisci esattamente % pezzi per %',provided->>'expected',provided->>'product';
   end if;
 end loop;
 if p_submit and (jsonb_array_length(p_lines)=0 or tot=0) then raise exception 'Inserire almeno una quantità'; end if;
 update public.bl_size_forms set lines=p_lines,status=case when p_submit then 'ricevuto' else 'bozza' end,
   updated_at=now(),submitted_at=case when p_submit then now() else null end where token=p_token;
 return jsonb_build_object('status',case when p_submit then 'ricevuto' else 'bozza' end,'total',tot);
end $$;
revoke all on function public.bl_sizes_public_save(uuid,jsonb,boolean) from public;
grant execute on function public.bl_sizes_public_save(uuid,jsonb,boolean) to anon,authenticated;
