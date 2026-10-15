import { useEffect, useRef, useState } from "react";
import { api, esc, useScript } from "../api";

export default function Board() {
  const [rows, setRows] = useState<any[]>([]);
  const [statusline, setStatusline] = useState("loading disputes…");
  const boardDiv = useRef<HTMLDivElement>(null);
  const boardRef = useRef<any>(null);
  const tbReady = useScript("/vendor/taskboard/taskboard.umd.js", () => Boolean((window as any).bryntum?.taskboard?.TaskBoard));

  const daysLeft = (respondBy?: string) => {
    if (!respondBy) return null;
    return Math.ceil((Date.parse(respondBy) - Date.now()) / 864e5);
  };

  function eventsFor(list: any[]) {
    return (list || []).filter((d) => d.disputeId).map((d) => {
      const left = daysLeft(d.respondBy);
      return {
        id: d.disputeId,
        name: (d.reason || "dispute").toLowerCase().replaceAll("_", " "),
        status: String(d.status || "").includes("RESOLVED")
          ? (String(d.status).toLowerCase().includes("won") ? "RESOLVED_WON" : "RESOLVED_LOST")
          : String(d.status || "").includes("REVIEW") ? "UNDER_REVIEW"
          : String(d.status || "").includes("WAITING") ? "WAITING" : "OPEN",
        eventColor: left !== null && left <= 3 ? "red" : "indigo",
        amount: d.amount != null ? "$" + d.amount + " " + (d.currency ?? "") : "",
        respondBy: d.respondBy ? new Date(d.respondBy).toLocaleDateString() : "",
        left: left !== null ? Math.max(left, 0) + "d left" : "",
        receiptId: d.linkedReceiptId ?? "",
        stage: d.stage ?? "",
      };
    });
  }

  useEffect(() => {
    api<{ source: string; disputes: any[] }>("/api/disputes")
      .then((data) => {
        setRows(data.disputes ?? []);
        setStatusline((data.disputes ?? []).length + " dispute(s) · " +
          (data.source === "paypal" ? "live PayPal sandbox cases" : "mock rows from your receipts") +
          " · live feed — the kanban of the 10-day response workflow");
      })
      .catch((e) => setStatusline("error: " + e.message));
    const stream = new EventSource("/api/stream");
    stream.onmessage = (msg) => {
      try {
        const snap = JSON.parse(msg.data);
        if (Array.isArray(snap.disputes)) setRows(snap.disputes);
      } catch { /* malformed frame */ }
    };
    return () => stream.close();
  }, []);

  useEffect(() => {
    if (!tbReady || !boardDiv.current || boardRef.current) return;
    const TaskBoard = (window as any).bryntum.taskboard.TaskBoard;
    boardRef.current = new TaskBoard({
      appendTo: boardDiv.current,
      columns: [
        { id: "OPEN", text: "Open" }, { id: "UNDER_REVIEW", text: "Under review" }, { id: "WAITING", text: "Waiting" },
        { id: "RESOLVED_WON", text: "Resolved — won" }, { id: "RESOLVED_LOST", text: "Resolved — lost" },
      ],
      columnField: "status",
      readOnly: true,
      project: {
        eventStore: { data: eventsFor(rows), fields: ["amount", "respondBy", "left", "receiptId", "stage"] },
        resources: [{ id: "merchant", name: "Merchant disputes" }],
      },
      taskRenderer: ({ taskRecord, cardConfig }: any) => {
        // v7: mutate cardConfig — a returned string is ignored
        cardConfig.html = `
        <div class="tb-card">
        <div class="tb-title">${esc(taskRecord.name)}</div>
        <div class="tb-id">${esc(taskRecord.id)}</div>
        <div class="tb-meta">
          ${taskRecord.amount ? "<b>" + esc(taskRecord.amount) + "</b>" : ""}
          ${taskRecord.respondBy ? (taskRecord.amount ? " · " : "") + "⚖ " + esc(taskRecord.respondBy) : ""}
          ${taskRecord.left ? '<span class="' + (taskRecord.eventColor === "red" ? "tb-hot" : "tb-ok") + '">' + esc(taskRecord.left) + "</span>" : ""}
        </div>
        <div class="tb-actions">
          ${taskRecord.receiptId ? '<a href="/verify/' + encodeURIComponent(taskRecord.receiptId) + '" target="_blank" rel="noopener">verify receipt →</a>' : ""}
          <a href="/api/disputes/${encodeURIComponent(taskRecord.id)}/evidence-pack" target="_blank" rel="noopener">evidence ↓</a>
          <a href="/dashboard">cockpit →</a>
        </div>
        </div>`;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tbReady]);

  useEffect(() => {
    if (boardRef.current) boardRef.current.project.eventStore.data = eventsFor(rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(rows)]);

  return (
    <>
      <p className="statusline">{statusline}</p>
      <div ref={boardDiv} style={{ minHeight: 420 }} />
    </>
  );
}
