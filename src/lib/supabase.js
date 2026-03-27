import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://qzwftcmgwlghpsuqelbe.supabase.co',
  'sb_publishable_gstMzCZIFVpoARL63RycLQ_TyaFteZS',
  { auth: { persistSession: true, autoRefreshToken: true } }
)
