import { createClient } from "@supabase/supabase-js";
// Local supabase-start defaults (the CLI's public demo keys) keep dev zero-config;
// production values come from Vite env at build time.
const url = import.meta.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321";
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
export const supabase = createClient(url, anon, {
    auth: { persistSession: true, autoRefreshToken: true },
});
export function signInWithOAuth(provider) {
    return supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
    });
}
export function signInWithEmail(email) {
    return supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });
}
