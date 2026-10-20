# Aggiornamento TAGLIE v4

1. Sostituisci i file del CRM con quelli presenti nello ZIP, mantenendo la configurazione `js/config.js` del server.
2. In Supabase > SQL Editor, riesegui **solo** `supabase/04_preventivi_ciclismo.sql` (contiene CREATE OR REPLACE FUNCTION; non cancella preventivi). Lo script 03 deve essere già stato eseguito.
3. Aggiorna il sito con Ctrl+F5.
4. Apri una task, premi PREVENTIVO, aggiungi due prodotti con quantità distinte e scegli **Salva nella task**.
5. Premi TAGLIE > Apri modulo: codice, nome, genere e quantità devono essere precompilati, modificabili solo dal preventivo. Il cliente distribuisce soltanto le taglie e la somma deve corrispondere alla quantità preventivata.
6. Prova Salva bozza, riapri e verifica che le taglie rimangano. Modifica un prezzo del preventivo senza cambiare articoli e salva: le taglie devono rimanere.

ATTENZIONE: senza il database Supabase dell'azienda non è possibile provare l'intero flusso end-to-end. Non caricare `js/config.js` di esempio se sul server contiene già le credenziali corrette.
