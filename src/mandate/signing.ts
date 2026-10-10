import { signCanonical, verifyCanonical } from "../lib/sign.js";
import type { Mandate, SignedMandate } from "./mandate.js";

export function signMandate(mandate: Mandate, privateKeyB64: string, publicKeyB64: string): SignedMandate {
  return {
    mandate,
    signature: signCanonical(privateKeyB64, mandate),
    publicKey: publicKeyB64,
  };
}

export function verifyMandate(signed: SignedMandate): boolean {
  return verifyCanonical(signed.publicKey, signed.mandate, signed.signature);
}
