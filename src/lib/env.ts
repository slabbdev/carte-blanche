import fs from "node:fs";
import path from "node:path";

/**
 * Minimal .env loader (no dependency): parses KEY=VALUE lines, ignores
 * comments and blanks, and NEVER overrides variables already set in the
 * real environment. Called at every entrypoint so `npm start`, `npm run
 * demo` and `npm run roundtrip:sandbox` share one configuration file.
 */
export function loadEnvFile(file = ".env"): void {
  const resolved = path.resolve(process.cwd(), file);
  if (!fs.existsSync(resolved)) return;
  for (const line of fs.readFileSync(resolved, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}
