/**
 * Minimal DER (ASN.1) reader/writer — the subset needed to speak RFC 3161
 * (timestamp protocol) without pulling a dependency into the project.
 * Definite-length encodings only: every real TSA emits them, and rejecting
 * BER indefinite lengths is the fail-closed choice.
 */

export interface Tlv {
  tag: number;
  /** Byte offset of the TLV. */
  start: number;
  /** Byte offset of the content. */
  contentStart: number;
  /** Exclusive end of the TLV (contentEnd === end). */
  contentEnd: number;
}

function derLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function derTlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

export function derSequence(...parts: Buffer[]): Buffer {
  return derTlv(0x30, Buffer.concat(parts));
}

export function derSet(...parts: Buffer[]): Buffer {
  return derTlv(0x31, Buffer.concat(parts));
}

export function derOctetString(b: Buffer): Buffer {
  return derTlv(0x04, b);
}

/** DER INTEGER for non-negative values (BigInt or byte array). */
export function derInteger(value: bigint | Buffer): Buffer {
  let body: Buffer;
  if (typeof value === "bigint") {
    let hex = value.toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    body = Buffer.from(hex, "hex");
    if (body.length === 0) body = Buffer.from([0]);
    else if (body[0] & 0x80) body = Buffer.concat([Buffer.from([0]), body]);
  } else {
    body = value;
  }
  return derTlv(0x02, body);
}

export function derBoolean(v: boolean): Buffer {
  return derTlv(0x01, Buffer.from([v ? 0xff : 0x00]));
}

export function derOid(oid: string): Buffer {
  const parts = oid.split(".").map((s) => Number.parseInt(s, 10));
  if (parts.length < 2 || parts.some(Number.isNaN)) throw new Error(`der: bad oid ${oid}`);
  const body: number[] = [];
  body.push(parts[0] * 40 + parts[1]);
  for (const arc of parts.slice(2)) {
    if (arc === 0) {
      body.push(0);
      continue;
    }
    const chunks: number[] = [];
    let n = arc;
    while (n > 0) {
      chunks.unshift(n & 0x7f);
      n >>= 7;
    }
    for (let i = 0; i < chunks.length - 1; i++) chunks[i] |= 0x80;
    body.push(...chunks);
  }
  return derTlv(0x06, Buffer.from(body));
}

/** Read one TLV at `pos`. Throws on truncated input or indefinite lengths. */
export function readTlv(buf: Buffer, pos: number): Tlv {
  if (pos >= buf.length) throw new Error("der: read past end");
  const tag = buf[pos];
  let p = pos + 1;
  const first = buf[p++];
  let len: number;
  if (first < 0x80) len = first;
  else if (first === 0x80) throw new Error("der: indefinite length unsupported");
  else {
    const count = first & 0x7f;
    if (count > 6 || p + count > buf.length) throw new Error("der: bad length header");
    len = 0;
    for (let i = 0; i < count; i++) len = len * 256 + buf[p++];
  }
  if (p + len > buf.length) throw new Error("der: truncated content");
  return { tag, start: pos, contentStart: p, contentEnd: p + len };
}

export function tlvContent(buf: Buffer, tlv: Tlv): Buffer {
  return buf.subarray(tlv.contentStart, tlv.contentEnd);
}

export function tlvChildren(buf: Buffer, tlv: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let pos = tlv.contentStart;
  while (pos < tlv.contentEnd) {
    const child = readTlv(buf, pos);
    out.push(child);
    pos = child.contentEnd;
  }
  return out;
}

/** True if this TLV is an OID whose content bytes equal `oidContent` (pre-encoded). */
export function tlvIsOid(buf: Buffer, tlv: Tlv, oidContent: Buffer): boolean {
  return tlv.tag === 0x06 && tlvContent(buf, tlv).equals(oidContent);
}
