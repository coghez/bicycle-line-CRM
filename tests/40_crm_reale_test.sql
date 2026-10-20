\set AD '00000000-0000-0000-0000-00000000000a'
\set ST '00000000-0000-0000-0000-00000000000b'
\set A1 '00000000-0000-0000-0000-0000000000a1'
set role authenticated; select set_config('request.jwt.claim.sub', :'AD', false);
select 'S1 controllo schema (come il gestionale)', count(*) from (select order_total, order_date, client_id from requests limit 1) x;
select 'S2 clienti leggibili', count(*) from (select id, recontacted_at from clients limit 1) x;
select 'S3 admin vede richieste', count(*) from requests;
update profiles set role='agent' where id = :'A1';
select 'S4 admin cambia ruolo a un agente', role from profiles where id = :'A1';
insert into clients(name, owner_id) values ('Prova', :'AD');
update requests set order_total = 4200, order_date = '2025-09-20', client_id = (select id from clients where name='Prova') where team = 'Prova';
update requests set status = 'in_trattativa', assigned_to = :'A1' where team = 'Vecchia richiesta 1';
select 'S5 totale e stato (enum) salvati', team, status, order_total from requests where team in ('Prova','Vecchia richiesta 1') order by team;
select 'S6 storico del CRM ancora registrato', count(*) from request_events where event_type = 'updated';
insert into request_comments(request_id, text, mentions) select id, '@Agente Uno richiamali', array[:'A1']::uuid[] from requests where team = 'Vecchia richiesta 1';
insert into requests(team, contact_name, email, created_by, source) values ('Inserita a mano', 'Mario', 'm@x.it', :'AD', 'manual');
select 'S7 inserimento manuale ok', count(*) from requests where team = 'Inserita a mano';
select set_config('request.jwt.claim.sub', :'ST', false);
select 'S8 ex collaboratore (ora Ufficio) vede tutto', count(*) from requests;
select set_config('request.jwt.claim.sub', :'A1', false);
select 'S9 agente vede solo le sue + menzione', (select count(*) from requests), (select count(*) from bl_my_mentions());
reset role;
insert into requests(team, contact_name, email, source, external_id) values ('Da Make', 'X', 'x@y.it', 'make', 'msg-99');
select 'S10 richiesta da Make (service role) ok', status, order_total is null from requests where external_id = 'msg-99';
