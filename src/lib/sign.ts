import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { canonicalJson } from "./canonical.js";

export interface KeyPair {
  /** SPKI DER, base64 */
  publicKeyB64: string;
  /** PKCS#8 DER, base64 */
  privateKeyB64: string;
}

export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyB64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKeyB64: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  };
}

export function signCanonical(privateKeyB64: string, payload: unknown): string {
  const key = createPrivateKey({ key: Buffer.from(privateKeyB64, "base64"), format: "der", type: "pkcs8" });
  return sign(null, Buffer.from(canonicalJson(payload), "utf8"), key).toString("base64");
}

export function verifyCanonical(publicKeyB64: string, payload: unknown, signatureB64: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
    return verify(
      null,
      Buffer.from(canonicalJson(payload), "utf8"),
      key,
      Buffer.from(signatureB64, "base64"),
    );
  } catch {
    return false;
  }
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
