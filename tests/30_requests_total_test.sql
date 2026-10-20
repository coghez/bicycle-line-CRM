-- Richieste con totale ordine e clienti da ricontattare
\set ON_ERROR_STOP 0
\set A1 '00000000-0000-0000-0000-0000000000a1'
\set A2 '00000000-0000-0000-0000-0000000000a2'
\set AD '00000000-0000-0000-0000-00000000000a'
reset role;
set role anon;
insert into requests(team, sport, email, message) values ('Dal modulo del sito', 'Running', 'x@demo.it', 'Preventivo canotte');
reset role;
select 'R1 modulo del sito ancora funzionante (senza totale)', count(*), max(order_total) is null from requests where team = 'Dal modulo del sito';
set role authenticated;
select set_config('request.jwt.claim.sub', :'AD', false);
update profiles set role='agent' where id in (:'A1', :'A2');
update requests set assigned_to = :'A1' where team = 'Dal modulo del sito';
select set_config('request.jwt.claim.sub', :'A1', false);
insert into clients(name, owner_id) values ('Dal modulo del sito', :'A1');
update requests set order_total = 3250.50, order_date = '2026-10-15', status = 'completato', client_id = (select id from clients where name = 'Dal modulo del sito') where team = 'Dal modulo del sito';
select 'R2 agente salva totale sulla sua richiesta', order_total, order_date, status, client_id is not null from requests where team = 'Dal modulo del sito';
\echo '--- R3 totale negativo (atteso ERRORE)'
update requests set order_total = -5 where team = 'Dal modulo del sito';
update clients set recontacted_at = '2026-10-15' where name = 'Dal modulo del sito';
select 'R4 data ricontatto salvata', recontacted_at from clients where name = 'Dal modulo del sito';
select set_config('request.jwt.claim.sub', :'A2', false);
update requests set order_total = 1 where team = 'Dal modulo del sito';
select 'R5 A2 non vede né modifica (0 righe)', count(*) from requests where team = 'Dal modulo del sito';
reset role;
select 'R5b totale invariato', order_total from requests where team = 'Dal modulo del sito';
