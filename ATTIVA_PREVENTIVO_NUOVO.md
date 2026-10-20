# CRM Bicycle Line · Nuovo preventivatore ciclismo e TAGLIE

## Installazione (necessaria)
1. Esegui PRIMA `supabase/03_taglie.sql` se non l’hai già eseguito.
2. In Supabase SQL Editor esegui TUTTO `supabase/04_preventivi_ciclismo.sql` (nuova tabella e funzioni server).
3. Carica sul server **tutti i file e le cartelle dello ZIP**, mantenendo la struttura. Non basta caricare il solo index.html.
4. Ricarica il CRM con Ctrl+F5.

## Utilizzo
1. Apri una richiesta esistente.
2. Sopra il nome della squadra trovi **PREVENTIVO** e **TAGLIE**.
3. Apri PREVENTIVO: carica il file del preventivatore ciclismo allegato, con catalogo, condizioni e PDF.
4. Aggiungi articoli e quantità, clicca **Salva nella task** (in alto). Il salvataggio è in Supabase; il semplice download PDF non salva i dati.
5. Chiudi il preventivatore, clicca TAGLIE: il link personale è associato alla richiesta e mostra già gli articoli e le quantità ordinati.
6. Il destinatario distribuisce i capi per taglia, salva la bozza e conferma soltanto quando i totali coincidono.

## Importante
- I vecchi preventivi non vengono cancellati dal database; l'editor precedente non appare più nella scheda richiesta.
- Questo nuovo preventivatore è specifico per il **ciclismo**. Per running, triathlon e altri sport serviranno moduli/cataloghi specifici.
- Una task può contenere una versione corrente del nuovo preventivo; il salvataggio successivo la sostituisce. Non è ancora previsto uno storico delle revisioni.
- Il CRM espone i prodotti già selezionati al cliente; prezzo e costi rimangono nel solo preventivatore autenticato.
- Quando un preventivo viene salvato, le taglie ancora in bozza vengono ripristinate (si azzerano i quantitativi). Se le taglie sono già confermate, la modifica del preventivo viene bloccata, fino alla riapertura delle taglie.
- L'esportazione automatica nei campi dell'Excel TRI 2027 **non è ancora inclusa**: resta il CSV delle taglie.
- Il nuovo preventivatore mantiene la propria anteprima, genera PDF nel browser ed è incorporato nel CRM. Per funzionare serve Supabase attivo e la migrazione SQL indicata sopra.
- Le funzioni SQL sono state preparate e la sintassi JavaScript è stata controllata, ma le operazioni non sono state testate su un database Supabase reale.
