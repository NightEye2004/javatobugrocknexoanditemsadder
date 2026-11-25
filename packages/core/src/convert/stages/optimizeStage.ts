import type { ConversionContext, PipelineStage } from "../context.js";
import { parseLenientJson } from "../../java/json.js";
import { decodePng, encodePng } from "../../image/png.js";
import { zopfliRecompressPng } from "../../image/zopfliPng.js";
import { sha256 } from "@noble/hashes/sha2";

/**
 * Lossless pack optimizer (runs last, after every file is written):
 *
 * 1. Duplicate-texture merge: generated textures (textures/geyser_custom/**)
 *    with identical bytes collapse to one file; every JSON reference is
 *    rewritten to the surviving path. Only generated textures are merged —
 *    vanilla passthrough paths are looked up by fixed name and must stay put.
 * 2. Passthrough re-encode: textures copied verbatim from the Java pack keep
 *    whatever bloat the author's tool produced (unfiltered scanlines, text
 *    chunks). Re-encode them (filtered RGBA or indexed palette) and keep the
 *    smaller file — pixels stay bit-identical either way.
 * 3. Zopfli recompress: re-deflate every PNG's pixel stream with the zopfli
 *    wasm (exhaustive deflate; pixels bit-identical). Skipped in fast mode.
 * 4. JSON minify: every .json in the pack re-emitted without whitespace.
 *
 * Every transform is lossless for the client: same pixels, same parsed JSON.
 * Disable with optimizePack: false.
 */
/** Only zopfli PNGs at least this large — below it the byte win isn't worth the time. */
const ZOPFLI_MIN_BYTES = 4096;

export const optimizeStage: PipelineStage = {
  name: "optimize",
  async run(ctx: ConversionContext): Promise<void> {
    if (!ctx.options.optimizePack) return;

    const before = packSize(ctx);

    // --- 0. Remove copied custom-namespace source textures unreachable from
    // any generated Bedrock JSON. Item/block models are baked into generated
    // atlases earlier; font and armor textures are likewise emitted under
    // dedicated output paths. Keep a copied texture whenever output JSON
    // explicitly references it, so future output features remain compatible.
    const referencedStrings = new Set<string>();
    for (const path of ctx.bedrock.list({ suffix: ".json" })) {
      const text = ctx.bedrock.readText(path);
      if (text === undefined) continue;
      try {
        collectStrings(parseLenientJson(text), referencedStrings);
      } catch {
        // An unreadable output JSON cannot establish a reference. Keep
        // candidate textures conservatively if any JSON failed to parse.
        referencedStrings.add("*");
      }
    }
    let prunedTextures = 0;
    let prunedTextureBytes = 0;
    if (!referencedStrings.has("*")) {
      for (const source of ctx.java.list({ prefix: "assets/", suffix: ".png" })) {
        const match = source.match(/^assets\/([^/]+)\/textures\/(.+\.png)$/);
        if (match === null || match[1] === "minecraft") continue;
        const outputPath = `textures/${match[1]}/${match[2]}`;
        const bytes = ctx.bedrock.read(outputPath);
        if (bytes === undefined || isTextureReferenced(outputPath, referencedStrings)) continue;
        ctx.bedrock.delete(outputPath);
        prunedTextures++;
        prunedTextureBytes += bytes.length;
        ctx.report.skipped(
          "optimize",
          source,
          `copied texture omitted because no emitted Bedrock JSON references ${outputPath}; model/item textures are already baked into generated output where supported`,
        );
      }
    }

    // --- 1. Merge duplicate generated textures. ---
    // References use the path without extension (attachables, item_texture,
    // terrain_texture, render controllers all point at "textures/..../name").
    const byHash = new Map<string, string>();
    const rewrites = new Map<string, string>();
    let merged = 0;
    for (const path of ctx.bedrock.list({ prefix: "textures/geyser_custom/", suffix: ".png" })) {
      const bytes = ctx.bedrock.read(path)!;
      const hash = hex(sha256(bytes));
      const canonical = byHash.get(hash);
      if (canonical === undefined) {
        byHash.set(hash, path);
      } else {
        ctx.bedrock.delete(path);
        rewrites.set(stripExt(path), stripExt(canonical));
        merged++;
      }
    }

    // --- 2. Re-encode passthrough textures, keep the smaller encode. ---
    // Generated textures (geyser_custom) were born from encodePng and are
    // already optimal; everything else came straight from the Java pack.
    let reencoded = 0;
    for (const path of ctx.bedrock.list({ suffix: ".png" })) {
      if (path.startsWith("textures/geyser_custom/")) continue;
      const bytes = ctx.bedrock.read(path)!;
      try {
        const smaller = encodePng(decodePng(bytes));
        if (smaller.length < bytes.length) {
          ctx.bedrock.write(path, smaller);
          reencoded++;
        }
      } catch {
        // Undecodable/exotic PNG — ship the original untouched.
      }
    }

    // --- 3. Rewrite references + minify all JSON. ---
    for (const path of ctx.bedrock.list({ suffix: ".json" })) {
      const text = ctx.bedrock.readText(path);
      if (text === undefined) continue;
      let value: unknown;
      try {
        value = parseLenientJson(text);
      } catch {
        continue; // never corrupt a file we can't parse
      }
      if (rewrites.size > 0) value = rewriteStrings(value, rewrites);
      ctx.bedrock.writeText(path, JSON.stringify(value));
    }

    // --- 4. Opt-in zopfli recompression of larger PNGs (maxCompression). ---
    // Off by default: zopfli's single-threaded wasm is ~0.7s per file, so a
    // big pack costs minutes for ~12% off large textures (a few % of the whole
    // pack). Gated to files above a floor so the time is spent where the
    // absolute savings actually are (atlases / HD / flipbook frames).
    let zopflied = 0;
    if (ctx.options.maxCompression) {
      const candidates = ctx.bedrock
        .list({ suffix: ".png" })
        .filter((p) => ctx.bedrock.read(p)!.length >= ZOPFLI_MIN_BYTES);
      let done = 0;
      for (const path of candidates) {
        done++;
        ctx.progress("optimize", done, candidates.length);
        const bytes = ctx.bedrock.read(path)!;
        try {
          const smaller = await zopfliRecompressPng(bytes);
          if (smaller !== undefined) {
            ctx.bedrock.write(path, smaller);
            zopflied++;
          }
        } catch {
          // Zopfli failed on this file — ship what we had.
        }
      }
      if (candidates.length > 0) ctx.progress("optimize", candidates.length, candidates.length);
    }

    const after = packSize(ctx);
    if (before > after) {
      const zopfliNote = ctx.options.maxCompression
        ? `${zopflied} large texture(s) zopfli-recompressed`
        : "zopfli off (enable max compression for ~12% more off large textures)";
      ctx.report.converted("optimize", "lossless pack optimization", [
        `${prunedTextures} unreachable copied texture(s) omitted (${formatBytes(prunedTextureBytes)}), ${merged} duplicate texture(s) merged, ${reencoded} texture(s) re-encoded smaller, ${zopfliNote}, JSON minified — ${formatBytes(before - after)} saved (${before} → ${after} bytes uncompressed)`,
      ]);
    }
  },
};

function stripExt(path: string): string {
  return path.replace(/\.png$/, "");
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function packSize(ctx: ConversionContext): number {
  let total = 0;
  for (const path of ctx.bedrock.list()) total += ctx.bedrock.read(path)!.length;
  return total;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/** Recursively replace string values that exactly match a rewritten texture path. */
function rewriteStrings(value: unknown, rewrites: Map<string, string>): unknown {
  if (typeof value === "string") {
    return rewrites.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => rewriteStrings(v, rewrites));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = rewriteStrings(v, rewrites);
    }
    return out;
  }
  return value;
}

function collectStrings(value: unknown, strings: Set<string>): void {
  if (typeof value === "string") {
    strings.add(value.replace(/\\/g, "/"));
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, strings);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, strings);
  }
}

function isTextureReferenced(path: string, references: Set<string>): boolean {
  const withoutExtension = stripExt(path);
  return references.has(path) || references.has(withoutExtension);
}
