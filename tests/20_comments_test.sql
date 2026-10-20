-- Commenti con @menzioni su ordini e richieste, file, non letti, nuovo flusso stati
\set ON_ERROR_STOP 0
\set A1 '00000000-0000-0000-0000-0000000000a1'
\set A2 '00000000-0000-0000-0000-0000000000a2'
\set AD '00000000-0000-0000-0000-00000000000a'
\set ST '00000000-0000-0000-0000-00000000000b'
set role authenticated;
select set_config('request.jwt.claim.sub', :'AD', false);
update profiles set role='agent' where id in (:'A1', :'A2');
\echo '--- C0 il ruolo grafico non esiste più (atteso ERRORE)'
update profiles set role='designer' where id = :'A2';
-- agente 1 crea cliente e ordine, lo invia
select set_config('request.jwt.claim.sub', :'A1', false);
insert into clients(name, owner_id) values ('Club Commenti', :'A1');
insert into orders(client_id, sport_id, lines, status) select c.id, 'running', jsonb_build_array(jsonb_build_object('product_id', p.id, 'group','M','size','M','qty',20)), 'submitted' from clients c, products p where c.name='Club Commenti' and p.sku='W7101';
\set QUIET on
select id as oid from orders where client_snapshot->>'name' = 'Club Commenti' \gset
\set QUIET off
-- A1 tagga ufficio, admin e A2 (che non vede l'ordine) e prova a firmarsi come admin
insert into order_messages(order_id, text, mentions, author) values (:'oid', '@Ufficio @Admin @Agente Due acconto in arrivo', array[:'ST', :'AD', :'A2', :'A1']::uuid[], :'AD');
select 'C1 menzioni filtrate (ufficio+admin, non A2 né sé stesso) e autore reale', array_length(mentions, 1), :'A2' = any(mentions), :'A1' = any(mentions), author = :'A1' from order_messages;
-- A2 non vede e non scrive
select set_config('request.jwt.claim.sub', :'A2', false);
select 'C2 A2: messaggi, menzioni, non letti', (select count(*) from order_messages), (select count(*) from bl_my_mentions()), (select count(*) from bl_unread_counts());
\echo '--- C3 A2 non scrive nell ordine altrui (atteso ERRORE RLS)'
insert into order_messages(order_id, text) values (:'oid', 'intruso');
-- ufficio: menzione non letta, poi letta
select set_config('request.jwt.claim.sub', :'ST', false);
select 'C4 ufficio: menzioni non lette', count(*) filter (where unread), max(kind), max(label) like 'BL-%Club Commenti' from bl_my_mentions();
select bl_mentions_seen();
select 'C5 dopo lettura', count(*) filter (where unread), count(*) from bl_my_mentions();
select 'C6 non letti chat ufficio', n from bl_unread_counts();
-- conferma e nuovo flusso: confermato -> produzione -> spedito; "design" non esiste più
select 'C7 conferma', status from bl_accept_order(:'oid', 400, '2026-10-14', '');
\echo '--- C8 stato design non valido (atteso ERRORE)'
select bl_set_order_status(:'oid', 'design', '');
select 'C9 produzione', status from bl_set_order_status(:'oid', 'production', '');
-- commenti sulle richieste
update requests set assigned_to = :'A1' where team = 'Vecchia richiesta 1';
insert into request_comments(request_id, text, mentions) select id, '@Agente Uno richiamali tu @Agente Due', array[:'A1', :'A2']::uuid[] from requests where team = 'Vecchia richiesta 1';
select 'C10 menzioni richiesta (solo A1)', mentions = array[:'A1']::uuid[] from request_comments;
\echo '--- C11 commento vuoto (atteso ERRORE)'
insert into request_comments(request_id, text) select id, '   ' from requests where team = 'Vecchia richiesta 1';
select set_config('request.jwt.claim.sub', :'A1', false);
select 'C12 A1 vede commento e menzione richiesta', (select count(*) from request_comments), (select count(*) from bl_my_mentions() where kind = 'request' and unread);
insert into request_comments(request_id, text) select id, 'Fatto, li ho chiamati' from requests where team = 'Vecchia richiesta 1';
select set_config('request.jwt.claim.sub', :'A2', false);
select 'C13 A2 non vede commenti richieste altrui', count(*) from request_comments;
\echo '--- C14 A2 non commenta richieste non sue (0 righe: non le vede)'
insert into request_comments(request_id, text) select id, 'x' from requests where team = 'Vecchia richiesta 1';
select 'C14b nessuna riga visibile per A2', count(*) from requests;
-- file: cartella per ordine
select set_config('request.jwt.claim.sub', :'A1', false);
insert into storage.objects(bucket_id, name) values ('order-files', :'oid' || '/logo.png');
select set_config('request.jwt.claim.sub', :'A2', false);
select 'C15 A2 non vede i file', count(*) from storage.objects;
\echo '--- C16 A2 non carica nella cartella altrui (atteso ERRORE RLS)'
insert into storage.objects(bucket_id, name) values ('order-files', :'oid' || '/x.png');
select set_config('request.jwt.claim.sub', :'ST', false);
select 'C17 ufficio vede il file', count(*) from storage.objects;
-- funzioni interne non richiamabili dal browser
\echo '--- C18 bl_user_sees_order non eseguibile (atteso ERRORE permessi)'
select bl_user_sees_order(:'A2', :'oid');
