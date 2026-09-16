#!/usr/bin/env node
// App Store Connect API helper. No secrets in the repo: the key lives in ~/.private_keys/AuthKey_<KEY_ID>.p8.
//   ASC_KEY_ID=… ASC_ISSUER_ID=… node scripts/asc.mjs get  /v1/apps
//   node scripts/asc.mjs post  /v1/bundleIds '{"data":{...}}'
//   node scripts/asc.mjs patch /v1/appInfos/<id> '{"data":{...}}'
//   node scripts/asc.mjs upload-screenshot <appScreenshotSetId> <file.png>
//   node scripts/asc.mjs upload-review-attachment <appStoreReviewDetailId> <file.mp4>
//   node scripts/asc.mjs wait-build <appId> <buildVersion>
// As a module: import { asc } from "./asc.mjs"; await asc("get", "/v1/apps")
import { readFileSync, statSync } from "fs";
import { createPrivateKey, sign, createHash } from "crypto";
import { homedir } from "os";

const KEY_ID = process.env.ASC_KEY_ID ?? "26G34JQ5XQ";
const ISSUER = process.env.ASC_ISSUER_ID ?? "03b49a0e-29cc-4d9d-94bc-a12aa1f92ec4";
const BASE = "https://api.appstoreconnect.apple.com";

function jwt() {
  const key = createPrivateKey(readFileSync(`${homedir()}/.private_keys/AuthKey_${KEY_ID}.p8`));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64({ alg: "ES256", kid: KEY_ID, typ: "JWT" }) + "." + b64({ iss: ISSUER, iat: now, exp: now + 900, aud: "appstoreconnect-v1" });
  return unsigned + "." + sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
}

/** One call. Returns { status, json }. Never throws on HTTP errors so callers can branch on 409s. */
export async function asc(method, path, body) {
  const r = await fetch(path.startsWith("http") ? path : BASE + path, {
    method: method.toUpperCase(),
    headers: { Authorization: "Bearer " + jwt(), "Content-Type": "application/json" },
    body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: r.status, json };
}

/** Screenshot upload: reserve, PUT the byte ranges Apple hands back, commit with the md5. */
export async function uploadScreenshot(setId, file) {
  const bytes = readFileSync(file); const size = statSync(file).size;
  const res = await asc("post", "/v1/appScreenshots", { data: { type: "appScreenshots", attributes: { fileName: file.split("/").pop(), fileSize: size }, relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } } } } });
  if (res.status >= 300) return res;
  const shot = res.json.data;
  for (const op of shot.attributes.uploadOperations) {
    const chunk = bytes.subarray(op.offset, op.offset + op.length);
    const h = Object.fromEntries((op.requestHeaders ?? []).map((x) => [x.name, x.value]));
    const put = await fetch(op.url, { method: op.method, headers: h, body: chunk });
    if (!put.ok) return { status: put.status, json: { error: "chunk upload failed", op } };
  }
  const md5 = createHash("md5").update(bytes).digest("hex");
  return asc("patch", `/v1/appScreenshots/${shot.id}`, { data: { type: "appScreenshots", id: shot.id, attributes: { uploaded: true, sourceFileChecksum: md5 } } });
}

/** App Review attachment (the demo video Apple asks for): reserve, PUT the ranges, commit with the md5. */
export async function uploadReviewAttachment(reviewDetailId, file) {
  const bytes = readFileSync(file); const size = statSync(file).size;
  const res = await asc("post", "/v1/appStoreReviewAttachments", { data: { type: "appStoreReviewAttachments", attributes: { fileName: file.split("/").pop(), fileSize: size }, relationships: { appStoreReviewDetail: { data: { type: "appStoreReviewDetails", id: reviewDetailId } } } } });
  if (res.status >= 300) return res;
  const att = res.json.data;
  for (const op of att.attributes.uploadOperations) {
    const chunk = bytes.subarray(op.offset, op.offset + op.length);
    const h = Object.fromEntries((op.requestHeaders ?? []).map((x) => [x.name, x.value]));
    const put = await fetch(op.url, { method: op.method, headers: h, body: chunk });
    if (!put.ok) return { status: put.status, json: { error: "chunk upload failed", op } };
  }
  const md5 = createHash("md5").update(bytes).digest("hex");
  return asc("patch", `/v1/appStoreReviewAttachments/${att.id}`, { data: { type: "appStoreReviewAttachments", id: att.id, attributes: { uploaded: true, sourceFileChecksum: md5 } } });
}

/** Poll until the build with this version is VALID (or a terminal failure). */
export async function waitBuild(appId, version, maxMinutes = 180) {
  for (let i = 0; i < maxMinutes; i++) {
    const r = await asc("get", `/v1/builds?filter[app]=${appId}&filter[version]=${version}&fields[builds]=processingState,version,uploadedDate&limit=5`);
    const b = r.json?.data?.[0];
    const st = b?.attributes?.processingState;
    if (st === "VALID") return b;
    if (st === "FAILED" || st === "INVALID") throw new Error("build " + st + " " + JSON.stringify(b));
    await new Promise((res) => setTimeout(res, 60000));
  }
  throw new Error("build still processing after " + maxMinutes + " minutes");
}

if (process.argv[1] && process.argv[1].endsWith("asc.mjs")) {
  const [cmd, a, b] = process.argv.slice(2);
  const out = cmd === "upload-screenshot" ? await uploadScreenshot(a, b)
    : cmd === "upload-review-attachment" ? await uploadReviewAttachment(a, b)
    : cmd === "wait-build" ? await waitBuild(a, b)
    : await asc(cmd, a, b);
  console.log(JSON.stringify(out, null, 1));
  if (out && out.status >= 300) process.exit(1);
}
