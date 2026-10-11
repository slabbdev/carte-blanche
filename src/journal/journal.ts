import fs from "node:fs";
import { canonicalJson } from "../lib/canonical.js";
import { sha256Hex, signCanonical } from "../lib/sign.js";
import { buildMerkleTree, inclusionProof, merkleLeafHash, type MerkleInclusionProof, type MerkleTree } from "./merkle.js";

const GENESIS_HASH = sha256Hex("carte-blanche/journal/genesis/v1");

export interface JournalEvent {
  seq: number;
  ts: string;
  type: string;
  data: unknown;
  prevHash: string;
  /** sha256 over canonicalJson({seq, ts, type, data, prevHash}). */
  hash: string;
}

export interface ChainVerification {
  ok: boolean;
  length: number;
  tip: string;
  brokenAt?: number;
}

export interface JournalCheckpoint {
  upToSeq: number;
  tip: string;
  signature: string;
  publicKey: string;
}

/** Signed tree head: the journal's position, signed by the journal key. */
export interface SignedTreeHead {
  size: number;
  root: string;
  timestamp: string;
  signature: string;
  publicKey: string;
}

/**
 * Append-only, tamper-evident event journal. Every event hashes the previous
 * one (SHA-256 chain), and every CHECKPOINT_EVERY events a signed checkpoint
 * seals the chain position. The same pattern is proven in production use by
 * the NoireBox project; here it ships as a single self-contained module.
 */
export class Journal {
  private events: JournalEvent[] = [];
  private lastCheckpoint: JournalCheckpoint | undefined;

  constructor(
    private readonly persistPath: string | undefined,
    private readonly keyPair: { privateKeyB64: string; publicKeyB64: string },
  ) {
    this.load();
  }

  append(type: string, data: unknown): JournalEvent {
    const prev = this.events[this.events.length - 1];
    const event: JournalEvent = {
      seq: (prev?.seq ?? 0) + 1,
      ts: new Date().toISOString(),
      type,
      data,
      prevHash: prev?.hash ?? GENESIS_HASH,
      hash: "",
    };
    event.hash = eventHash(event);
    this.events.push(event);
    this.persist(event);
    if (event.seq % CHECKPOINT_EVERY === 0) this.sealCheckpoint();
    return event;
  }

  private sealCheckpoint(): void {
    const tip = this.tip();
    this.lastCheckpoint = {
      upToSeq: this.length,
      tip,
      signature: signCanonical(this.keyPair.privateKeyB64, {
        upToSeq: this.length,
        tip,
      }),
      publicKey: this.keyPair.publicKeyB64,
    };
  }

  tip(): string {
    return this.events[this.events.length - 1]?.hash ?? GENESIS_HASH;
  }

  private merkleCache: { size: number; tree: MerkleTree } | undefined;

  /** Merkle tree over every event in the chain (rebuilt only when size changes). */
  private merkleTree(): MerkleTree {
    if (this.merkleCache?.size === this.events.length) return this.merkleCache.tree;
    const tree = buildMerkleTree(this.events.map((e) => e.hash));
    this.merkleCache = { size: this.events.length, tree };
    return tree;
  }

  /** Inclusion proof that event `seq` is committed by the current root. */
  inclusionProofForSeq(seq: number): MerkleInclusionProof & { eventHash: string } {
    const event = this.events[seq - 1];
    if (!event || event.seq !== seq) throw new Error(`no event with seq ${seq}`);
    const proof = inclusionProof(this.merkleTree(), seq - 1);
    return { ...proof, eventHash: merkleLeafHash(event.hash) };
  }

  private sthCache: { size: number; sth: SignedTreeHead } | undefined;

  /** Signed tree head over the whole chain — cached per size so a given tree always yields the same STH. */
  signedTreeHead(): SignedTreeHead {
    const tree = this.merkleTree();
    if (this.sthCache?.size === tree.leafCount) return this.sthCache.sth;
    const timestamp = new Date().toISOString();
    const payload = { size: tree.leafCount, root: tree.root, timestamp };
    const sth: SignedTreeHead = {
      ...payload,
      signature: signCanonical(this.keyPair.privateKeyB64, payload),
      publicKey: this.keyPair.publicKeyB64,
    };
    this.sthCache = { size: tree.leafCount, sth };
    return sth;
  }

  get length(): number {
    return this.events.length;
  }

  lastCheckpointInfo(): JournalCheckpoint | undefined {
    return this.lastCheckpoint;
  }

  recent(limit: number): JournalEvent[] {
    return this.events.slice(-limit).reverse();
  }

  eventsFor(predicate: (data: Record<string, unknown>) => boolean): JournalEvent[] {
    return this.events.filter(
      (e) => e.data !== null && typeof e.data === "object" && predicate(e.data as Record<string, unknown>),
    );
  }

  /** Cumulative captured spend (minor units) for a mandate, from the chain itself. */
  capturedMinorFor(mandateId: string): bigint {
    let total = 0n;
    for (const e of this.eventsFor((d) => d.mandate_id === mandateId)) {
      if (e.type !== "order_captured") continue;
      const d = e.data as { amount_minor?: string };
      if (typeof d.amount_minor === "string") total += BigInt(d.amount_minor);
    }
    return total;
  }

  verify(): ChainVerification {
    let prevHash = GENESIS_HASH;
    for (const e of this.events) {
      if (e.prevHash !== prevHash || e.hash !== eventHash(e)) {
        return { ok: false, length: this.events.length, tip: this.tip(), brokenAt: e.seq };
      }
      prevHash = e.hash;
    }
    return { ok: true, length: this.events.length, tip: this.tip() };
  }

  private persist(event: JournalEvent): void {
    if (!this.persistPath) return;
    fs.appendFileSync(this.persistPath, JSON.stringify(event) + "\n");
  }

  private load(): void {
    if (!this.persistPath || !fs.existsSync(this.persistPath)) return;
    const lines = fs.readFileSync(this.persistPath, "utf8").split("\n").filter(Boolean);
    const parsed: JournalEvent[] = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line) as JournalEvent);
      } catch {
        break; // torn trailing line: stop at the last intact event
      }
    }
    this.events = parsed;
    if (parsed.length > 0 && parsed[parsed.length - 1].seq % CHECKPOINT_EVERY === 0) {
      this.sealCheckpoint();
    }
  }
}

const CHECKPOINT_EVERY = 25;

function eventHash(e: JournalEvent): string {
  return sha256Hex(canonicalJson({ seq: e.seq, ts: e.ts, type: e.type, data: e.data, prevHash: e.prevHash }));
}
