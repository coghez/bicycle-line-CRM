# Correzione v7 – salvataggio CRM / PDF

- Nel preventivatore aperto dalla task, **Scarica PDF** prima salva e verifica il preventivo su Supabase; se il salvataggio fallisce, il PDF NON viene scaricato e compare l’errore.
- **Salva nella task** attende la conferma positiva del CRM prima di dichiarare successo.
- Solo nella modalità standalone il PDF si scarica direttamente, senza salvataggio CRM.
- Chiusura preventivatore: ricarica dal database la lista delle richieste e il totale.
- I prodotti del modulo TAGLIE vengono scritti insieme al preventivo dalla funzione SQL `bl_cycling_quote_manage` dello script `supabase/04_preventivi_ciclismo.sql`.

## Installazione
Sostituisci sul server i file del CRM con questa versione; verifica che `03_taglie.sql` e `04_preventivi_ciclismo.sql` siano stati eseguiti nel progetto Supabase corretto. Svuota cache con Ctrl+F5. Crea una prova con 1 prodotto, clicca **Scarica PDF**: deve dire 'Preventivo e prodotti salvati su Supabase'. Chiudi e riapri la task, poi TAGLIE.

Non è stato eseguito un test sul Supabase aziendale: in caso di errore il messaggio ora è esplicito.
