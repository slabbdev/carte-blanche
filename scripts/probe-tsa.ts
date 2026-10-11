import { createHash, randomBytes } from "node:crypto";
import {
  derBoolean,
  derInteger,
  derOctetString,
  derOid,
  derSequence,
  readTlv,
  tlvChildren,
  tlvContent,
} from "../src/lib/der.js";

const OID_SHA256 = "2.16.840.1.101.3.4.2.1";

function buildReq(hash: Buffer, nonce: Buffer, params: Buffer | undefined): Buffer {
  const algId = params ? derSequence(derOid(OID_SHA256), params) : derOid(OID_SHA256);
  return derSequence(
    derInteger(1n),
    derSequence(algId, derOctetString(hash)),
    derInteger(BigInt(`0x${nonce.toString("hex")}`)),
    derBoolean(true),
  );
}

function statusOf(buf: Buffer): { status: number | string; failInfo: string; bytes: number } {
  try {
    const resp = readTlv(buf, 0);
    const statusInfo = tlvChildren(buf, resp)[0];
    const parts = tlvChildren(buf, statusInfo);
    const status = parts[0].tag === 0x02 ? tlvContent(buf, parts[0]).readUInt8(0) : -1;
    const fail = parts[2];
    return {
      status,
      failInfo: fail && fail.tag === 0x03 ? tlvContent(buf, fail).toString("hex") : "",
      bytes: buf.length,
    };
  } catch {
    return { status: "unparseable", failInfo: "", bytes: buf.length };
  }
}

async function probe(url: string, label: string): Promise<void> {
  const hash = createHash("sha256").update(`probe:${label}:${url}`).digest();
  const nonce = randomBytes(8);
  nonce[0] &= 0x7f;
  for (const variant of ["no-params", "null-params"] as const) {
    const req = buildReq(hash, nonce, variant === "null-params" ? Buffer.from("0500", "hex") : undefined);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/timestamp-query", Accept: "application/timestamp-reply" },
        body: new Uint8Array(req),
        signal: AbortSignal.timeout(10_000),
      });
      const buf = Buffer.from(await res.arrayBuffer());
      const s = statusOf(buf);
      console.log(
        `${url.padEnd(36)} ${variant.padEnd(12)} HTTP ${res.status} · status ${s.status} · fail ${s.failInfo} · ${s.bytes}B`,
      );
    } catch (e) {
      console.log(`${url.padEnd(36)} ${variant.padEnd(12)} ERROR ${(e as Error).message}`);
    }
  }
}

await probe("https://freetsa.org/tsr", "freetsa");
await probe("https://timestamp.digicert.com", "digicert");
