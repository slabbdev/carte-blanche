import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import {
  buildTimestampRequest,
  parseTimestampResponse,
  verifyTimestampToken,
  TsaClient,
} from "../src/journal/tsa.js";
import { readTlv, tlvChildren, tlvContent } from "../src/lib/der.js";
import { setupWorld } from "./helpers.js";
import { verifyFullReceipt } from "../src/receipts/receipts.js";

const fixtureJson = () => JSON.parse(fs.readFileSync("test/fixtures/tsa-fixture.json", "utf8")) as {
  url: string;
  hashHex: string;
  nonceHex: string;
};
const fixtureTsr = () => fs.readFileSync("test/fixtures/tsa-response.tsr");

describe("DER request encoding", () => {
  it("round-trips version, imprint, nonce and certReq", () => {
    const hash = createHash("sha256").update("der-structure").digest();
    const nonce = Buffer.from("0011223344556677", "hex");
    const req = buildTimestampRequest(hash, nonce);
    const top = readTlv(req, 0);
    expect(top.tag).toBe(0x30);
    const [version, imprint, nonceTlv, certReq] = tlvChildren(req, top);
    expect(tlvContent(req, version).readUInt8(0)).toBe(1);
    const [algId, hashed] = tlvChildren(req, imprint);
    expect(algId.tag).toBe(0x30);
    // sha256 with explicit NULL parameters — public TSAs reject parameter-less algids
    const [oid, params] = tlvChildren(req, algId);
    // explicit NULL parameters: tag 0x05 with empty content — public TSAs reject parameter-less algids
    expect(params.tag).toBe(0x05);
    expect(params.contentEnd).toBe(params.contentStart);
    expect(tlvContent(req, hashed).equals(hash)).toBe(true);
    expect(BigInt(`0x${tlvContent(req, nonceTlv).toString("hex")}`)).toBe(0x11223344556677n);
    expect(tlvContent(req, certReq).readUInt8(0)).toBe(0xff);
  });

  it("refuses non-sha256 digests", () => {
    expect(() => buildTimestampRequest(Buffer.alloc(16, 1), Buffer.alloc(8))).toThrow(/SHA-256/);
  });
});

describe("RFC 3161 response parsing (captured freetsa token)", () => {
  it("extracts status, imprint, echoed nonce and a normalized genTime", () => {
    const fx = fixtureJson();
    const info = parseTimestampResponse(fixtureTsr());
    expect(info.status).toBe(0);
    expect(info.imprintHex).toBe(fx.hashHex);
    expect(info.nonceHex).toBe(fx.nonceHex);
    expect(info.genTimeIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("self-verifies against the expected imprint and nonce — and catches tampering", () => {
    const fx = fixtureJson();
    const info = parseTimestampResponse(fixtureTsr());
    expect(verifyTimestampToken({ imprintHex: fx.hashHex, nonceHex: fx.nonceHex }, info).ok).toBe(true);
    expect(verifyTimestampToken({ imprintHex: fx.hashHex, nonceHex: "00".repeat(8) }, info).ok).toBe(false);
    expect(verifyTimestampToken({ imprintHex: "ab".repeat(32), nonceHex: fx.nonceHex }, info).ok).toBe(false);
  });

  it("flags a refusal that carries no token", () => {
    // status=rejection, PKIStatusInfo with failInfo, no token (captured earlier from freetsa)
    const refusal = Buffer.from(
      "3030302e02010230250c23426164207265717565737420666f726d6174206f722073797374656d206572726f722e03020204",
      "hex",
    );
    expect(() => parseTimestampResponse(refusal)).toThrow(/refused without token/);
  });
});

describe("journal anchoring", () => {
  it("rejects a TSA token that commits to a different digest — and leaves the chain clean", async () => {
    // The fixture's imprint is fixed; no test journal can have that root, so
    // the self-check MUST refuse the anchor (this is the lying-authority path).
    let calls = 0;
    const tsa = new TsaClient(["https://tsa.test"], { async post() { calls += 1; return fixtureTsr(); } });
    const w = setupWorld();
    w.journal.append("seed", { n: 1 });
    await expect(w.journal.anchorTreeHead(tsa)).rejects.toThrow(/self-check/);
    expect(calls).toBe(1);
    expect(w.journal.anchorForSize(w.journal.signedTreeHead().size)).toBeUndefined();
    expect(w.journal.latestAnchor()).toBeUndefined();
    expect(w.journal.verify().ok).toBe(true);
  });

  it("purchase proceeds without an anchor when the TSA misbehaves", async () => {
    const tsa = new TsaClient(["https://tsa.test"], { async post() { return fixtureTsr(); } });
    const w = setupWorld({}, tsa);
    const outcome = await w.enforcer.purchase({
      mandateId: w.mandateId,
      amount: "10.00",
      currency: "USD",
      description: "best-effort anchoring",
    });
    if (outcome.kind !== "receipt") throw new Error("expected receipt");
    const report = verifyFullReceipt(outcome.full);
    expect(report.overall).toBe(true);
    expect(report.checks.find((c) => c.id === "merkle_inclusion")?.ok).toBe(true);
    // Honest absence: no TSA claim when the authority failed us.
    expect(report.checks.find((c) => c.id === "tsa_anchor")).toBeUndefined();
  });
});
