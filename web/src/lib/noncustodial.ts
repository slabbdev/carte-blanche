/** Non-custodial signing: the principal's Ed25519 key never leaves the tab.
 *  The server verifies the signature over the canonical parse and stores the
 *  public key — it cannot forge the mandate. (The Amex pattern, open-sourced.) */
const te = new TextEncoder();

export function canonicalJson(v: unknown): string {
  if (v === null || v === undefined) return "null";
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  if (t === "object") {
    const e = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return "{" + e.map(([k, x]) => JSON.stringify(k) + ":" + canonicalJson(x)).join(",") + "}";
  }
  throw new Error("unsupported");
}

export const bytesToB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", te.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface SelfSignedMandate {
  mandate: unknown;
  signature: string;
  publicKey: string;
  fingerprint: string;
}

export async function signMandateInBrowser(mandate: unknown): Promise<SelfSignedMandate> {
  const kp = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const signature = bytesToB64(
    new Uint8Array(await crypto.subtle.sign("Ed25519", kp.privateKey, te.encode(canonicalJson(mandate)))),
  );
  const publicKey = bytesToB64(new Uint8Array(await crypto.subtle.exportKey("spki", kp.publicKey)));
  const fingerprint = (await sha256Hex(publicKey)).slice(0, 12);
  const myKeys: string[] = JSON.parse(sessionStorage.getItem("cb-my-keys") || "[]");
  myKeys.push(fingerprint);
  sessionStorage.setItem("cb-my-keys", JSON.stringify(myKeys));
  return { mandate, signature, publicKey, fingerprint };
}

export function myKeyFingerprints(): string[] {
  return JSON.parse(sessionStorage.getItem("cb-my-keys") || "[]");
}
