insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','lorenzo.coghetto@gmail.com','{"full_name":"Lorenzo Coghetto"}'),
 ('00000000-0000-0000-0000-00000000000b','ufficio@bl.it','{"full_name":"Ufficio"}'),
 ('00000000-0000-0000-0000-0000000000a1','agente1@bl.it','{"full_name":"Agente Uno"}'),
 ('00000000-0000-0000-0000-0000000000a2','agente2@bl.it','{"full_name":"Agente Due"}');
update public.profiles set role='admin' where email='lorenzo.coghetto@gmail.com';
insert into public.requests(team, contact_name, sport, email, status, source, external_id, assigned_to) values
 ('lorenzo','Lorenzo Coghetto','triathlon','l@x.it','completato','make','msg-1',null),
 ('dcdffsd','Lorenzo Coghetto','atletica','l@x.it','completato','make','msg-2','00000000-0000-0000-0000-00000000000a'),
 ('Prova','Si','ciclismo','p@x.it','completato','manual',null,'00000000-0000-0000-0000-00000000000a'),
 ('Vecchia richiesta 1','A','ciclismo','a@x.it','da_rispondere','make','msg-3',null);
