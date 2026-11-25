import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { convertPack, readZip } from "../src/index.js";

const benchmark = process.env.CONVERTER_BENCH_PACK ? it : it.skip;

benchmark("benchmarks a supplied real ItemsAdder pack", async () => {
  const sourcePath = process.env.CONVERTER_BENCH_PACK!;
  const input = new Uint8Array(readFileSync(sourcePath));
  const started = performance.now();
  const result = await convertPack(input, { packName: "ItemsAdder benchmark", maxAnimationFrames: 20 });
  const elapsedMs = performance.now() - started;
  const output = readZip(result.mcpack);
  const paths = output.list();
  const jsonPaths = output.list({ suffix: ".json" });
  let invalidJson = 0;
  let outputUncompressedBytes = 0;
  for (const path of paths) outputUncompressedBytes += output.read(path)!.length;
  for (const path of jsonPaths) {
    try { JSON.parse(output.readText(path)!); } catch { invalidJson++; }
  }

  let texturePixels = 0;
  let maxTextureSide = 0;
  let texturesOver2048 = 0;
  const pngPaths = output.list({ suffix: ".png" });
  for (const path of pngPaths) {
    const bytes = output.read(path)!;
    if (bytes.length < 24) continue;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    texturePixels += width * height;
    maxTextureSide = Math.max(maxTextureSide, width, height);
    if (width > 2048 || height > 2048) texturesOver2048++;
  }

  const errors = result.report.entries.filter((entry) => entry.status === "error");
  const pruneCount = result.report.entries.filter(
    (entry) => entry.stage === "optimize" && entry.status === "skipped" &&
      entry.detail?.includes("no emitted Bedrock JSON references"),
  ).length;
  const optimizerSummary = result.report.entries.find(
    (entry) => entry.stage === "optimize" && entry.status === "converted" && entry.source === "lossless pack optimization",
  )?.outputs?.[0];

  console.log("REAL_PACK_BENCHMARK", JSON.stringify({
    sourcePath,
    inputBytes: input.length,
    outputBytes: result.mcpack.length,
    outputUncompressedBytes,
    outputFiles: paths.length,
    outputJson: jsonPaths.length,
    invalidJson,
    pngFiles: pngPaths.length,
    decodedRgbaEstimateBytes: texturePixels * 4,
    maxTextureSide,
    texturesOver2048,
    elapsedMs: Math.round(elapsedMs),
    timings: result.timings,
    summary: result.report.summary,
    errors,
    prunedTextures: pruneCount,
    optimizerSummary,
  }));

  expect(output.has("manifest.json")).toBe(true);
  expect(invalidJson).toBe(0);
}, 30 * 60 * 1000);
