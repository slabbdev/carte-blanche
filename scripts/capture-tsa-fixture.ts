import fs from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { buildTimestampRequest, TsaClient } from "../src/journal/tsa.js";

/** One-off: capture a real TSA reply as the offline test fixture. */
const hash = createHash("sha256").update("carte-blanche/tsa-fixture/v1").digest();
const nonce = randomBytes(8);
nonce[0] &= 0x7f;
const request = buildTimestampRequest(hash, nonce);
const tsa = new TsaClient();
const resp = await tsa.transport.post(tsa.urls[0], request, 10_000);
fs.mkdirSync("test/fixtures", { recursive: true });
fs.writeFileSync("test/fixtures/tsa-response.tsr", resp);
fs.writeFileSync(
  "test/fixtures/tsa-fixture.json",
  JSON.stringify({ url: tsa.urls[0], hashHex: hash.toString("hex"), nonceHex: nonce.toString("hex") }, null, 2),
);
console.log(`fixture saved: ${resp.length} bytes from ${tsa.urls[0]}`);
