import { useCallback, useEffect, useRef, useState } from "react";
import { wrap, proxy, type Remote } from "comlink";
import type { ConvertResult, ProgressEvent } from "@geyser-converter/core";
import type { WorkerApi } from "./worker/convert.worker.js";
import { DropZone } from "./components/DropZone.js";
import { ProgressView } from "./components/ProgressView.js";
import { ResultView } from "./components/ResultView.js";

type Phase =
  | { kind: "idle" }
  | {
      kind: "converting";
      stage: string;
      done: number;
      total: number;
      fileName: string;
      startedAt: number;
      logs: LiveLogEntry[];
      currentActivity: string;
      stageIndex?: number;
      stageCount?: number;
    }
  | { kind: "done"; result: ConvertResult; fileName: string; packName: string }
  | { kind: "error"; message: string };

interface LiveLogEntry {
  time: number;
  type: ProgressEvent["type"];
  stage: string;
  message: string;
}

const MAX_LIVE_LOGS = 500;
type PackSource = "regular" | "nexo" | "itemsadder";

function appendLiveLog(logs: LiveLogEntry[], stage: string, event: ProgressEvent): LiveLogEntry[] {
  return [...logs, { time: Date.now(), stage, ...event }].slice(-MAX_LIVE_LOGS);
}

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [attachableMaterial, setAttachableMaterial] = useState("entity_alphatest_one_sided");
  const [modernBaseItem, setModernBaseItem] = useState("minecraft:paper");
  const [maxAnimationFrames, setMaxAnimationFrames] = useState(0);
  const [disableAnimations, setDisableAnimations] = useState(false);
  const [maxTextureResolution, setMaxTextureResolution] = useState(0);
  const [interactiveChatIcons, setInteractiveChatIcons] = useState(false);
  const [backMountedItems, setBackMountedItems] = useState("");
  const [offhandCosmeticYOffset, setOffhandCosmeticYOffset] = useState(12);
  const [packSource, setPackSource] = useState<PackSource>("regular");
  const [optimizePack, setOptimizePack] = useState(true);
  const [maxCompression, setMaxCompression] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [configZips, setConfigZips] = useState<{ name: string; bytes: Uint8Array }[]>([]);
  const [selectedPack, setSelectedPack] = useState<File | null>(null);
  const needsPluginConfigs = packSource !== "regular";
  const canStartConversion = !needsPluginConfigs || configZips.length > 0;
  const workerRef = useRef<Remote<WorkerApi> | null>(null);

  const getWorker = useCallback((): Remote<WorkerApi> => {
    if (workerRef.current === null) {
      const worker = new Worker(new URL("./worker/convert.worker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = wrap<WorkerApi>(worker);
    }
    return workerRef.current;
  }, []);

  const handleFile = useCallback((file: File) => {
    setSelectedPack(file);
    setPhase({ kind: "idle" });
  }, []);

  const handleConvert = useCallback(
    async () => {
      if (!selectedPack || !canStartConversion) return;
      const file = selectedPack;
      const packName = file.name.replace(/\.(zip|mcpack)$/i, "");
      const startedAt = Date.now();
      setPhase({
        kind: "converting",
        stage: "reading file",
        done: 0,
        total: 1,
        fileName: file.name,
        startedAt,
        logs: [{ time: startedAt, type: "stage", stage: "input", message: `Reading ${file.name}` }],
        currentActivity: "Reading input file",
      });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const api = getWorker();
        const result = await api.convert(
          bytes,
          { packName, attachableMaterial, modernBaseItem, maxAnimationFrames, disableAnimations, maxTextureResolution, interactiveChatIcons, optimizePack, maxCompression, backMountedItems: backMountedItems.split(",").map((item) => item.trim()).filter(Boolean), offhandCosmeticYOffset },
          proxy((stage: string, done: number, total: number, event?: ProgressEvent) => {
            setPhase((current) => {
              if (current.kind !== "converting") return current;
              const logs = event === undefined ? current.logs : appendLiveLog(current.logs, stage, event);
              const logOnly = event?.type === "warning" || event?.type === "error";
              return {
                ...current,
                ...(logOnly ? {} : { stage, done, total }),
                logs,
                currentActivity: event?.message ?? current.currentActivity,
                ...(event?.stageIndex !== undefined ? { stageIndex: event.stageIndex } : {}),
                ...(event?.stageCount !== undefined ? { stageCount: event.stageCount } : {}),
              };
            });
          }),
          configZips.map((c) => c.bytes),
          packSource,
        );
        setPhase({ kind: "done", result, fileName: file.name, packName });
      } catch (err) {
        setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    },
    [getWorker, selectedPack, canStartConversion, attachableMaterial, modernBaseItem, maxAnimationFrames, disableAnimations, maxTextureResolution, interactiveChatIcons, optimizePack, maxCompression, backMountedItems, offhandCosmeticYOffset, configZips, packSource],
  );

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 20px" }}>
      <header style={{ textAlign: "center", marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 32 }}>
          Geyser<span style={{ color: "var(--accent)" }}>Converter</span>
        </h1>
        <p style={{ color: "var(--muted)", marginTop: 8 }}>
          Java Edition resource pack → Bedrock pack + Geyser mappings. Everything runs in your
          browser — files never leave your PC.
        </p>
      </header>

      {phase.kind === "idle" && (
        <>
          <section style={sectionStyle}>
            <StepHeading number="1" title="Choose the pack source" />
            <label style={labelStyle}>
              Which plugin generated this resource pack?
              <select
                value={packSource}
                onChange={(e) => {
                  setPackSource(e.target.value as PackSource);
                  setConfigZips([]);
                }}
                style={inputStyle}
              >
                <option value="regular">Regular Java resource pack</option>
                <option value="nexo">Nexo generated pack</option>
                <option value="itemsadder">ItemsAdder generated pack</option>
              </select>
            </label>
            <p style={helpTextStyle}>
              Select the plugin that made the ZIP you’re converting. Each server’s pack and configs should stay together.
            </p>
          </section>

          {needsPluginConfigs ? (
            <section style={sectionStyle}>
              <StepHeading number="2" title="Add the matching item configs" />
              <p style={helpTextStyle}>
                Required for correct Geyser item mappings. Upload a ZIP of the <code>items/</code> folder from the same server as this pack.
                For Nexo, that is usually <code>plugins/Nexo/items/</code>.
              </p>
              <ConfigZipPicker configZips={configZips} setConfigZips={setConfigZips} />
            </section>
          ) : (
            <details style={{ ...sectionStyle, padding: "14px 18px" }}>
              <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: 14 }}>
                Optional: add plugin configs for item names and mappings
              </summary>
              <p style={helpTextStyle}>
                If this regular pack is used with Nexo, ItemsAdder, Oraxen, or HMCCosmetics, add the matching server config ZIP.
              </p>
              <ConfigZipPicker configZips={configZips} setConfigZips={setConfigZips} />
            </details>
          )}

          <section>
            <StepHeading number={needsPluginConfigs ? "3" : "2"} title="Choose the generated resource pack" />
            <DropZone onFile={handleFile} disabled={!canStartConversion} />
            {selectedPack && canStartConversion && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
                <span role="status" style={{ color: "var(--muted)", fontSize: 13 }}>
                  Selected: <strong style={{ color: "var(--text)" }}>{selectedPack.name}</strong>
                </span>
                <button type="button" onClick={handleConvert} style={buttonStyle}>
                  Convert pack
                </button>
              </div>
            )}
            {!canStartConversion && (
              <p role="status" style={{ color: "var(--warn)", margin: "10px 4px 0", fontSize: 13 }}>
                Add the matching plugin config ZIP above to continue.
              </p>
            )}
          </section>

          <section style={sectionStyle}>
            <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>Quick output settings</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <label style={labelStyle}>
                Animated textures
                <select value={disableAnimations ? 1 : 0} onChange={(e) => setDisableAnimations(e.target.value === "1")} style={inputStyle}>
                  <option value={0}>Keep animations</option>
                  <option value={1}>Disable animations (first frame only)</option>
                </select>
              </label>
              <label style={labelStyle}>
                Maximum texture size
                <select value={maxTextureResolution} onChange={(e) => setMaxTextureResolution(Number(e.target.value))} style={inputStyle}>
                  <option value={0}>Original resolution</option>
                  <option value={2048}>2048 px</option>
                  <option value={1024}>1024 px</option>
                  <option value={512}>512 px</option>
                  <option value={256}>256 px</option>
                  <option value={128}>128 px</option>
                </select>
                <span style={{ fontSize: 12 }}>Smaller textures use less memory but lose detail.</span>
              </label>
              <label style={{ ...labelStyle, display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={interactiveChatIcons}
                  onChange={(e) => setInteractiveChatIcons(e.target.checked)}
                />
                Also create InteractiveChatDiscordSrvAddon icon pack (2D icons only)
              </label>
            </div>
          </section>

          <div style={{ marginTop: 4 }}>
            <button
              onClick={() => setShowOptions((v) => !v)}
              aria-expanded={showOptions}
              style={{
                background: "transparent",
                color: "var(--muted)",
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                padding: "8px 2px",
              }}
            >
              {showOptions ? "▾" : "▸"} Advanced options
            </button>
            {showOptions && (
              <div style={{ ...sectionStyle, display: "grid", gap: 12 }}>
                <label style={labelStyle}>
                  Attachable material (3D items)
                  <select
                    value={attachableMaterial}
                    onChange={(e) => setAttachableMaterial(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="entity_alphatest_one_sided">entity_alphatest_one_sided (default)</option>
                    <option value="entity_alphatest">entity_alphatest</option>
                    <option value="entity">entity (opaque)</option>
                    <option value="entity_alphablend">entity_alphablend</option>
                  </select>
                </label>
                <label style={labelStyle}>
                  Fallback base item for modern item-model assets
                  <input
                    value={modernBaseItem}
                    onChange={(e) => setModernBaseItem(e.target.value)}
                    style={inputStyle}
                    placeholder="minecraft:paper"
                  />
                </label>
                <label style={labelStyle}>
                  Selected offhand cosmetics
                  <input
                    value={backMountedItems}
                    onChange={(e) => setBackMountedItems(e.target.value)}
                    style={inputStyle}
                    placeholder="radiance_collection/wings"
                  />
                  <span style={{ fontSize: 12 }}>Comma-separated model IDs. Keeps the Java offhand transform for other players and shows a hand fallback if first person is hidden.</span>
                </label>
                <label style={labelStyle}>
                  Raise selected offhand cosmetics
                  <input
                    type="number"
                    min={-32}
                    max={32}
                    step={1}
                    value={offhandCosmeticYOffset}
                    onChange={(e) => setOffhandCosmeticYOffset(Number(e.target.value))}
                    style={inputStyle}
                  />
                  <span style={{ fontSize: 12 }}>Positive values move the model upward. Bedrock geometry units; default 12.</span>
                </label>
                <label style={labelStyle}>
                  Animation frame limit
                  <select value={maxAnimationFrames} onChange={(e) => setMaxAnimationFrames(Number(e.target.value))} style={inputStyle}>
                    <option value={0}>Full animation</option>
                    <option value={20}>20 frames</option>
                    <option value={10}>10 frames</option>
                    <option value={5}>5 frames</option>
                    <option value={1}>1 frame</option>
                  </select>
                  <span style={{ fontSize: 12 }}>Limits long flipbooks; disable animations above to use only the first frame.</span>
                </label>
                <label style={{ ...labelStyle, display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={disableAnimations}
                    onChange={(e) => setDisableAnimations(e.target.checked)}
                  />
                  Disable animated textures — keep the first frame and omit item and block flipbooks
                </label>
                <label style={{ ...labelStyle, display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={optimizePack}
                    onChange={(e) => setOptimizePack(e.target.checked)}
                  />
                  Lossless pack optimization — minify JSON + merge duplicate textures (never changes
                  what players see)
                </label>
                {optimizePack && (
                  <label style={{ ...labelStyle, display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={maxCompression}
                      onChange={(e) => setMaxCompression(e.target.checked)}
                    />
                    Maximum compression (very slow) — zopfli-recompress large textures for ~12% more
                    off them. Adds minutes on big packs; leave off unless every KB matters.
                  </label>
                )}
              </div>
            )}
          </div>
        </>
      )}
      {phase.kind === "converting" && (
        <ProgressView
          stage={phase.stage}
          done={phase.done}
          total={phase.total}
          fileName={phase.fileName}
          startedAt={phase.startedAt}
          logs={phase.logs}
          currentActivity={phase.currentActivity}
          stageIndex={phase.stageIndex}
          stageCount={phase.stageCount}
          onClearLogs={() => setPhase((current) => current.kind === "converting" ? { ...current, logs: [] } : current)}
        />
      )}
      {phase.kind === "done" && (
        <ResultView
          result={phase.result}
          packName={phase.packName}
          onReset={() => setPhase({ kind: "idle" })}
        />
      )}
      {phase.kind === "error" && (
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--err)",
            borderRadius: 12,
            padding: 24,
          }}
        >
          <strong style={{ color: "var(--err)" }}>Conversion failed</strong>
          <p style={{ color: "var(--muted)" }}>{phase.message}</p>
          <button onClick={() => setPhase({ kind: "idle" })} style={buttonStyle}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function StepHeading({ number, title }: { number: string; title: string }) {
  return (
    <h2 style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 16, margin: "0 0 12px", color: "var(--text)" }}>
      <span style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)", fontSize: 13 }}>
        {number}
      </span>
      {title}
    </h2>
  );
}

function ConfigZipPicker({
  configZips,
  setConfigZips,
}: {
  configZips: { name: string; bytes: Uint8Array }[];
  setConfigZips: React.Dispatch<React.SetStateAction<{ name: string; bytes: Uint8Array }[]>>;
}) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <label style={{ ...labelStyle, color: "var(--text)" }}>
        Plugin config ZIPs <span style={{ color: "var(--muted)", fontWeight: 400 }}>(one or more)</span>
        <input
          type="file"
          accept=".zip"
          multiple
          style={{ ...inputStyle, padding: 8, width: "100%", maxWidth: "100%", boxSizing: "border-box" }}
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            const loaded = await Promise.all(files.map(async (file) => ({
              name: file.name,
              bytes: new Uint8Array(await file.arrayBuffer()),
            })));
            setConfigZips(loaded);
            e.target.value = "";
          }}
        />
      </label>
      {configZips.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", color: "var(--accent)", fontSize: 13 }}>
          <span>✓ {configZips.map((c) => c.name).join(", ")}</span>
          <button type="button" onClick={() => setConfigZips([])} style={{ ...quietButtonStyle, color: "var(--muted)" }}>
            Remove configs
          </button>
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  fontSize: 13,
  color: "var(--muted)",
};

const sectionStyle: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 18,
  marginBottom: 16,
};

const helpTextStyle: React.CSSProperties = {
  color: "var(--muted)",
  margin: "8px 0 12px",
  fontSize: 13,
  lineHeight: 1.55,
};

const quietButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 7,
  padding: "5px 9px",
  cursor: "pointer",
  fontSize: 12,
};

const inputStyle: React.CSSProperties = {
  background: "var(--bg)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 14,
};

export const buttonStyle: React.CSSProperties = {
  background: "var(--accent)",
  color: "#0f1115",
  border: "none",
  borderRadius: 8,
  padding: "10px 20px",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};
