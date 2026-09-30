import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Its own storage key: the admin session never mixes with a consumer-app session in the same browser.
export function adminClient(): SupabaseClient {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  return createClient(url, key, { auth: { storageKey: "assetly-admin-auth", flowType: "pkce", persistSession: true, detectSessionInUrl: true } });
}
