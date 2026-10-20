# Modulo TAGLIE — Bicycle Line Studio

## Installazione (senza cancellare il CRM)
1. Prima di aggiornare il sito crea una copia di sicurezza dei file e del database.
2. In **Supabase → SQL Editor**, apri ed esegui **solo** `supabase/03_taglie.sql` (non ripetere gli script seed).
3. Pubblica sullo **stesso dominio** tutti i file dello ZIP, mantenendo le cartelle esistenti. Non spostare `taglie.html` in un'altra directory.
4. Aggiorna la pagina CRM nel browser, accedi e apri una task esistente.
5. Nella scheda **TAGLIE** premi **Apri TAGLIE**, poi **Copia link**. Invia il link all'agente o al cliente.
6. Quando arriva la conferma, lo stato **ricevuto** apparirà nella stessa scheda. Scarica il CSV per verificare taglie e quantità.

## Funzionamento
- Un modulo e un link univoco per ogni richiesta/task. Chiunque abbia il link può aprire e compilare le taglie senza account.
- L'agente può creare e copiare il link solo per le task assegnate; ufficio/admin per tutte le task.
- Il destinatario può aggiungere righe prodotto, codice, descrizione, versione e quantità per taglia.
- Il modulo consente il salvataggio di bozze sul database Supabase. Una volta confermato viene bloccato.
- Il personale può riaprire il modulo, oppure rigenerare il token (revocando il precedente).
- **Esportazione CSV** delle taglie, apribile in Excel, disponibile direttamente nella scheda CRM.
- Nessun prezzo o costo esposto sulla pagina pubblica.

## Limitazioni importanti
- Questo aggiornamento NON compila ancora automaticamente il modello Excel TRI 2027: genera un CSV di quantità per successiva verifica/inserimento nel listino. Per l'Excel esatto serve mappare i codici prodotto e le celle dell'originale, poi integrare un generatore lato server.
- Al momento i prodotti si aggiungono nel modulo anziché essere automaticamente preimpostati dal preventivo. Il flusso è indipendente dal preventivo, perché alcuni clienti fanno ordini senza preventivo nel CRM.
- Nessun invio email automatico: lo stato è salvato nel CRM ma per rilevarlo aggiornare/riaprire la scheda; eventuali notifiche vanno configurate separatamente.
- In modalità **demo**, il pulsante crea un link puramente dimostrativo: non trasferisce dati a Supabase e non è un link utilizzabile dai clienti. Testare i link veri in modalità Supabase dopo l'esecuzione dello SQL.
- La URL è una credenziale di accesso al modulo: non pubblicarla in siti pubblici, mailing list o canali aperti. Usare **Rigenera link** per revocarla.
- Sono consigliati controlli anti-abuso/rate-limiting a livello infrastrutturale se si distribuiscono molti link all'esterno.

## Prova di verifica
1. Apri task → TAGLIE → Apri TAGLIE e controlla che il link sia generato.
2. Apri il link in una finestra anonima senza login: aggiungi un prodotto e alcune taglie.
3. Salva la bozza, ricarica la pagina, verifica che le quantità siano presenti.
4. Conferma: verifica che i campi non siano più modificabili.
5. Apri di nuovo la task nel CRM: stato **ricevuto**, CSV esportabile.
6. **Riapri** e verifica che il link sia di nuovo modificabile; **Rigenera link** e verifica che il vecchio non funzioni più.

L'attivazione del database e la pubblicazione sul server devono essere eseguite sul progetto aziendale: i file consegnati, da soli, non modificano il server reale.
