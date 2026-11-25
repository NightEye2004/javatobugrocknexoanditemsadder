import { sha256 } from "@noble/hashes/sha2";
import { alphaBleed, compositeLayers, decodePng, encodePng, firstFrame, tint, type RgbaImage } from "../image/png.js";
import { renderModelIcon } from "../image/modelRender.js";
import { defaultUv } from "../bedrock/geometry.js";
import { writeZip } from "../io/zip.js";
import { VirtualFs } from "../io/vfs.js";
import { extractLegacyVariants, extractModernVariants, type ItemVariant } from "../java/itemVariants.js";
import { parseResourceLocation, type JavaPack } from "../java/javaPack.js";
import type { JavaElement, JavaFaceName } from "../java/model.js";
import { resolveModel, spriteLayers, type ResolvedModel } from "../resolve/modelResolver.js";
import type { ConversionReport } from "../report/report.js";

const ICON_NAMESPACE = "geyser_converter";

/** Build a minimal Java resource-pack overlay for InteractiveChatDiscordSrvAddon. */
export function buildIcdsaIconPack(
  java: JavaPack,
  options: {
    packName: string;
    cmdItemKeys: Record<string, string>;
    colorHints: Record<string, number>;
  },
  report: ConversionReport,
): Uint8Array {
  const out = new VirtualFs();
  const extracted = [...extractLegacyVariants(java).variants, ...extractModernVariants(java).variants];
  const modelIconRefs = new Map<string, string>();
  const modelIconCache = new Map<string, { model: string; texture: string; bytes: Uint8Array } | undefined>();
  const modelFiles = new Map<string, object>();
  const textureFiles = new Map<string, Uint8Array>();
  let converted = 0;

  for (const variant of extracted) {
    const icon = makeIcon(java, variant, options, modelIconCache);
    if (icon === undefined) {
      report.skipped("icdsa-icons", `${variant.origin} → ${variant.model}`, "no usable 2D icon could be generated for this model");
      continue;
    }
    const isNewModel = !modelIconRefs.has(variant.model);
    modelIconRefs.set(variant.model, icon.model);
    modelFiles.set(icon.model, {
      parent: "minecraft:item/generated",
      textures: { layer0: icon.texture },
    });
    textureFiles.set(icon.texture, icon.bytes);
    if (isNewModel) converted++;
  }

  // Legacy custom_model_data variants point to models from vanilla item overrides.
  for (const path of java.list({ prefix: "assets/minecraft/models/item/", suffix: ".json" })) {
    const model = java.readJson<Record<string, unknown>>(path);
    const overrides = model?.["overrides"];
    if (!Array.isArray(overrides)) continue;
    let changed = false;
    const mapped = overrides.map((entry) => {
      if (typeof entry !== "object" || entry === null) return entry;
      const row = entry as Record<string, unknown>;
      const modelId = row["model"];
      const replacement = typeof modelId === "string" ? modelIconRefs.get(modelId) : undefined;
      if (replacement === undefined) return entry;
      changed = true;
      return { ...row, model: replacement };
    });
    if (changed) out.writeJson(path, { ...model, overrides: mapped });
  }

  // Modern item definitions (1.21.4+) hold model leaves in a nested node tree.
  for (const path of java.list({ prefix: "assets/", suffix: ".json" })) {
    if (!/^assets\/[^/]+\/items\/.+\.json$/.test(path)) continue;
    const source = java.readJson<unknown>(path);
    const rewritten = replaceModelLeaves(source, modelIconRefs);
    if (rewritten.changed) out.writeJson(path, rewritten.value);
  }

  for (const [modelId, value] of modelFiles) {
    const loc = parseResourceLocation(modelId);
    out.writeJson(`assets/${loc.namespace}/models/${loc.path}.json`, value);
  }
  for (const [textureId, bytes] of textureFiles) {
    const loc = parseResourceLocation(textureId);
    out.write(`assets/${loc.namespace}/textures/${loc.path}.png`, bytes);
  }

  const packMeta = java.read("pack.mcmeta");
  if (packMeta !== undefined) {
    out.write("pack.mcmeta", packMeta);
  } else {
    out.writeJson("pack.mcmeta", {
      pack: { pack_format: 34, description: `${options.packName} - ICDSA icons only` },
    });
    report.approximated("icdsa-icons", "pack.mcmeta", "source pack had no pack.mcmeta; generated metadata using pack format 34");
  }
  const packIcon = java.read("pack.png");
  if (packIcon !== undefined) out.write("pack.png", packIcon);

  report.converted("icdsa-icons", "item model icon overlay", [
    `${converted} custom model icon(s) generated`,
    "contains only item definitions, 2D icon models, and icon textures; source 3D item model files are omitted",
  ]);
  return writeZip(out);
}

function makeIcon(
  java: JavaPack,
  variant: ItemVariant,
  options: { cmdItemKeys: Record<string, string>; colorHints: Record<string, number> },
  cache: Map<string, { model: string; texture: string; bytes: Uint8Array } | undefined>,
): { model: string; texture: string; bytes: Uint8Array } | undefined {
  if (cache.has(variant.model)) return cache.get(variant.model);
  const resolved = resolveModel(java, variant.model);
  if (resolved === undefined) {
    cache.set(variant.model, undefined);
    return undefined;
  }
  const id = shortHash(variant.model);
  const modelId = `${ICON_NAMESPACE}:icdsa_icons/${id}`;
  const textureId = `${ICON_NAMESPACE}:icdsa_icons/${id}`;
  let image: RgbaImage | undefined;
  if (resolved.kind === "geometry" && resolved.elements !== undefined) {
    const sourceTextures = new Map<string, RgbaImage>();
    const imageFor = (textureId: string): RgbaImage | undefined => {
      if (sourceTextures.has(textureId)) return sourceTextures.get(textureId);
      const path = java.assetPath("textures", textureId, ".png");
      const bytes = java.read(path);
      if (bytes === undefined) return undefined;
      try {
        const decoded = decodePng(bytes);
        sourceTextures.set(textureId, decoded);
        return decoded;
      } catch {
        return undefined;
      }
    };
    image = renderModelIcon(
      resolved.elements,
      (element: JavaElement, faceName: JavaFaceName) => {
        const face = element.faces?.[faceName];
        if (face === undefined) return undefined;
        const resource = resolveFaceTexture(resolved, face.texture);
        const source = resource !== undefined ? imageFor(resource) : undefined;
        return source !== undefined ? { image: source, uv: face.uv ?? defaultUv(faceName, element.from, element.to) } : undefined;
      },
      resolved.display.gui,
    );
  } else {
    const layers = spriteLayers(resolved);
    const images: RgbaImage[] = [];
    for (const layer of layers) {
      const bytes = java.read(java.assetPath("textures", layer, ".png"));
      if (bytes === undefined) continue;
      try {
        let source = decodePng(bytes);
        const mcmeta = java.readText(java.assetPath("textures", layer, ".png") + ".mcmeta");
        if (mcmeta !== undefined && source.height > source.width) source = firstFrame(source);
        images.push(source);
      } catch {
        // Leave malformed optional layers out and continue with readable ones.
      }
    }
    if (images.length > 0) {
      const colorKey = variant.baseItem !== undefined && variant.source.kind === "legacy"
        ? options.cmdItemKeys[`${variant.baseItem}|${variant.source.customModelData}`]
        : undefined;
      const color = colorKey !== undefined ? options.colorHints[colorKey] : undefined;
      if (color !== undefined) tint(images[0]!, color);
      image = compositeLayers(images);
    }
  }
  if (image === undefined) {
    cache.set(variant.model, undefined);
    return undefined;
  }
  alphaBleed(image);
  const result = { model: modelId, texture: textureId, bytes: encodePng(image) };
  cache.set(variant.model, result);
  return result;
}

function resolveFaceTexture(resolved: ResolvedModel, ref: string): string | undefined {
  let value = ref;
  const seen = new Set<string>();
  while (value.startsWith("#")) {
    const key = value.slice(1);
    if (seen.has(key)) return undefined;
    seen.add(key);
    const next = resolved.textures[key];
    if (next === undefined) return undefined;
    value = next;
  }
  return value;
}

function replaceModelLeaves(value: unknown, replacements: Map<string, string>): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const result = replaceModelLeaves(item, replacements);
      changed ||= result.changed;
      return result.value;
    });
    return { value: items, changed };
  }
  if (typeof value !== "object" || value === null) return { value, changed: false };
  const object = value as Record<string, unknown>;
  let changed = false;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(object)) {
    if (key === "model" && typeof item === "string") {
      const replacement = replacements.get(item);
      if (replacement !== undefined) {
        output[key] = replacement;
        changed = true;
        continue;
      }
    }
    const result = replaceModelLeaves(item, replacements);
    output[key] = result.value;
    changed ||= result.changed;
  }
  return { value: output, changed };
}

function shortHash(value: string): string {
  const digest = sha256(new TextEncoder().encode(value));
  return [...digest.slice(0, 10)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
