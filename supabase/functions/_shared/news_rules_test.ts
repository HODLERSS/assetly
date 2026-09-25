// Run: npx -y deno@2 test supabase/functions/_shared/
// The shared vectors (news_cases.json) that the web port in web/src/lib/news.ts must also pass.
import { assertEquals } from "jsr:@std/assert@1";
import { aliasesFor, isJunkNews, publisherFor, usableNews } from "./news_rules.ts";

type Cases = {
  junk: { title: string; url: string; source: string; junk: boolean }[];
  usable: { symbol: string; name: string; name_kr?: string; title: string; url: string; source: string; summary?: string; usable: boolean }[];
  publisher: { url: string; source: string; publisher: string }[];
};
const cases = JSON.parse(await Deno.readTextFile(new URL("./news_cases.json", import.meta.url))) as Cases;

Deno.test("news rules: shared vectors (junk)", () => {
  for (const c of cases.junk) assertEquals(isJunkNews(c.title, c.url, c.source), c.junk, c.title);
});
Deno.test("news rules: shared vectors (read-time usability)", () => {
  for (const c of cases.usable) assertEquals(usableNews(c, aliasesFor(c.symbol, c.name, c.name_kr)), c.usable, `${c.symbol}: ${c.title}`);
});
Deno.test("news rules: shared vectors (publisher)", () => {
  for (const c of cases.publisher) assertEquals(publisherFor(c.url, c.source), c.publisher, c.url);
});
