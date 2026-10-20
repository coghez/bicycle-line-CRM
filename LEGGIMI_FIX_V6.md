# Versione 6 – verifica salvataggio preventivo

1. Il pulsante «Salva nella task» usa la funzione Supabase `bl_cycling_quote_manage` introdotta dal file `supabase/04_preventivi_ciclismo.sql`.
2. Ora, dopo il salvataggio, il CRM rilegge da Supabase il preventivo, le righe TAGLIE e `requests.order_total`. La notifica di successo appare **solo dopo** che i tre dati coincidono.
3. Se vedi «Errore CRM», copia il messaggio: segnala una migrazione mancante, un permesso o un problema reale di database.
4. Il modulo pubblico TAGLIE non mostra più campi liberi quando manca il preventivo; mostra il motivo e impedisce l'invio.
5. Il totale è il netto IVA esclusa del preventivatore; un preventivo NON implica automaticamente il pagamento, quindi verifica lo stato manualmente.

## Prova
Apri una task -> PREVENTIVO -> aggiungi articolo da catalogo e indica quantità -> **Salva nella task** -> attendi «Preventivo verificato su Supabase» -> chiudi -> apri nuovamente la task: deve apparire il totale -> TAGLIE -> Apri modulo: devono apparire le righe preventivate.

Non è stato possibile accedere al database aziendale reale in questa sessione. La verifica end-to-end reale richiede la migrazione SQL installata e un utente autenticato al CRM.
