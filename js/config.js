/* CONFIGURAZIONE
 * mode: 'demo'     → tutto salvato nel browser, utenti dimostrativi (nessun dato inviato)
 * mode: 'supabase' → collegato al database aziendale (vedi supabase/LEGGIMI-SUPABASE.md)
 * La chiave "anon/publishable" è pubblica per natura: la sicurezza è garantita dalle regole RLS.
 * NON inserire MAI qui la service_role key.
 */
window.BL_CONFIG = {
  mode: 'supabase',
  supabaseUrl: 'https://qeitgtknjhliakqdclpm.supabase.co',
  supabaseAnonKey: 'sb_publishable_1aezvsFWESPr0D46SPmzXA_Cx8PohHc'
};
