# Aggiornamento v5 – totale e foto taglie

1. Carica **tutti** i file dello ZIP sul server, inclusa la cartella img/products/cycling e js/taglie-images.js.
2. Su Supabase, SQL Editor, esegui `supabase/04_preventivi_ciclismo.sql` aggiornato. Non cancella i preventivi esistenti.
3. Aggiorna con Ctrl+F5. Apri una task, clicca PREVENTIVO, salva con Salva nella task.
4. Alla conferma il CRM aggiorna il Totale ordine IVA esclusa e il database requests.order_total.
5. Clicca TAGLIE e Apri modulo. I prodotti sono caricati dalla task e le foto dal catalogo ciclismo sul server.

NOTA: Per i preventivi salvati prima della v5, riaprili e premi di nuovo Salva nella task per sincronizzare il totale. Foto presenti solo per gli SKU che hanno un JPEG nel catalogo locale; articoli senza immagine non generano una foto inventata.

Il sistema non è stato collaudato sul database Supabase dell'azienda. Fai un test completo con una task di prova.
