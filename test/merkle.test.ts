import { describe, expect, it } from "vitest";
import { freshKeys } from "./helpers.js";
import {
  buildMerkleTree,
  inclusionProof,
  merkleLeafHash,
  verifyMerkleInclusion,
} from "../src/journal/merkle.js";
import { Journal } from "../src/journal/journal.js";
import { verifyCanonical } from "../src/lib/sign.js";

function leaves(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `event-hash-${i}`);
}

describe("Merkle tree (padded, CT-inspired)", () => {
  it("verifies every leaf for every size from 1 to 40", () => {
    for (let n = 1; n <= 40; n++) {
      const hs = leaves(n);
      const tree = buildMerkleTree(hs);
      expect(tree.root).toBeTruthy();
      for (let i = 0; i < n; i++) {
        const proof = inclusionProof(tree, i);
        expect(verifyMerkleInclusion(merkleLeafHash(hs[i]), proof)).toBe(true);
      }
    }
  });

  it("rejects a wrong index, wrong root, or tampered sibling", () => {
    const hs = leaves(7);
    const tree = buildMerkleTree(hs);
    const proof = inclusionProof(tree, 3);
    // wrong leaf for this proof
    expect(verifyMerkleInclusion(merkleLeafHash(hs[4]), proof)).toBe(false);
    // tampered sibling
    const tampered = { ...proof, siblings: [...proof.siblings] };
    tampered.siblings[0] = "deadbeef";
    expect(verifyMerkleInclusion(merkleLeafHash(hs[3]), tampered)).toBe(false);
    // tampered root
    expect(verifyMerkleInclusion(merkleLeafHash(hs[3]), { ...proof, root: "0".repeat(64) })).toBe(false);
  });

  it("is not forgeable: swapping two events changes the root", () => {
    const a = buildMerkleTree(leaves(5)).root;
    const swapped = leaves(5).toReversed();
    const b = buildMerkleTree(swapped).root;
    expect(a).not.toBe(b);
  });

  it("throws on empty input and out-of-range index", () => {
    expect(() => buildMerkleTree([])).toThrow();
    const tree = buildMerkleTree(leaves(3));
    expect(() => inclusionProof(tree, 3)).toThrow();
    expect(() => inclusionProof(tree, -1)).toThrow();
  });
});

describe("Journal Merkle integration", () => {
  it("produces proofs that verify against the signed tree head", () => {
    const journal = new Journal(undefined, freshKeys().journal);
    for (let i = 1; i <= 9; i++) journal.append("test_event", { n: i });
    const sth = journal.signedTreeHead();
    expect(sth.size).toBe(9);

    // STH signature verifies with the journal public key
    expect(
      verifyCanonical(
        sth.publicKey,
        { size: sth.size, root: sth.root, timestamp: sth.timestamp },
        sth.signature,
      ),
    ).toBe(true);

    // every event commits to the same root
    for (let seq = 1; seq <= 9; seq++) {
      const p = journal.inclusionProofForSeq(seq);
      expect(p.leafCount).toBe(9);
      expect(verifyMerkleInclusion(p.eventHash, p)).toBe(true);
      expect(p.root).toBe(sth.root);
    }
    expect(() => journal.inclusionProofForSeq(10)).toThrow();
  });

  it("gives a new STH when the chain grows", () => {
    const journal = new Journal(undefined, freshKeys().journal);
    journal.append("a", { n: 1 });
    const sth1 = journal.signedTreeHead();
    journal.append("b", { n: 2 });
    const sth2 = journal.signedTreeHead();
    expect(sth1.size).toBe(1);
    expect(sth2.size).toBe(2);
    expect(sth1.root).not.toBe(sth2.root);
    // old proof still verifies against the OLD root (append-only, no rewrite)
    const oldProof = journal.inclusionProofForSeq(1);
    // ...after growth, seq 1's proof binds to the new root:
    expect(oldProof.root).toBe(sth2.root);
    expect(verifyMerkleInclusion(oldProof.eventHash, oldProof)).toBe(true);
  });
});
