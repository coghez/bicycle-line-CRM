# Aggiornamento v14 – numero preventivo automatico

Novità v14
- Al primo salvataggio (Salva nella task o Scarica PDF) il preventivo riceve da solo il numero: 01.26, 02.26, 03.26… Dal 1° gennaio 2027 riparte da 01.27.
- Un numero per task: se modifichi e risalvi il preventivo della stessa task, il numero resta uguale. Il numero compare nel PDF.
- Se scrivi tu un numero a mano nel campo, viene usato il tuo.
- Attivazione, una volta sola: entrando come amministratore compare in basso a sinistra il riquadro «Numero preventivo automatico». Premi Copia script → Apri Supabase → incolla e premi Run → Fatto. (Lo script è anche in supabase/05_numero_preventivi.sql.)
- Finché non è attivato, i preventivi si salvano normalmente, solo senza numero.

# v13 – prezzi 2027 automatici

Novità v13
- I prezzi del listino TEAM 2027 si scrivono da soli nei Prodotti: al primo accesso di un amministratore dopo l'aggiornamento il CRM aggiorna tutti i prodotti (circa 110) e mostra «Prezzi listino TEAM 2027 applicati». Non serve premere nulla.
- Lo fa una sola volta: se dopo cambi a mano un prezzo nei Prodotti, la tua modifica resta.
- Il pulsante «Controlla e allinea» resta solo come riserva, se l'aggiornamento automatico non riuscisse.

# v12 – nuovo preventivatore e prezzi 2027 nei Prodotti

Cosa cambia
- PREVENTIVO nella task apre il nuovo preventivatore (preventivo.html) con tutti gli sport: ciclismo, triathlon, running, pattinaggio, canottaggio. Si apre già sullo sport della richiesta, con squadra, referente, email e telefono compilati.
- Salva nella task / Scarica PDF funzionano come prima: totale nella task + prodotti nel link TAGLIE.
- I prezzi del preventivatore sono stati verificati uno per uno sui listini Excel 2027 (ciclismo, running, triathlon, pattinaggio): 105 gruppi di prezzo, 141 codici, supplementi compresi. Nessuna differenza.
- Amministrazione → Prodotti e prezzi: in alto compare «Listino TEAM 2027 – Controlla e allinea». Un clic mostra i prodotti da aggiornare, un secondo clic li aggiorna (fasce 10+ / 30+ / 60+, calze 150+). Aggiunge anche 7 articoli presenti nei listini ma mancanti nel CRM (W6053, W6030, W6549, W6522, W6310, W2921, W2941). Nelle note di ogni prodotto trovi riga del listino e supplementi.
- Da qui in poi la fonte dei prezzi è la sezione Prodotti: se cambi un prezzo nel CRM, il preventivatore aperto dalla task usa il nuovo prezzo.

Installazione
1. Carica sul server tutti i file dello ZIP (il vecchio preventivo.html non serve più).
2. Ctrl+F5 sul CRM.
3. Accedi come amministratore e attendi il messaggio «Prezzi listino TEAM 2027 applicati» (pochi secondi).

Note
- Canottaggio: nei listini non ci sono ancora prezzi, quindi resta «prezzo da definire».
- W6541 (APEX giacca invernale) e W2960 (SPEED RUN fuseaux 3/4) sono nel CRM ma non nei listini 2027: restano senza prezzo.
