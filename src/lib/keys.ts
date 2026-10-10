import fs from "node:fs";
import path from "node:path";
import { generateKeyPair, type KeyPair } from "./sign.js";

export interface Keys {
  /** Signs receipts, denials and mandates when the server acts as custodial principal. */
  server: KeyPair;
  /** Signs journal checkpoints. */
  journal: KeyPair;
}

function loadOrCreate(dir: string, name: string): KeyPair {
  const privPath = path.join(dir, `${name}.key`);
  const pubPath = path.join(dir, `${name}.pub`);
  if (fs.existsSync(privPath) && fs.existsSync(pubPath)) {
    return {
      privateKeyB64: fs.readFileSync(privPath, "utf8").trim(),
      publicKeyB64: fs.readFileSync(pubPath, "utf8").trim(),
    };
  }
  const kp = generateKeyPair();
  fs.writeFileSync(privPath, kp.privateKeyB64 + "\n", { mode: 0o600 });
  fs.writeFileSync(pubPath, kp.publicKeyB64 + "\n");
  return kp;
}

/**
 * Loads the server and journal keypairs from `dir`, generating them on first
 * boot. Private keys are written with mode 0600. For the hackathon demo the
 * server acts as a custodial principal; a non-custodial mode (principal-held
 * keys) is on the roadmap.
 */
export function loadOrCreateKeys(dir: string): Keys {
  fs.mkdirSync(dir, { recursive: true });
  return { server: loadOrCreate(dir, "server"), journal: loadOrCreate(dir, "journal") };
}
