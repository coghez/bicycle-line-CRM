/* Dati iniziali: sport, listino Running 2027, regole commerciali di default e dati demo. */
(function (root) {
  'use strict';
  const L = (it, en, fr, de, es) => ({ it, en, fr, de, es });

  const EXTRAS = [
    { id: 'logo_rebuild', name: L('Logo da ricostruire', 'Logo rebuild', 'Logo à reconstruire', 'Logo-Rekonstruktion', 'Reconstrucción de logo'), price: 30 },
    { id: 'extra_graphic', name: L('Grafica aggiuntiva', 'Additional artwork', 'Graphisme supplémentaire', 'Zusätzliche Grafik', 'Diseño adicional'), price: 50 },
    { id: 'print_proof', name: L('Prova stampa', 'Print proof', 'Épreuve d\'impression', 'Druckprobe', 'Prueba de impresión'), price: 50 },
    { id: 'line_change', name: L('Modifica linea', 'Line change', 'Modification de ligne', 'Linienänderung', 'Modificación de línea'), price: 50 }
  ];

  const baseRules = () => ({
    tier_basis: 'product',
    surcharge: {
      new: [{ max: 1, mult: 2 }, { max: 4, mult: 1.5 }, { max: 9, mult: 1.25 }],
      reorder: [{ max: 1, mult: 1.5 }, { max: 4, mult: 1.25 }]
    },
    setup_fee: { new: 150, modified: 80, reorder: 0 },
    setup_free_over: 1500,
    extras: JSON.parse(JSON.stringify(EXTRAS)),
    discount_mode: 'cascade',
    discount_options: [0, 5, 10, 15],
    sponsor_options: [0, 5, 10, 15],
    shipping: { it: 15, eu: 25, extra: 25 },
    free_shipping_over: 3000,
    vat: 22,
    deposit: 50
  });

  const SPORTS = [
    { id: 'cycling', name: L('Ciclismo', 'Cycling', 'Cyclisme', 'Radsport', 'Ciclismo'), code: 'CY', color: '#b3243a', season: '2027', sort: 1, active: true, rules: baseRules() },
    { id: 'running', name: L('Running', 'Running', 'Running', 'Laufen', 'Running'), code: 'RU', color: '#d9622b', season: '2027', sort: 2, active: true, rules: baseRules() },
    { id: 'triathlon', name: L('Triathlon', 'Triathlon', 'Triathlon', 'Triathlon', 'Triatlón'), code: 'TR', color: '#2f6db5', season: '2027', sort: 3, active: true, rules: baseRules() },
    { id: 'speed_skating', name: L('Pattinaggio di velocità', 'Speed skating', 'Patinage de vitesse', 'Eisschnelllauf / Speedskating', 'Patinaje de velocidad'), code: 'SK', color: '#6b4fbb', season: '2027', sort: 4, active: true, rules: baseRules() },
    { id: 'rowing', name: L('Canottaggio', 'Rowing', 'Aviron', 'Rudern', 'Remo'), code: 'RW', color: '#1f8a7a', season: '2027', sort: 5, active: true, rules: baseRules() }
  ];

  const SIZES_ADULT = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
  const SIZES_WOMEN = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
  const SIZES_JUNIOR = ['XS', 'S', 'M', 'L', 'XL'];

  // Prodotti e foto dai cataloghi PDF (js/catalog-data.js, generato da tools/build_catalog.py).
  // Running: prezzi dal listino Excel Team Running 2027. Altri sport: prezzi da caricare.
  const PRODUCTS = root.BLCatalog || [];

  const SETTINGS = {
    company_name: 'Bicycle Line Srl',
    company_address: 'Via F. Ferrara, 2–4\n31030 Dosson di Casier,\nTreviso, Italy',
    company_vat: '02027450267',
    company_email: 'info@bicycle-line.com',
    company_phone: '+39 0422 490156',
    company_web: 'www.bicycle-line.com',
    iban: '',
    footer: 'CF. P. IVA e Reg. Imp. IT 02027450267     R.E.A. di TV 182795     N. Mecc. TV 013516     Cap. Soc. € 100.000,00 i.v.',
    doc_place: 'Casier (TV)',
    delivery_weeks: 6,
    logo: '',
    order_prefix: 'BL',
    validity_days: 30
  };

  // ------- Dati DEMO (solo modalità demo) -------
  const USERS = [
    { id: 'u-admin', email: 'admin@demo.bl', full_name: 'Amministratore', role: 'admin', language: 'it', country: 'IT', active: true },
    { id: 'u-staff', email: 'ufficio@demo.bl', full_name: 'Ufficio commerciale', role: 'staff', language: 'it', country: 'IT', active: true },
    { id: 'u-agent-it', email: 'marco.rossi@demo.bl', full_name: 'Marco Rossi', role: 'agent', language: 'it', country: 'IT', active: true },
    { id: 'u-agent-de', email: 'hans.weber@demo.bl', full_name: 'Hans Weber', role: 'agent', language: 'de', country: 'DE', active: true },
    { id: 'u-agent-fr', email: 'claire.martin@demo.bl', full_name: 'Claire Martin', role: 'agent', language: 'fr', country: 'FR', active: true }
  ];

  const CLIENTS = [
    { id: 'c-1', owner_id: 'u-agent-it', name: 'Atletica Montebelluna', contact_name: 'Giulia Bianchi', email: 'info@atletica-demo.it', phone: '+39 0423 000000', vat_number: 'IT00000000001', country: 'IT', vat_regime: 'it', billing_address: 'Via Roma 1, 31044 Montebelluna (TV)', delivery_address: '', language: 'it', notes: '' },
    { id: 'c-2', owner_id: 'u-agent-it', name: 'Team Piave Runners', contact_name: 'Luca Verdi', email: 'team@piave-demo.it', phone: '', vat_number: '', country: 'IT', vat_regime: 'it', billing_address: 'Via Piave 22, 31100 Treviso (TV)', delivery_address: '', language: 'it', notes: '' },
    { id: 'c-3', owner_id: 'u-agent-de', name: 'LG Isar München', contact_name: 'Stefan Koch', email: 'kontakt@isar-demo.de', phone: '', vat_number: 'DE000000000', country: 'DE', vat_regime: 'eu_reverse', billing_address: 'Isarstraße 5, 80331 München', delivery_address: '', language: 'de', notes: '' },
    { id: 'c-4', owner_id: 'u-agent-fr', name: 'Club Aviron Lyon', contact_name: 'Julie Petit', email: 'contact@aviron-demo.fr', phone: '', vat_number: 'FR00000000000', country: 'FR', vat_regime: 'eu_reverse', billing_address: 'Quai Rambaud 3, 69002 Lyon', delivery_address: '', language: 'fr', notes: '' },
    { id: 'c-5', owner_id: 'u-agent-it', name: 'GS Marathon Conegliano', contact_name: 'Andrea Furlan', email: 'gs@conegliano-demo.it', phone: '', vat_number: 'IT00000000005', country: 'IT', vat_regime: 'it', billing_address: 'Viale Italia 40, 31015 Conegliano (TV)', delivery_address: '', language: 'it', notes: '' },
    { id: 'c-6', owner_id: 'u-agent-it', name: 'Runners Bassano', contact_name: 'Marta Zanin', email: 'info@bassano-demo.it', phone: '', vat_number: '', country: 'IT', vat_regime: 'it', billing_address: 'Via Verci 8, 36061 Bassano del Grappa (VI)', delivery_address: '', language: 'it', notes: '' },
    { id: 'c-7', owner_id: 'u-agent-de', name: 'TSV Laufteam Augsburg', contact_name: 'Lena Huber', email: 'lauf@augsburg-demo.de', phone: '', vat_number: 'DE000000007', country: 'DE', vat_regime: 'eu_reverse', billing_address: 'Maximilianstraße 12, 86150 Augsburg', delivery_address: '', language: 'de', notes: '' },
    { id: 'c-8', owner_id: 'u-agent-fr', name: 'AC Annecy Course', contact_name: 'Hugo Martin', email: 'contact@annecy-demo.fr', phone: '', vat_number: 'FR00000000008', country: 'FR', vat_regime: 'eu_reverse', billing_address: 'Rue Royale 2, 74000 Annecy', delivery_address: '', language: 'fr', notes: '' },
    { id: 'c-9', owner_id: 'u-agent-it', name: 'Podistica Vittorio Veneto', contact_name: 'Sergio Dal Col', email: 'podistica@vv-demo.it', phone: '', vat_number: 'IT00000000009', country: 'IT', vat_regime: 'it', billing_address: 'Piazza del Popolo 3, 31029 Vittorio Veneto (TV)', delivery_address: '', language: 'it', notes: '' }
  ];

  const REQUESTS = [
    { id: 'r-1', team: 'ASD Corsa Castelfranco', contact_name: 'Paolo Neri', sport: 'Running', email: 'paolo@demo.it', athletes: '35', phone: '+39 333 0000000', message: 'Vorremmo un preventivo per canotte e pantaloncini per la stagione 2027.', notes: '', status: 'da_rispondere', assigned_to: null, source: 'website', created_at: '2026-10-12T09:15:00Z' },
    { id: 'r-2', team: 'Triathlon Lagoon Venezia', contact_name: 'Sara Costa', sport: 'Triathlon', email: 'sara@demo.it', athletes: '20', phone: '', message: 'Body da gara con logo sponsor.', notes: 'Chiamata fatta, attende bozza.', status: 'in_trattativa', assigned_to: 'u-agent-it', source: 'website', created_at: '2026-10-08T15:40:00Z' },
    { id: 'r-3', team: 'RV Rheinland', contact_name: 'Jonas Becker', sport: 'Cycling', email: 'jonas@demo.de', athletes: '50', phone: '', message: 'Trikots und Trägerhosen für unseren Verein.', notes: '', status: 'preventivo_inviato', assigned_to: 'u-agent-de', source: 'website', created_at: '2026-10-01T11:00:00Z' },
    { id: 'r-4', team: 'Skating Club Padova', contact_name: 'Elena Galli', sport: 'Pattinaggio', email: 'elena@demo.it', athletes: '15', phone: '', message: 'Body da pattinaggio velocità.', notes: '', status: 'da_rispondere', assigned_to: null, source: 'website', created_at: '2026-10-13T18:22:00Z' }
  ];

  root.BLSeed = { SPORTS, PRODUCTS, SETTINGS, USERS, CLIENTS, REQUESTS, EXTRAS, baseRules, SIZES_ADULT, SIZES_WOMEN, SIZES_JUNIOR };
})(typeof window !== 'undefined' ? window : globalThis);
