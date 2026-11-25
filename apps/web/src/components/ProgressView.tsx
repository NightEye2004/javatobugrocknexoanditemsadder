import { useEffect, useRef, useState } from "react";
import type { ProgressEvent } from "@geyser-converter/core";

interface LiveLogEntry extends ProgressEvent {
  time: number;
  stage: string;
}

export function ProgressView({
  stage,
  done,
  total,
  fileName,
  startedAt,
  logs,
  currentActivity,
  stageIndex,
  stageCount,
  onClearLogs,
}: {
  stage: string;
  done: number;
  total: number;
  fileName: string;
  startedAt: number;
  logs: LiveLogEntry[];
  currentActivity: string;
  stageIndex?: number;
  stageCount?: number;
  onClearLogs: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [logsOpen, setLogsOpen] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const overallPct = stageIndex !== undefined && stageCount !== undefined
    ? Math.round(((stageIndex - 1 + (total > 0 ? done / total : 0)) / stageCount) * 100)
    : undefined;
  const elapsedSeconds = Math.floor((now - startedAt) / 1000);
  const elapsed = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}`;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [logs.length]);

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: 24,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Converting {fileName}…</div>
        <div style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{elapsed} elapsed</div>
      </div>

      <div style={{ color: "var(--muted)", margin: "12px 0 6px" }}>
        {stageIndex !== undefined && stageCount !== undefined
          ? `Step ${stageIndex}/${stageCount}: ${stage}`
          : `Stage: ${stage}`}
        {total > 0 && ` (${done}/${total})`}
      </div>
      <div style={{ background: "var(--bg)", borderRadius: 6, height: 8, overflow: "hidden" }}>
        <div
          style={{
            width: `${overallPct ?? pct}%`,
            height: "100%",
            background: "var(--accent)",
            transition: "width 0.15s ease",
          }}
        />
      </div>

      <div
        aria-live="polite"
        style={{
          marginTop: 14,
          padding: "12px 14px",
          background: "var(--bg)",
          borderRadius: 8,
          fontSize: 13,
          wordBreak: "break-word",
        }}
      >
        <span style={{ color: "var(--muted)" }}>Current activity: </span>{currentActivity}
      </div>

      <div style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => setLogsOpen((open) => !open)}
            style={{ background: "transparent", color: "var(--text)", border: "none", cursor: "pointer", padding: 0 }}
          >
            {logsOpen ? "▾" : "▸"} Live log ({logs.length}{logs.length === 500 ? "+" : ""})
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>Keeps the latest 500 events</span>
            <button
              onClick={onClearLogs}
              disabled={logs.length === 0}
              style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}
            >
              Clear
            </button>
          </div>
        </div>

        {logsOpen && (
          <div
            role="log"
            aria-live="off"
            style={{
              marginTop: 10,
              height: 290,
              overflow: "auto",
              background: "var(--bg)",
              borderRadius: 8,
              padding: 10,
              fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
              fontSize: 12,
            }}
          >
            {logs.length === 0 && <span style={{ color: "var(--muted)" }}>Log cleared. New events will appear here.</span>}
            {logs.map((entry, index) => (
              <div
                key={`${entry.time}-${index}`}
                style={{
                  padding: "3px 0",
                  color: entry.type === "error"
                    ? "var(--err)"
                    : entry.type === "warning"
                      ? "var(--warn)"
                      : entry.type === "stage"
                        ? "var(--accent)"
                        : "var(--text)",
                  borderBottom: "1px solid color-mix(in srgb, var(--border) 45%, transparent)",
                  wordBreak: "break-word",
                }}
              >
                <span style={{ color: "var(--muted)" }}>
                  {new Date(entry.time).toLocaleTimeString()} [{entry.stage}]
                </span>{" "}
                {entry.type === "warning" ? "⚠ " : entry.type === "error" ? "✖ " : ""}
                {entry.message}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}
