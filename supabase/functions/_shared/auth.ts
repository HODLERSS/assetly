// Who is calling? A signed-in user's access token, verified the way the rest of the platform verifies it.
//
// Why not just auth.getUser(jwt): getUser asks GoTrue, which also checks that the token's SESSION still
// exists. Signing out anywhere (supabase-js signs out globally by default) deletes every session of that
// user while the access tokens already issued stay valid for up to an hour, and PostgREST, Storage and the
// function gateway keep accepting them. So a client could add positions (RLS accepted the token) and then
// get "not signed in" from brokerage-connected for the same token: every manual-add run in the 2026-09-25
// audit hit exactly that 401 (valid ES256 token, unexpired, session gone). getClaims verifies the signature
// against the project's JWKS and the expiry locally, which is the same bar every other endpoint applies;
// for legacy HS256 tokens it falls back to getUser by itself.

// deno-lint-ignore no-explicit-any
type Db = any;

export const bearerOf = (req: Request): string => (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

/** The user id behind a user access token, or null (no token, a key instead of a token, bad signature, expired). */
export async function userIdFrom(admin: Db, jwt: string): Promise<string | null> {
  if (!jwt || jwt.split(".").length !== 3) return null;   // the publishable key is not a JWT: nobody is signed in
  // round 9 v44: a transient JWKS fetch failure fell through to getUser, which refuses a token whose session was signed
  // out elsewhere (two audit sessions on one account): a valid token got a 401 and the app said "That didn't go
  // through". The local check is tried twice before the server check.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data } = await admin.auth.getClaims(jwt);
      const c = data?.claims as { sub?: unknown; role?: unknown } | undefined;
      if (c && typeof c.sub === "string" && c.role === "authenticated") return c.sub;
      if (c) return null;   // verified, but not a user token (anon / service role)
    } catch { /* retry, then fall through to the server check */ }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 150));
  }
  try {
    const { data } = await admin.auth.getUser(jwt);
    return data?.user?.id ?? null;
  } catch { return null; }
}
