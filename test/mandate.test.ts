import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/lib/canonical.js";
import { generateKeyPair, signCanonical, verifyCanonical, sha256Hex } from "../src/lib/sign.js";
import { parseAmount, formatAmount, validateMandate } from "../src/mandate/mandate.js";

describe("canonicalJson", () => {
  it("is stable under key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("drops undefined values and keeps nulls", () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("serializes arrays in order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("ed25519 signatures", () => {
  it("verify a genuine payload and reject a tampered one", () => {
    const kp = generateKeyPair();
    const payload = { hello: "world", n: 42 };
    const sig = signCanonical(kp.privateKeyB64, payload);
    expect(verifyCanonical(kp.publicKeyB64, payload, sig)).toBe(true);
    expect(verifyCanonical(kp.publicKeyB64, { hello: "world!", n: 42 }, sig)).toBe(false);
    expect(verifyCanonical(kp.publicKeyB64, payload, sig.slice(0, -4) + "AAAA")).toBe(false);
  });

  it("produce different signatures for different key order but identical canonical bytes", () => {
    const kp = generateKeyPair();
    const s1 = signCanonical(kp.privateKeyB64, { a: 1, b: 2 });
    const s2 = signCanonical(kp.privateKeyB64, { b: 2, a: 1 });
    expect(s1).toBe(s2);
  });
});

describe("money helpers", () => {
  it("parse decimal strings into minor units", () => {
    expect(parseAmount("25.00", "USD")).toBe(2500n);
    expect(parseAmount("0.99", "EUR")).toBe(99n);
    expect(parseAmount("1000", "JPY")).toBe(1000n);
  });

  it("reject malformed amounts", () => {
    expect(() => parseAmount("-5", "USD")).toThrow();
    expect(() => parseAmount("1.234", "USD")).toThrow();
    expect(() => parseAmount("abc", "USD")).toThrow();
    // @ts-expect-error deliberately wrong type
    expect(() => parseAmount(12, "USD")).toThrow();
  });

  it("round-trip through formatAmount", () => {
    expect(formatAmount(2500n, "USD")).toBe("25.00");
    expect(formatAmount(5n, "USD")).toBe("0.05");
    expect(formatAmount(1000n, "JPY")).toBe("1000");
  });
});

describe("validateMandate", () => {
  const base = {
    id: "cbmd-x",
    version: "cb-mandate/v1" as const,
    principal: "p",
    agent: "a",
    purpose: "tests",
    issuedAt: new Date().toISOString(),
  };

  it("accepts a well-formed mandate", () => {
    expect(
      validateMandate({
        ...base,
        limits: {
          currency: "USD",
          maxPerTransaction: "30.00",
          maxTotalSpend: "60.00",
          windowStart: new Date().toISOString(),
          windowEnd: new Date(Date.now() + 1000).toISOString(),
        },
      }),
    ).toEqual([]);
  });

  it("flags an inverted window and bad amounts", () => {
    const errors = validateMandate({
      ...base,
      limits: {
        currency: "USD",
        maxPerTransaction: "not-a-number",
        maxTotalSpend: "60.00",
        windowStart: new Date(Date.now() + 2000).toISOString(),
        windowEnd: new Date().toISOString(),
      },
    });
    expect(errors.join("\n")).toMatch(/maxPerTransaction/);
    expect(errors.join("\n")).toMatch(/windowEnd/);
  });
});

describe("sha256Hex", () => {
  it("is the well-known digest", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
