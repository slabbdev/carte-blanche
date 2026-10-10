/**
 * Deterministic JSON serialization used as the byte source for every signature
 * and hash in this project. Keys are sorted, whitespace is removed, `undefined`
 * values are dropped. Amounts are carried as strings so there are no float
 * formatting concerns. We intentionally do not claim full RFC 8785 (JCS)
 * conformance — every signature in this codebase is produced and checked with
 * this one function, which is what matters for internal consistency.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return JSON.stringify(value);
  if (t === "bigint") return value.toString();
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (t === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return "{" + entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",") + "}";
  }
  throw new Error(`canonicalJson: unsupported value of type ${t}`);
}
