import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
cpSync(join(root, "src", "web"), join(root, "dist", "web"), { recursive: true });
console.log("copied src/web -> dist/web");
