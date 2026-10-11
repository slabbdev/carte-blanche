import { sha256Hex } from "../lib/sign.js";

/**
 * Merkle tree over journal event hashes, with per-event inclusion proofs.
 *
 * Scheme: CT-inspired but deliberately NOT RFC 6962 — we pad the leaf level
 * to a power of two by duplicating the last leaf. That gives every leaf a
 * real sibling at every level, so an inclusion proof is a clean sibling list
 * and verification is unambiguous. The padding is bound to the root, so any
 * change to the event set changes the root: nothing is weakened.
 * (When we anchor roots with a public TSA in S4b, the scheme name gets
 * documented next to the anchor — no RFC 6962 claim is made anywhere.)
 */

export interface MerkleInclusionProof {
  /** Index of the leaf in the UNPADDED event list (seq - 1). */
  leafIndex: number;
  /** Number of real events (before padding). */
  leafCount: number;
  root: string;
  /** Sibling hashes from leaf level to root (one per level). */
  siblings: string[];
}

export function merkleLeafHash(eventHashHex: string): string {
  return sha256Hex(`cb-leaf:${eventHashHex}`);
}

function pairHash(left: string, right: string): string {
  return sha256Hex(`cb-node:${left}:${right}`);
}

export interface MerkleTree {
  leafCount: number;
  /** levels[0] = padded leaves; levels[last] = [root]. */
  levels: string[][];
  root: string;
}

export function buildMerkleTree(eventHashesHex: string[]): MerkleTree {
  if (eventHashesHex.length === 0) throw new Error("merkle tree of zero events");
  const leaves = eventHashesHex.map(merkleLeafHash);
  const padded = leaves.slice();
  const target = 2 ** Math.ceil(Math.log2(leaves.length));
  for (let i = leaves.length; i < target; i++) padded.push(padded[leaves.length - 1]);

  const levels: string[][] = [padded];
  let current = padded;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) next.push(pairHash(current[i], current[i + 1]));
    levels.push(next);
    current = next;
  }
  return { leafCount: leaves.length, levels, root: current[0] };
}

export function inclusionProof(tree: MerkleTree, leafIndex: number): MerkleInclusionProof {
  if (leafIndex < 0 || leafIndex >= tree.leafCount) {
    throw new Error(`leaf index ${leafIndex} out of range (${tree.leafCount} events)`);
  }
  const siblings: string[] = [];
  let index = leafIndex;
  for (let level = 0; level < tree.levels.length - 1; level++) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    siblings.push(tree.levels[level][siblingIndex]);
    index = Math.floor(index / 2);
  }
  return { leafIndex, leafCount: tree.leafCount, root: tree.root, siblings };
}

/** Recomputes the root from a leaf hash and its proof. Throws on any mismatch path. */
export function verifyMerkleInclusion(leaf: string, proof: MerkleInclusionProof): boolean {
  const { siblings, leafIndex, root } = proof;
  if (leafIndex < 0 || proof.leafCount <= 0) return false;
  // leafIndex must fit in the padded width: 2^siblings.length leaves.
  if (leafIndex >= 2 ** siblings.length) return false;
  let fn = leaf;
  let index = leafIndex;
  for (const sibling of siblings) {
    if (index % 2 === 0) fn = pairHash(fn, sibling);
    else fn = pairHash(sibling, fn);
    index = Math.floor(index / 2);
  }
  return fn === root;
}
