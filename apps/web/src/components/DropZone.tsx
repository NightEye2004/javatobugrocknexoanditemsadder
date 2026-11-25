import { useCallback, useRef, useState } from "react";

export function DropZone({ onFile, disabled = false }: { onFile: (file: File) => void; disabled?: boolean }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && !disabled) onFile(file);
    },
    [onFile, disabled],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      style={{
        border: `2px dashed ${dragging ? "var(--accent)" : "var(--border)"}`,
        background: dragging ? "var(--accent-dim)" : "var(--panel)",
        borderRadius: 16,
        padding: "44px 20px",
        textAlign: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.65 : 1,
        transition: "all 0.15s ease",
        outlineOffset: 4,
      }}
    >
      <div style={{ fontSize: 34, marginBottom: 10 }}>{disabled ? "🔒" : "📦"}</div>
      <div style={{ fontSize: 17, fontWeight: 600 }}>
        {disabled ? "Add the matching config ZIP first" : "Drop your resource pack ZIP here"}
      </div>
      <div style={{ color: "var(--muted)", marginTop: 6 }}>
        {disabled ? "This helps map cosmetics to the right server items." : "or click to browse · .zip or .mcpack"}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,.mcpack"
        disabled={disabled}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
