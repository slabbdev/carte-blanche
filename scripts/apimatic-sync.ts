import fs from "node:fs";
import { loadEnvFile } from "../src/lib/env.js";

loadEnvFile();

/**
 * `npm run apimatic:sync` — the docs-as-code loop against the APIMatic API:
 *   1. validate the contract (validation + agentic-tools linting),
 *   2. generate the TypeScript SDK from the live spec URL,
 *   3. download it into sdk/typescript/.
 *
 * Needs APIMATIC_API_KEY in the environment (.env works). The code generation
 * runs against a PUBLIC spec URL — the deployed instance serves it at
 * /openapi.json. Regenerated artifacts are committed so reviewers can read
 * them without an APIMatic account.
 *
 * Endpoints (from @apimatic/sdk, their own generated client):
 *   POST /validation/v2/validate-via-file   (multipart file)
 *   POST /code-generations/generate-via-url (vendor JSON content type)
 *   GET  /code-generations/{id}/generated-sdk
 * Auth header: `X-Auth-Key <api key>`.
 */

const API = "https://api.apimatic.io";
const SPEC = "docs/openapi.json";
const SDK_DIR = "sdk/typescript";
const key = process.env.APIMATIC_API_KEY ?? "";

if (!key) {
  console.error("APIMATIC_API_KEY is required (put it in .env)");
  process.exit(1);
}
const auth = { Authorization: `X-Auth-Key ${key}` };

const validation = await fetch(`${API}/validation/v2/validate-via-file`, {
  method: "POST",
  headers: auth,
  body: (() => {
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(SPEC)], { type: "application/json" }), "openapi.json");
    return form;
  })(),
});
if (!validation.ok) {
  console.error(`validation failed: HTTP ${validation.status}`);
  process.exit(1);
}
const report = (await validation.json()) as {
  validation: { isSuccess: boolean; errors: unknown[] };
  linting: { isSuccess: boolean; errors: Array<{ message: string; jsonReferencePath: string }> };
};
console.log(`validation: ${report.validation.isSuccess ? "OK" : "FAILED"} (${report.validation.errors.length} errors)`);
console.log(`linting:    ${report.linting.isSuccess ? "OK" : "FAILED"} (${report.linting.errors.length} errors)`);
for (const e of report.linting.errors.slice(0, 5)) console.log(`  - ${e.jsonReferencePath}: ${e.message}`);
if (!report.validation.isSuccess || !report.linting.isSuccess) process.exit(1);

const specUrl = process.argv[2] ?? "https://carte-blanche-6jgo.onrender.com/openapi.json";
const generate = await fetch(`${API}/code-generations/generate-via-url`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/vnd.apimatic.userCodeGenerationDto.v1+json" },
  body: JSON.stringify({ url: specUrl, template: "TS_GENERIC_LIB" }),
});
if (!generate.ok) {
  console.error(`SDK generation failed: HTTP ${generate.status}`);
  process.exit(1);
}
const raw = await generate.text();
const get = (tag: string) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(raw)?.[1] ?? "";
const id = get("Id");
console.log(`SDK generated: id ${id} · template ${get("Template")} · success ${get("Success")}`);

const download = await fetch(`${API}/code-generations/${id}/generated-sdk`, { headers: auth });
if (!download.ok) {
  console.error(`SDK download failed: HTTP ${download.status}`);
  process.exit(1);
}
const zip = Buffer.from(await download.arrayBuffer());
fs.rmSync(SDK_DIR, { recursive: true, force: true });
fs.mkdirSync(SDK_DIR, { recursive: true });
fs.writeFileSync("/tmp/apimatic-sdk.zip", zip);
const { execSync } = await import("node:child_process");
execSync(`unzip -o -q /tmp/apimatic-sdk.zip -d ${SDK_DIR} && rm -rf ${SDK_DIR}/.github`);
console.log(`SDK downloaded into ${SDK_DIR}/ (${Math.round(zip.length / 1024)} KB zip)`);
