import fs from "node:fs";
import { loadJson, saveJson } from "../lib/persist.js";
import type { Journal } from "../journal/journal.js";

/**
 * Agent preferences: the agent's learned profile of its principal — tiers,
 * trusted merchants, no-gos, standing instructions. Deliberately NOT model
 * internals: each preference is an explicit, human-readable fact that lands in
 * the sealed journal, so "why did the agent pick this?" is auditable evidence,
 * not a vibe. The agent reads/writes it through its tools; the human can read
 * it over the API.
 */

export interface AgentPreferences {
  updatedAt: string;
  /** Key -> value facts, e.g. "hardware.tier" -> "mid-range (Keychron-class)". */
  preferences: Record<string, string>;
  /** Free-form standing notes ("nos délires"), newest last. */
  notes: string[];
}

const EMPTY: AgentPreferences = { updatedAt: new Date(0).toISOString(), preferences: {}, notes: [] };
const MAX_VALUE = 200;
const MAX_NOTES = 50;

export class PreferenceStore {
  private cache: AgentPreferences | null = null;

  constructor(
    private readonly stateDir: string,
    private readonly journal: Journal,
  ) {}

  get(): AgentPreferences {
    if (!this.cache) this.cache = loadJson<AgentPreferences>(this.file(), EMPTY);
    return this.cache;
  }

  /** Sets or updates one preference. Journals the change (old -> new). */
  set(key: string, value: string, why?: string): AgentPreferences {
    const k = key.trim().slice(0, 60);
    if (!k) throw new Error("preference key is required");
    const v = value.trim().slice(0, MAX_VALUE);
    if (!v) throw new Error("preference value is required");
    const prefs = this.get();
    const previous = prefs.preferences[k] ?? null;
    prefs.preferences[k] = v;
    prefs.updatedAt = new Date().toISOString();
    this.persist();
    this.journal.append("agent_preference_set", {
      key: k,
      previous,
      value: v,
      ...(why ? { why: why.slice(0, 200) } : {}),
    });
    return this.get();
  }

  /** Appends a free-form standing note (kept to the last MAX_NOTES). */
  note(text: string): AgentPreferences {
    const t = text.trim().slice(0, 300);
    if (!t) throw new Error("note text is required");
    const prefs = this.get();
    prefs.notes = [...prefs.notes, t].slice(-MAX_NOTES);
    prefs.updatedAt = new Date().toISOString();
    this.persist();
    this.journal.append("agent_preference_noted", { note: t });
    return this.get();
  }

  private file(): string {
    fs.mkdirSync(this.stateDir, { recursive: true });
    return `${this.stateDir}/agent-preferences.json`;
  }

  private persist(): void {
    saveJson(this.file(), this.get());
  }
}
