import { randomBytes } from "node:crypto";
import {
  derBoolean,
  derInteger,
  derOctetString,
  derOid,
  derSequence,
  readTlv,
  tlvChildren,
  tlvContent,
  tlvIsOid,
  type Tlv,
} from "../lib/der.js";

/**
 * RFC 3161 timestamping: the journal's signed tree head is anchored by an
 * independent Timestamp Authority, so the chain's integrity has a witness
 * outside our own keys. Zero-dependency by design — the DER subset lives in
 * lib/der.ts, the TSA transport is injectable for tests.
 */

const OID_SHA256 = "2.16.840.1.101.3.4.2.1";
const OID_SIGNED_DATA = "1.2.840.113549.1.7.2";
const OID_TST_INFO = "1.2.840.113549.1.9.16.1.4";

export const DEFAULT_TSA_URLS = [
  "https://freetsa.org/tsr",
  "https://timestamp.digicert.com",
  "https://timestamp.sectigo.com",
  "https://timestamp.apple.com/ts01",
];

export interface TimestampInfo {
  /** PKIStatus: 0 granted, 1 grantedWithMods, anything else is a refusal. */
  status: number;
  /** The message imprint the TSA signed, hex. */
  imprintHex: string;
  /** TSA time as emitted (GeneralizedTime, normalized to ISO in `genTimeIso`). */
  genTimeRaw: string;
  genTimeIso: string;
  serialHex: string;
  policyOid: string;
  nonceHex?: string;
  /** The full TimeStampResp (response), base64 — the artifact third parties verify with openssl. */
  tokenB64: string;
}

export interface TsaTransport {
  post(url: string, body: Buffer, timeoutMs: number): Promise<Buffer>;
}

export class TsaClient {
  constructor(
    readonly urls: string[] = DEFAULT_TSA_URLS,
    readonly transport: TsaTransport = httpTransport,
    private readonly timeoutMs = 8_000,
  ) {}

  /** Timestamp one SHA-256 digest; tries each configured TSA in order. */
  async timestamp(hashHex: string): Promise<{ url: string; nonce: string; info: TimestampInfo; requestB64: string }> {
    const nonce = randomBytes(8);
    nonce[0] &= 0x7f; // keep the DER INTEGER positive
    const request = buildTimestampRequest(Buffer.from(hashHex, "hex"), nonce);
    const failures: string[] = [];
    for (const url of this.urls) {
      try {
        const resp = await this.transport.post(url, request, this.timeoutMs);
        const info = parseTimestampResponse(resp);
        if (info.status > 1) throw new Error(`TSA refused (status ${info.status})`);
        const verdict = verifyTimestampToken({ imprintHex: hashHex, nonceHex: nonce.toString("hex") }, info);
        if (!verdict.ok) throw new Error(`TSA token failed self-check: ${verdict.reasons.join("; ")}`);
        return { url, nonce: nonce.toString("hex"), info, requestB64: request.toString("base64") };
      } catch (err) {
        failures.push(`${url}: ${(err as Error).message}`);
      }
    }
    throw new Error(`all TSA endpoints failed — ${failures.join(" | ")}`);
  }
}

/** RFC 3161 TimeStampReq for one SHA-256 imprint with certReq so the token carries the TSA cert.
 * The hash AlgorithmIdentifier carries explicit NULL parameters: public TSAs
 * (freetsa et al.) reject parameter-less identifiers with badRequest. */
export function buildTimestampRequest(hash: Buffer, nonce: Buffer): Buffer {
  if (hash.length !== 32) throw new Error("tsa: request expects a SHA-256 digest");
  const imprint = derSequence(derSequence(derOid(OID_SHA256), Buffer.from("0500", "hex")), derOctetString(hash));
  return derSequence(
    derInteger(1n), // version
    imprint,
    derInteger(BigInt(`0x${nonce.toString("hex")}`)),
    derBoolean(true), // certReq
  );
}

/** Parse a TimeStampResp; extracts the TSTInfo fields we verify. */
export function parseTimestampResponse(buf: Buffer): TimestampInfo {
  const resp = readTlv(buf, 0);
  if (resp.tag !== 0x30) throw new Error("tsa: response is not a SEQUENCE");
  const children = tlvChildren(buf, resp);
  if (children.length < 1) throw new Error("tsa: empty response");
  const statusSeq = tlvChildren(buf, children[0])[0];
  const status = statusSeq.tag === 0x02 ? tlvContent(buf, statusSeq).readUInt8(0) : 99;
  if (children.length < 2) {
    throw new Error(`tsa: refused without token (status ${status})`);
  }
  const token = children[1];
  const tst = extractTstInfo(buf, token);
  if (!tst) throw new Error(`tsa: no TSTInfo in token (status ${status})`);
  return { ...tst, status, tokenB64: buf.toString("base64") };
}

function extractTstInfo(buf: Buffer, token: Tlv): Omit<TimestampInfo, "status" | "tokenB64"> | undefined {
  // TimeStampToken IS a ContentInfo: SEQUENCE { OID pkcs7-signedData, [0] SignedData }.
  const parts = tlvChildren(buf, token);
  if (parts.length < 2 || !tlvIsOid(buf, parts[0], Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]))) {
    return undefined;
  }
  const signedData = tlvChildren(buf, parts[1])[0];
  if (!signedData || signedData.tag !== 0x30) return undefined;
  for (const child of tlvChildren(buf, signedData)) {
    if (child.tag !== 0x30) continue;
    const encap = tlvChildren(buf, child);
    if (encap.length >= 2 && tlvIsOid(buf, encap[0], Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x10, 0x01, 0x04]))) {
      // encapContentInfo [0] EXPLICIT holds a primitive OCTET STRING whose
      // content is the DER TSTInfo — parse it with its own header.
      const octets = tlvChildren(buf, encap[1])[0];
      return parseTstInfo(tlvContent(buf, octets));
    }
  }
  return undefined;
}

function parseTstInfo(tst: Buffer): Omit<TimestampInfo, "status" | "tokenB64"> {
  const fields = tlvChildren(tst, readTlv(tst, 0));
  if (fields.length < 5) throw new Error("tsa: TSTInfo too short");
  const policy = tlvContent(tst, fields[1]).toString("hex");
  const imprintSeq = tlvChildren(tst, fields[2]);
  if (imprintSeq.length < 2) throw new Error("tsa: TSTInfo missing imprint");
  const imprintHex = tlvContent(tst, imprintSeq[1]).toString("hex");
  const serialHex = tlvContent(tst, fields[3]).toString("hex");
  const genTimeRaw = tlvContent(tst, fields[4]).toString("ascii");
  const nonceField = fields.find((f) => f.tag === 0x02 && f !== fields[0] && f !== fields[3]);
  const genTimeIso = normalizeGeneralizedTime(genTimeRaw);
  return {
    imprintHex,
    genTimeRaw,
    genTimeIso,
    serialHex,
    policyOid: decodeOidHex(policy),
    ...(nonceField ? { nonceHex: tlvContent(tst, nonceField).toString("hex") } : {}),
  };
}

function decodeOidHex(contentHex: string): string {
  const bytes = Buffer.from(contentHex, "hex");
  const arcs = [Math.floor(bytes[0] / 40), bytes[0] % 40];
  let value = 0;
  for (const byte of bytes.subarray(1)) {
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      arcs.push(value);
      value = 0;
    }
  }
  return arcs.join(".");
}

export function normalizeGeneralizedTime(raw: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:[.,](\d{1,3}))?(Z|[+-]\d{2}(?:\d{2})?)?$/.exec(raw);
  if (!m) return raw;
  const [, y, mo, d, h, mi, s, frac, tz] = m;
  const suffix = !tz || tz === "Z" ? "Z" : tz;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${frac ? `.${frac}` : ""}${suffix}`;
}

export interface TokenVerdict {
  ok: boolean;
  reasons: string[];
}

/**
 * Self-contained token check: the imprint must be exactly our digest and, when
 * a nonce was requested, the TSA must echo it (RFC 3161 §2.4.2). Full PKI chain
 * validation stays with standard tooling (openssl command in the README) — this
 * check never claims more than imprint + freshness.
 */
export function verifyTimestampToken(
  expected: { imprintHex: string; nonceHex?: string },
  info: TimestampInfo,
): TokenVerdict {
  const reasons: string[] = [];
  if (info.imprintHex !== expected.imprintHex) reasons.push("imprint does not match the anchored digest");
  if (expected.nonceHex && info.nonceHex !== expected.nonceHex) reasons.push("nonce not echoed by the TSA");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(info.genTimeIso)) reasons.push("unreadable genTime");
  return { ok: reasons.length === 0, reasons };
}

/** Default transport: POST application/timestamp-query, expect application/timestamp-reply. */
export const httpTransport: TsaTransport = {
  async post(url, body, timeoutMs) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/timestamp-query",
        "Content-Length": String(body.length),
        Accept: "application/timestamp-reply",
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  },
};
