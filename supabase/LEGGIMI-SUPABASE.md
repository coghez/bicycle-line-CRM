# Collegare Bicycle Line Studio a Supabase

La migrazione è pensata per lo **stesso progetto Supabase del CRM attuale**. Mantiene le tabelle `profiles`, `requests` e `request_events` e ne aggiunge di nuove: `sports`, `products`, `app_settings`, `clients`, `orders`, `order_events`, `order_counters`, `order_messages` (commenti degli ordini), `request_comments` (commenti delle richieste) e `mention_reads`.

## 0. Prima di tutto
- Fai un **backup** da Supabase → Database → Backups.
- Controlla le policy attuali: SQL Editor → `select tablename, policyname, cmd, roles from pg_policies where schemaname='public';`

## 1. Cosa cambia per il CRM attuale
- Le richieste che hai già **restano tutte**, con gli stessi 5 stati. Alla tabella `requests` si aggiungono `order_total` (totale ordine, IVA esclusa), `order_date` e il collegamento al cliente; ai clienti si aggiunge `recontacted_at`.
- Il modulo del sito continua a inserire richieste come prima.
- Se avevi già eseguito la versione precedente dello script: gli utenti con ruolo **grafico** vengono disattivati e gli ordini in **Grafica in corso** tornano **Confermato**. I commenti già scritti restano.
- Il ruolo dei vecchi "collaboratori" (qualunque valore diverso da `admin`) diventa **`staff`** (= Ufficio), con gli stessi permessi di prima.
- Le vecchie policy di **lettura e modifica** su `profiles`, `requests` e `request_events` vengono sostituite, perché gli agenti devono vedere solo le richieste assegnate a loro.
- Le policy di **solo inserimento** restano: il modulo del sito che crea le richieste continua a funzionare.
- Se esiste già un trigger che crea il profilo alla registrazione, non viene toccato.

## 2. Eseguire lo script (SQL Editor)
Incolla tutto `ESEGUI_IN_SUPABASE.sql` (= `01_schema.sql` + `02_seed.sql`) e premi Run. È stato provato su una copia esatta del tuo `schema.sql` originale: i ruoli enum `crm_role` diventano testo (admin → admin, collaborator → staff), gli stati `crm_stage` restano come sono, le richieste in arrivo da Make e lo storico continuano a funzionare. Test: `tests/01_stub_crm_reale.sql` + il tuo schema + `tests/02_dati_crm_reale.sql` + `tests/40_crm_reale_test.sql`.

## 2b. Commenti, menzioni e file
Ordini e richieste hanno i commenti. Scrivendo **@nome** si tagga una persona, che la ritrova in *Menzioni*. Si possono taggare solo persone che vedono già quell'ordine o quella richiesta: ufficio, amministratori e l'agente collegato. Il database scarta gli altri tag.

Lo script crea il bucket privato **order-files** in Storage. Ogni file sta nella cartella che porta l'id del suo ordine, e lo può leggere solo chi vede quell'ordine. Ai link dei file serve un accesso valido: scadono dopo un'ora.

## 3. Funzione per gli inviti (facoltativo)
Se non pubblichi `bl-invite-user`, il gestionale usa la tua `invite-user` già attiva e poi imposta ruolo e lingua del nuovo utente.

Dalla cartella del progetto, con la [CLI Supabase](https://supabase.com/docs/guides/cli):
```
supabase functions deploy bl-invite-user --project-ref qeitgtknjhliakqdclpm
```
Poi, da Authentication → URL Configuration, aggiungi l'indirizzo dove pubblicherai il portale (es. `https://studio.bicycleline.it`) a **Site URL** e **Redirect URLs**.

La vecchia funzione `invite-user` del CRM resta com'è. La nuova si chiama `bl-invite-user` e gestisce ruolo e lingua.

## 4. Primo amministratore
Il tuo utente esistente diventa admin con questo comando (sostituisci l'email):
```sql
update public.profiles set role = 'admin' where email = 'tua@email.it';
```

## 5. Attivare il portale
`js/config.js` è già impostato su `mode: 'supabase'`, con l'URL e la chiave pubblica del CRM. Puoi aprire `index.html` anche con doppio clic e accedere con email e password. Per gli **inviti via email** e il reset della password, il link deve tornare a un indirizzo web: pubblica la cartella su un hosting statico in HTTPS (Netlify, Vercel…) e aggiungi quell'indirizzo in Authentication → URL Configuration.

Per provare senza toccare i dati veri: `index.html?demo`.

## Sicurezza: cosa garantisce il database (non il browser)
- Un agente legge e modifica **solo** i propri clienti e ordini, e solo le richieste assegnate a lui.
- Un agente modifica un ordine solo finché è **bozza**. Può solo inviarlo, non approvarlo né cambiarne gli altri stati.
- **Totali e prezzi vengono ricalcolati dal server** a ogni salvataggio, con `bl_compute_order`, che è identico a `js/pricing.js`. I totali inviati dal browser vengono ignorati.
- Cambiare lo stato di un ordine **non** ricalcola i prezzi: un aumento di listino non tocca gli ordini già confermati.
- Solo gli admin modificano prodotti, regole e impostazioni, e non si possono cambiare il ruolo da soli.
- Solo l'ufficio conferma gli ordini e registra l'acconto (`bl_accept_order`). L'agente non può né confermare né cambiare l'acconto.
- I commenti e i file di un ordine li vede solo chi vede l'ordine; quelli di una richiesta solo l'ufficio e l'agente a cui è assegnata.
- Bacheca e Andamento sono pagine per gli amministratori: leggono gli stessi dati che l'ufficio vede già.
- La chiave in `config.js` è quella pubblica (anon/publishable). **Non inserire mai la service_role key nel sito.**

## Test eseguiti
Gli script in `tests/` sono stati eseguiti su un PostgreSQL 16 locale che simula Supabase e il vecchio CRM. Risultati:
- **migrazione**: eseguita due volte di seguito senza errori;
- **permessi (RLS)**: 15 controlli superati, tra cui agente che prova a diventare admin, agente che ordina per un cliente altrui, totali manomessi, modifica dopo l'invio e modulo del sito ancora attivo;
- **totali delle richieste** (`tests/30_requests_total_test.sql`): il modulo del sito inserisce ancora senza problemi; un agente salva il totale solo sulle sue richieste; i totali negativi sono rifiutati.
- **prezzi**: 400 ordini casuali calcolati sia in JavaScript sia in SQL, **0 differenze**.
- **commenti e menzioni** (`tests/20_comments_test.sql`): 18 controlli superati. Tra questi: non si può taggare chi non vede l'ordine, l'autore di un commento non si può falsificare, un agente non legge né scrive nei commenti di ordini e richieste altrui, i file sono protetti per ordine, le menzioni non lette si azzerano, lo stato «Grafica in corso» e il ruolo «grafico» non sono più accettati.

Prima di andare in produzione, ripeti un ordine di prova con un utente agente vero.
