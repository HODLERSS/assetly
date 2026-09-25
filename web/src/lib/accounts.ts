// Account names in ONE place. Three screens used to spell them out with their own ternaries, and
// the Position one fell through to "IRA" for crypto (launch audit, 2026-09-25).
import type { Account } from "./api";

export const ACCOUNTS: Account[] = ["brokerage", "bank", "401k", "ira", "crypto"];

const LABEL: Record<Account, string> = { brokerage: "Brokerage", bank: "Bank", "401k": "401k", ira: "IRA", crypto: "Crypto" };

/** "Brokerage", "Bank", "401k", "IRA", "Crypto"; an unknown value is shown as stored, never as another account. */
export function accountLabel(a: string): string {
  return (LABEL as Record<string, string>)[a] ?? a;
}

/** The quiet tag on a Home row: brokerage is the default and goes untagged. */
export function accountTag(a: string): string {
  return a === "brokerage" ? "" : accountLabel(a);
}

/** Where a fresh add starts. Cash and debt live at a bank; everything else in a brokerage. It is
 *  derived from what was picked, never carried over from the previous add. */
export function defaultAccount(kind: string): Account {
  return kind === "cash" || kind === "debt" ? "bank" : "brokerage";
}

export const isRetirement = (a: string) => a === "401k" || a === "ira";

/** The account a holding is shown in. A coin added by hand is filed under "brokerage" (the untagged
 *  default), and its detail said "Brokerage account" for a coin that is in no brokerage (r3 newcomer): it
 *  reads as Crypto. A coin the reader moved to an IRA says IRA; an imported one keeps its brokerage. */
export function shownAccount(r: { kind: string; account: string; source?: string | null }): string {
  return r.kind === "crypto" && r.account === "brokerage" && r.source !== "snaptrade" ? "crypto" : r.account;
}

/** The line under a position's price: "IRA account", "Crypto account", "Bank account". */
export function accountHeading(r: { kind: string; account: string; source?: string | null }): string {
  return `${accountLabel(shownAccount(r))} account`;
}
