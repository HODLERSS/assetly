// Spoken-number and spoken-word helpers shared by the narrate handler and its tests.
// r12 D: the card said +3.7% and the script said "up 4 percent": under 10% the card's one decimal is spoken (the same
// line roundEar draws for spelled-out figures); from 10% up the whole number carries it
export const roundPct = (v: number) => (Math.abs(v) < 1 ? v.toFixed(1) : Math.abs(v) < 10 ? v.toFixed(1).replace(/\.0$/, "") : String(Math.round(v)));
const MON_ABBR: Record<string, string> = { jan: "January", feb: "February", mar: "March", apr: "April", jun: "June", jul: "July", aug: "August", sep: "September", sept: "September", oct: "October", nov: "November", dec: "December" };
/** r12 D: marks a reader skims but a voice reads literally ("~Oct 28 (est)" was spoken as "tilde Oct 28 est"), and the
 *  possessive of a name ending in s ("Meta Platforms's"). Runs before the numbers and again after the names go in. */
export const earWords = (t: string) => String(t ?? "")
  .replace(/\s*\((?:est\.?|estimated|e)\)/gi, ", estimated")
  .replace(/(^|[\s(])~\s?(?=[$₩\d]|[A-Z][a-z]{2})/g, "$1around ")
  .replace(/\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?(?=\s+\d{1,2}\b)/g, (_m, a: string) => MON_ABBR[a.toLowerCase()] ?? a)
  .replace(/\b([A-Z][A-Za-z]*s)['’]s\b/g, "$1'")
  .replace(/,\s*estimated\s*([.,;])/g, ", estimated$1").replace(/,\s*,/g, ",");
