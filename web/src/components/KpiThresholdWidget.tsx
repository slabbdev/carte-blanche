import { useEffect, useState } from "react";
import type { AgWidgetParams } from "ag-studio";

/**
 * "Threshold KPI" — the one tile a seller actually watches.
 *
 * A single aggregated number judged against a threshold the merchant sets in the
 * widget form (PayPal's ~1.5 % dispute rate by default), rendered as the big
 * figure + a verdict pill in the back-office palette. Registered as a custom AG
 * Studio widget so the data engine does the aggregation and the page filters
 * apply; the Studio agents can place and configure it like any built-in widget.
 */

export const KPI_WIDGET_ID = "cbKpiThreshold";

interface KpiStyle {
  threshold?: number;
  goodWhen?: "below" | "above";
  unit?: string;
  decimals?: number;
  caption?: string;
}

export function KpiThresholdWidget(params: AgWidgetParams<any>) {
  const { widgetApi, dataMapping, format } = params as any;
  const [value, setValue] = useState<number | null>(null);
  const [label, setLabel] = useState<string>("");
  const style: KpiStyle = (format?.style ?? {}) as KpiStyle;
  const fields = (dataMapping?.value ?? []) as Array<{ id: string; aggregation?: string; name?: string }>;
  const fieldKey = fields.map((f) => `${f.id}|${f.aggregation ?? ""}`).join(",");

  useEffect(() => {
    let cancelled = false;
    if (!fields.length) {
      widgetApi?.setDisplayState?.("incompleteDataMapping");
      return;
    }
    widgetApi?.setDisplayState?.("loading");
    widgetApi
      .getData({ kind: "flat", fields })
      .then((res: { results?: { rows?: Array<Record<string, unknown>> } }) => {
        if (cancelled) return;
        const row = res?.results?.rows?.[0] ?? {};
        const direct = row[fields[0].id];
        const raw = direct !== undefined ? direct : Object.values(row)[0];
        const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
        setValue(Number.isFinite(n) ? n : null);
        setLabel(fields[0].name ?? fields[0].id.split(".").pop() ?? "");
        widgetApi?.setDisplayState?.(Number.isFinite(n) ? "displayed" : "noData");
      })
      .catch(() => {
        if (!cancelled) widgetApi?.setDisplayState?.("noData");
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldKey, widgetApi]);

  const threshold = typeof style.threshold === "number" ? style.threshold : 1.5;
  const goodWhen = style.goodWhen ?? "below";
  const unit = style.unit ?? "";
  const decimals = typeof style.decimals === "number" ? style.decimals : 2;
  const good = value === null ? null : goodWhen === "below" ? value <= threshold : value >= threshold;

  const caption = style.caption || label;
  return (
    <div style={{ height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "flex-start", padding: "8px 12px 6px", gap: 4, fontFamily: "inherit", overflow: "hidden" }}>
      <div title={caption} style={{ flexShrink: 0, fontSize: 11.5, lineHeight: "15px", color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{caption}</div>
      <b style={{ flexShrink: 0, fontSize: 26, lineHeight: 1.05, color: "#0c1a3a", letterSpacing: -0.5, whiteSpace: "nowrap" }}>
        {value === null ? "—" : value.toFixed(decimals)}
        {value !== null && unit && <span style={{ fontSize: 15, marginLeft: 2 }}>{unit}</span>}
      </b>
      {good !== null && (
        <span
          style={{
            alignSelf: "flex-start", flexShrink: 0, fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 999, whiteSpace: "nowrap",
            background: good ? "#e6f6ec" : "#fff1e6", color: good ? "#136c3a" : "#b4530f",
          }}
        >
          {good ? "✓ " : "⚠ "}{goodWhen === "below" ? "≤" : "≥"} {threshold}{unit}
        </span>
      )}
    </div>
  );
}

/** The widget definition handed to `createWidgets` (form = defaults + a threshold section). */
export const kpiThresholdDefinition: any = {
  id: KPI_WIDGET_ID,
  label: "Threshold KPI",
  icon: { url: "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 18h16"/><path d="M6 14l4-4 3 3 5-6"/><circle cx="18" cy="7" r="1.5"/></svg>',
  ) },
  dataMapping: {
    value: { type: "field", supportedRoles: ["numeric"], requires: { cardinality: "one" }, required: true },
  },
  form: (params: any) => {
    const form = params.createDefaults({ dataMappingItems: [{ key: "value", label: "Value" }] });
    const section = {
      type: "section",
      key: "cb-threshold",
      label: "Threshold",
      defaultExpanded: true,
      items: [
        { type: "number", id: "format.style.threshold", label: "Threshold", defaultValue: 1.5, step: 0.1 },
        {
          type: "select", id: "format.style.goodWhen", label: "Healthy when", defaultValue: "below",
          items: [{ value: "below", label: "at or below the threshold" }, { value: "above", label: "at or above the threshold" }],
        },
        { type: "textfield", id: "format.style.unit", label: "Unit", defaultValue: "%" },
        { type: "number", id: "format.style.decimals", label: "Decimals", defaultValue: 2, min: 0, max: 4, step: 1 },
        { type: "textfield", id: "format.style.caption", label: "Caption", defaultValue: "" },
      ],
    };
    const firstTab = form?.items?.[0];
    if (firstTab?.items) firstTab.items.push(section);
    return form;
  },
  comp: KpiThresholdWidget,
  defaultSize: { width: 280, height: 150 },
  minSize: { width: 120, height: 96 },
};
