import fs from "node:fs";
import { canonicalJson } from "../lib/canonical.js";
import { sha256Hex, signCanonical } from "../lib/sign.js";
import { buildMerkleTree, inclusionProof, merkleLeafHash, type MerkleInclusionProof, type MerkleTree } from "./merkle.js";
import type { TsaClient } from "./tsa.js";

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
 * Independent witness over a tree position: an RFC 3161 token from a
 * Timestamp Authority covers the root, so even someone holding OUR keys
 * cannot backdate or reorder the chain without breaking the TSA's word.
 */
export interface TreeHeadAnchor {
  tsaUrl: string;
  nonce: string;
  genTime: string;
  status: number;
  /** The original RFC 3161 request — third parties verify with `openssl ts -verify -queryfile`. */
  requestB64: string;
  tokenB64: string;
  root: string;
  size: number;
  anchoredAt: string;
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

  append(type: string, data: unknown): JournalEvent;
  /**
   * Callers with their own authority over time (the enforcer's injectable
   * clock, for recurring windows and deterministic tests) stamp events at
   * THEIR now — wall time would misattribute spends across simulated windows.
   */
  append(type: string, data: unknown, ts: string): JournalEvent;
  append(type: string, data: unknown, ts?: string): JournalEvent {
    const prev = this.events[this.events.length - 1];
    const event: JournalEvent = {
      seq: (prev?.seq ?? 0) + 1,
      ts: ts ?? new Date().toISOString(),
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
  private readonly anchorCache = new Map<number, TreeHeadAnchor>();

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

  /** Anchor the current tree position with the TSA (one call per size, cached). */
  async anchorTreeHead(tsa: TsaClient): Promise<TreeHeadAnchor> {
    const sth = this.signedTreeHead();
    const cached = this.anchorCache.get(sth.size);
    if (cached) return cached;
    const { url, nonce, info, requestB64 } = await tsa.timestamp(sth.root);
    const anchor: TreeHeadAnchor = {
      tsaUrl: url,
      nonce,
      genTime: info.genTimeIso,
      status: info.status,
      requestB64,
      tokenB64: info.tokenB64,
      root: sth.root,
      size: sth.size,
      anchoredAt: new Date().toISOString(),
    };
    this.anchorCache.set(anchor.size, anchor);
    // The anchor rides in the chain itself: the journal records that an
    // external authority vouched for this exact position.
    this.append("sth_anchored", {
      size: anchor.size,
      root: anchor.root,
      tsa_url: anchor.tsaUrl,
      nonce: anchor.nonce,
      gen_time: anchor.genTime,
      request_b64: anchor.requestB64,
      token_b64: anchor.tokenB64,
    });
    return anchor;
  }

  /** Sync lookup for receipt assembly: the anchor for an already-anchored size. */
  anchorForSize(size: number): TreeHeadAnchor | undefined {
    return this.anchorCache.get(size);
  }

  /** Latest journalled anchor (survives restarts — read from the chain). */
  latestAnchor(): TreeHeadAnchor | undefined {
    const event = [...this.events].reverse().find((e) => e.type === "sth_anchored");
    if (!event) return undefined;
    const d = event.data as Record<string, string | number>;
    return {
      tsaUrl: String(d.tsa_url),
      nonce: String(d.nonce),
      genTime: String(d.gen_time),
      status: 0,
      requestB64: String(d.request_b64),
      tokenB64: String(d.token_b64),
      root: String(d.root),
      size: Number(d.size),
      anchoredAt: event.ts,
    };
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

  /** Events of one type, optionally narrowed by a data predicate. */
  eventsOfType(type: string, extra?: (data: Record<string, unknown>) => boolean): JournalEvent[] {
    return this.events.filter(
      (e) =>
        e.type === type &&
        e.data !== null &&
        typeof e.data === "object" &&
        (!extra || extra(e.data as Record<string, unknown>)),
    );
  }

  /** Cumulative captured spend (minor units) for a mandate, from the chain itself. */
  capturedMinorFor(mandateId: string): bigint;
  /**
   * Same, restricted to captures whose event timestamp falls in `[fromMs,
   * toMs)` — this is how a recurring mandate spends "this window's" budget
   * without any state outside the chain.
   */
  capturedMinorFor(mandateId: string, bounds: { fromMs?: number; toMs?: number }): bigint;
  capturedMinorFor(mandateId: string, bounds?: { fromMs?: number; toMs?: number }): bigint {
    let total = 0n;
    for (const e of this.eventsFor((d) => d.mandate_id === mandateId)) {
      // our own captures, plus money that moved through PayPal's tools behind the gateway
      if (e.type !== "order_captured" && e.type !== "external_spend") continue;
      if (bounds) {
        const ts = Date.parse(e.ts);
        if (bounds.fromMs !== undefined && ts < bounds.fromMs) continue;
        if (bounds.toMs !== undefined && ts >= bounds.toMs) continue;
      }
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
