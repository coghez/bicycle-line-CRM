\set ON_ERROR_STOP 0
\set A1 '00000000-0000-0000-0000-0000000000a1'
\set A2 '00000000-0000-0000-0000-0000000000a2'
\set AD '00000000-0000-0000-0000-00000000000a'
\set ST '00000000-0000-0000-0000-00000000000b'
-- admin: promuove gli agenti
set role authenticated; select set_config('request.jwt.claim.sub', :'AD', false);
update profiles set role='agent', language='de' where id in (:'A1', :'A2');
select 'T1 ruoli', string_agg(role, ',' order by email) from profiles;
-- agente 1 prova a diventare admin
select set_config('request.jwt.claim.sub', :'A1', false);
update profiles set role='admin', full_name='Agente Uno bis' where id = :'A1';
select 'T2 agente non si promuove (atteso agent)', role, full_name from profiles where id = :'A1';
-- clienti
insert into clients(name, owner_id) values ('Club A1', :'A2');  -- prova a intestarlo ad altro agente
select set_config('request.jwt.claim.sub', :'A2', false);
insert into clients(name, owner_id, vat_regime) values ('Club A2', :'A2', 'eu_reverse');
select 'T3 A2 vede solo i suoi clienti', count(*), string_agg(name, ',') from clients;
select set_config('request.jwt.claim.sub', :'A1', false);
select 'T3b A1 owner forzato', name, owner_id = :'A1' from clients;
-- ordine su cliente altrui -> errore
\echo '--- T4 atteso ERRORE (cliente altrui):'
insert into orders(client_id, sport_id, lines) select c.id, 'running', '[{"product_id":"x","qty":1}]' from (select id from clients where name='Club A2') c;
\echo '--- T4b la riga non deve esistere perché A1 non vede Club A2 (0 righe inserite)'
-- ordine con totali manomessi
insert into orders(client_id, sport_id, order_type, lines, options, totals, status)
select c.id, 'running', 'new',
  jsonb_build_array(jsonb_build_object('product_id', p.id, 'group', 'M', 'size', 'M', 'qty', 12), jsonb_build_object('product_id', p.id, 'group', 'W', 'size', 'S', 'qty', 3)),
  '{"discount": 10, "sponsor": 5, "extras": {"logo_rebuild": 2}}', '{"total": 1}', 'draft'
from clients c, products p where c.name='Club A1' and p.sku='W7101';
select 'T5 numero e totali ricalcolati', number, totals->>'qty', totals->>'goods', totals->>'total', agent_id = :'A1' from orders;
-- agente prova a mettere approved
\echo '--- T6 atteso ERRORE (stato non consentito):'
update orders set status='approved';
update orders set status='submitted';
select 'T7 inviato', status, submitted_at is not null from orders;
\echo '--- T8 modifica dopo invio: 0 righe (RLS)'
update orders set notes='hack';
select 'T8 note invariate', notes from orders;
\echo '--- T9 agente non modifica prodotti: 0 righe'
update products set tiers='[{"min":1,"price":1}]' where sku='W7101';
select 'T9 prezzo invariato', tiers->0->>'price' from products where sku='W7101';
-- A2 non vede ordini di A1
select set_config('request.jwt.claim.sub', :'A2', false);
select 'T10 A2 vede ordini', count(*) from orders;
-- ufficio
select set_config('request.jwt.claim.sub', :'ST', false);
select 'T11 ufficio vede', (select count(*) from orders), (select count(*) from clients), (select count(*) from requests);
select 'T12 rpc stato', status from bl_set_order_status((select id from orders limit 1), 'approved', 'ok, va in produzione lunedì');
select 'T12b eventi', string_agg(type || coalesce(':' || (detail->>'note'), ''), ' | ' order by id) from order_events;
update requests set assigned_to = :'A1' where team='Vecchia richiesta 1';
select set_config('request.jwt.claim.sub', :'A1', false);
select 'T13 A1 richieste visibili', count(*), string_agg(team, ',') from requests;
select 'T13b eventi ordine visibili ad A1', count(*) from order_events;
reset role;
set role anon;
insert into requests(team, sport) values ('Dal sito', 'Running');
reset role;
select 'T14 modulo sito ok', count(*) from requests where team='Dal sito';
-- cambio prezzo non altera ordini già confermati
update products set tiers='[{"min":10,"price":99}]' where sku='W7101';
set role authenticated; select set_config('request.jwt.claim.sub', :'ST', false);
select 'T15 totale invariato dopo cambio stato', totals->>'total' from bl_set_order_status((select id from orders limit 1), 'production', '');
