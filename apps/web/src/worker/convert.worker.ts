/// <reference lib="webworker" />
import { expose } from "comlink";
import {
  convertPack,
  parseOraxenConfigZips,
  type ConvertOptions,
  type ConvertResult,
  type ProgressEvent,
} from "@geyser-converter/core";

export interface WorkerApi {
  convert(
    zipBytes: Uint8Array,
    options: Partial<ConvertOptions>,
    onProgress: (stage: string, done: number, total: number, event?: ProgressEvent) => void,
    /** Optional plugin config zips (Nexo/Oraxen/ItemsAdder/HMCCosmetics, any mix). */
    configZips?: Uint8Array[],
    /** Selected format profile; plugin profiles expect their item configs as well as the asset pack. */
    packSource?: "regular" | "nexo" | "itemsadder",
  ): Promise<ConvertResult & { hintCount?: number }>;
}

const api: WorkerApi = {
  async convert(zipBytes, options, onProgress, configZips, packSource = "regular") {
    let hintCount: number | undefined;
    if (configZips !== undefined && configZips.length > 0) {
      const hints = parseOraxenConfigZips(configZips);
      options = {
        ...options,
        baseItemHints: hints.baseItems,
        displayNameHints: hints.displayNames,
        equippableHints: hints.equippables,
        cmdItemKeys: hints.cmdKeys,
        colorHints: hints.colors,
        backpackItems: hints.backpacks,
        furnitureItems: hints.furniture,
      };
      hintCount = hints.items;
    }
    if (packSource !== "regular" && (hintCount ?? 0) === 0) {
      const label = packSource === "nexo" ? "Nexo" : "ItemsAdder";
      onProgress("source-check", 0, 0, {
        type: "warning",
        message: `${label} selected, but no plugin item configs were recognized. Attach a ZIP containing that server's item YAML configs; otherwise many mappings may fall back to ${options.modernBaseItem ?? "minecraft:paper"}.`,
      });
    }
    const result = await convertPack(zipBytes, options, (stage, done, total, event) => {
      onProgress(stage, done, total, event);
    });
    return { ...result, hintCount };
  },
};

expose(api);
