import { assert } from "jsr:@std/assert@1";
import { isDemoEmail } from "./demo.ts";

Deno.test("demo accounts get no scheduled brief or TTS; real readers do", () => {
  for (const e of ["e2e-cloud@assetly.test", "minjae.m.lee+daily012@gmail.com", "minjae.m.lee+reviewer@gmail.com", "minjae.m.lee+showcase@gmail.com"]) assert(isDemoEmail(e), e);
  for (const e of ["minjae.m.lee@gmail.com", "someone@icloud.com", null]) assert(!isDemoEmail(e), String(e));
});
