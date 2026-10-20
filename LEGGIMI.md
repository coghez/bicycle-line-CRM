# Bicycle Line Studio — Richieste, clienti e guadagni

Gestionale interno di Bicycle Line: le richieste del sito, i clienti da ricontattare e quanto rendono le squadre. Per i 5 sport (ciclismo, running, triathlon, pattinaggio di velocità, canottaggio) restano i listini e il preventivo PDF.

La lavorazione degli ordini (grafica, bozzetti, task) si segue su **Trello**.

## Primo avvio (collegato a Supabase)
Il collegamento a Supabase è già impostato (stesso progetto e stessa chiave pubblica del CRM). Serve solo aggiornare il database **una volta**:
1. Apri Supabase → **SQL Editor** → *New query*.
2. Incolla **tutto** il file `supabase/ESEGUI_IN_SUPABASE.sql` e premi **Run**.
3. Apri `index.html` e accedi con la tua email e password di sempre.

Lo script tiene tutto quello che c'è già: richieste, utenti, storico, collegamento con Make (`make-ingest`) e funzione `invite-user`. Tu resti **amministratore**, e i collaboratori diventano **Ufficio**, quindi continuano a vedere tutte le richieste. Se si esegue due volte non fa danni.

Per provare senza toccare i dati veri apri `index.html?demo`: è una demo nel browser, con solo 4 richieste di esempio e nessun ordine finto.

## Le sezioni
- **Panoramica**:
  - **guadagni** del periodo, con il confronto col periodo precedente;
  - ordini chiusi e ordine medio;
  - richieste ricevute e quante sono diventate ordini;
  - clienti da ricontattare;
  - tabella **per agente** (cliccabile), fatturato per mese, richieste per stato, squadre che rendono di più, venduto per sport;
  - filtri per periodo, agente e sport; **CSV** per Excel.
- **Richieste**:
  - la bacheca come quella di prima, con 5 colonne: *Da rispondere → In trattativa → Preventivo inviato → In lavorazione → Completato*;
  - le richieste del **modulo del sito** arrivano da sole in *Da rispondere*, con un avviso;
  - con **Nuova richiesta** le aggiungi a mano;
  - trascini le schede per cambiare stato; cliccando una scheda si apre la sua scheda dettaglio.
- **Scheda richiesta**: dati della squadra, stato, assegnazione all'agente e note, più:
  - **Totale ordine (€, IVA esclusa)** e **Data ordine**: quando la squadra ordina scrivi il totale. Compare nella Panoramica e sulla scheda in bacheca (in verde, con la somma per colonna);
  - la **scheda cliente** si crea da sola (stesso nome = stesso cliente);
  - **Crea preventivo**: scegli i prodotti dal listino con le taglie, salvi e si apre il **PDF** con il layout Bicycle Line, in 5 lingue. Con *Usa come totale* copi l'imponibile del preventivo nel totale ordine;
  - **Commenti** con **@tag**: la persona taggata la ritrova in *Menzioni*.
- **Clienti**:
  - le squadre che hanno ordinato, con numero di ordini, totale speso e data dell'ultimo ordine;
  - un anno dopo l'ultimo ordine compaiono **Da ricontattare**: badge nel menu, scheda *Da ricontattare* e riquadro in Panoramica. Il periodo si cambia in *Impostazioni*;
  - con **Ricontattato oggi** il promemoria si sposta di un anno;
  - con **Nuova richiesta** riparti con un riordino.
- **Listini**: prodotti con foto e fasce di prezzo per sport.
- **Amministrazione**: prodotti e prezzi, regole commerciali, utenti e agenti, impostazioni (dati azienda per il PDF, mesi per il ricontatto).

## Ruoli
| Ruolo | Vede |
|---|---|
| **Amministratore** | tutto, compresi listini, prezzi, utenti e impostazioni |
| **Ufficio** | tutte le richieste e i clienti |
| **Agente** | solo le richieste assegnate a lui e i suoi clienti; la Panoramica mostra i suoi numeri |

## Listini e foto
Tutti i **151 articoli** dei 5 cataloghi (ciclismo 77, running 33, triathlon 15, canottaggio 15, pattinaggio 11) sono già caricati. Ognuno ha codice, nome in 5 lingue, linea uomo/donna/bambino, taglie e **foto** presa dal catalogo, in `img/products/`.
- **Running**: i prezzi vengono dal listino Excel Team Running 2027, collegati ai codici del catalogo (W7100, W7103…).
- **Altri sport**: gli articoli si vedono nei Listini con la foto, ma risultano "Prezzo da definire" e non si possono ordinare finché non inserisci i prezzi.

Per inserire i prezzi hai due strade:
- *Prodotti e prezzi → Modifica prezzi*: compili le fasce 10+ / 30+ / 60+ direttamente nella tabella;
- *Esporta* → compili il CSV in Excel → *Importa CSV*: le foto restano.

Nell'ordine, cliccando sulla foto la ingrandisci.

Per rigenerare foto e articoli da nuovi cataloghi PDF ci sono `tools/extract_catalog.py` e `tools/build_catalog.py`.

## Collegamento a Supabase
Vedi `supabase/LEGGIMI-SUPABASE.md`. In breve:
1. esegui `supabase/01_schema.sql` e poi `supabase/02_seed.sql`;
2. pubblica la funzione `supabase/functions/bl-invite-user`;
3. in `js/config.js` imposta `mode: 'supabase'`;
4. pubblica la cartella su un hosting (Netlify, Vercel, GitHub Pages…).

## Struttura
```
index.html            pagina unica
css/app.css           stile
js/config.js          demo / supabase
js/i18n.js            traduzioni (una riga per testo, 5 lingue)
js/pricing.js         motore prezzi (identico alla versione SQL)
js/catalog-data.js    151 articoli dai cataloghi (generato)
js/seed.js            sport, regole, dati demo
img/products/         foto prodotti per sport
img/brand/            logo BL e slogan
js/quote-pdf.js       preventivo PDF (layout Bicycle Line)
vendor/               jsPDF e pdf.js (inclusi, funzionano offline)
js/store-local.js     archivio demo nel browser
js/store-supabase.js  archivio Supabase
js/core.js            navigazione, layout, componenti
js/views/*.js         schermate (home = Panoramica, crm = Richieste e Clienti, editor = preventivo)
supabase/             migrazione, dati iniziali, funzione inviti
tests/                test permessi (RLS), commenti, totali e confronto prezzi JS ↔ SQL
```

## Regole da confermare
Le regole qui sotto sono riprese da ChatGPT/Excel e sono tutte modificabili da *Regole commerciali*:
- la fascia di prezzo si calcola **per articolo** (tutte le taglie e uomo+donna sommate);
- lo sconto sponsor si applica **in cascata** dopo lo sconto commerciale;
- l'impianto grafico è gratuito se la merce supera i 1.500 €;
- trasporto in base al paese del cliente: **Italia 15 €, UE 25 €, extra UE 25 €**, gratuito sopra i 3.000 € di imponibile.
