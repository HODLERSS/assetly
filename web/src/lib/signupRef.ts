// First-touch campaign tag (owner 10/3): a visitor who arrives with ?ref=<tag> (the flyer's /get link sends
// ?ref=flyer-cafe) keeps the tag in this browser until they sign in, then it is saved once on their profile
// (set_signup_ref keeps the first tag only). No other data is stored.
import { supabase } from "./supabase";

const KEY = "assetly.signup_ref";
const OK = /^[a-z0-9-]{1,40}$/;

export function captureRef(search: string = typeof location !== "undefined" ? location.search : ""): string | null {
  const ref = new URLSearchParams(search).get("ref")?.toLowerCase() ?? null;
  if (!ref || !OK.test(ref)) return null;
  try { if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, ref); } catch { /* private mode: nothing to keep */ }
  return ref;
}

export async function claimRef(signedIn: boolean): Promise<void> {
  if (!signedIn) return;
  let ref: string | null = null;
  try { ref = localStorage.getItem(KEY); } catch { return; }
  if (!ref || !OK.test(ref)) return;
  const { error } = await supabase.rpc("set_signup_ref", { p_ref: ref });
  if (!error) { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
}
