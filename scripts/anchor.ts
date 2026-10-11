import fs from "node:fs";
import path from "node:path";
import { loadEnvFile } from "../src/lib/env.js";

loadEnvFile();

import { loadOrCreateKeys } from "../src/lib/keys.js";
import { Journal } from "../src/journal/journal.js";
import { TsaClient } from "../src/journal/tsa.js";

/**
 * `npm run anchor` — anchor the current journal position with the TSA and
 * drop the request/token pair next to the journal so anyone can re-verify
 * with plain openssl (commands printed below).
 */
const stateDir = process.env.STATE_DIR ?? ".state";
const keysDir = process.env.KEYS_DIR ?? ".keys";

const keys = loadOrCreateKeys(keysDir);
const journal = new Journal(path.join(stateDir, "journal.jsonl"), keys.journal);

const custom = process.argv[2];
const tsa = custom ? new TsaClient([custom]) : new TsaClient(process.env.TSA_URLS?.split(","));
const anchor = await journal.anchorTreeHead(tsa);

fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(path.join(stateDir, "anchor.tsr"), Buffer.from(anchor.tokenB64, "base64"));
fs.writeFileSync(path.join(stateDir, "anchor.tsq"), Buffer.from(anchor.requestB64, "base64"));

console.log(`anchored · size ${anchor.size} · root ${anchor.root.slice(0, 16)}…`);
console.log(`authority ${anchor.tsaUrl} · time ${anchor.genTime}`);
console.log("independent verification:");
console.log(`  openssl ts -verify -queryfile ${stateDir}/anchor.tsq \\`);
console.log(`      -token_in -in ${stateDir}/anchor.tsr \\`);
console.log("      -CAfile freetsa-ca.pem -untrusted tsa.crt");
console.log("(certificates: https://freetsa.org/files/cacert.pem and tsa.crt)");
