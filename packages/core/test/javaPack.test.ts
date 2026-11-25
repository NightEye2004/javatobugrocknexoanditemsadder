import { describe, expect, it } from "vitest";
import { JavaPack } from "../src/java/javaPack.js";
import { VirtualFs } from "../src/io/vfs.js";

describe("Java pack asset path resolution", () => {
  it("uses an existing exact namespace path before trying aliases", () => {
    const vfs = new VirtualFs();
    vfs.writeText("pack.mcmeta", "{}");
    vfs.writeText("assets/_example/textures/item/icon.png", "exact");
    vfs.writeText("assets/example/textures/item/icon.png", "alias");
    const pack = JavaPack.open(vfs);

    expect(pack.assetPath("textures", "_example:item/icon", ".png")).toBe(
      "assets/_example/textures/item/icon.png",
    );
  });

  it("resolves ItemsAdder-style underscored texture namespace aliases when present", () => {
    const vfs = new VirtualFs();
    vfs.writeText("pack.mcmeta", "{}");
    vfs.writeText("assets/example/textures/item/icon.png", "texture");
    const pack = JavaPack.open(vfs);

    expect(pack.assetPath("textures", "_example:item/icon", ".png")).toBe(
      "assets/example/textures/item/icon.png",
    );
  });

  it("leaves unresolved underscored identifiers unchanged", () => {
    const vfs = new VirtualFs();
    vfs.writeText("pack.mcmeta", "{}");
    const pack = JavaPack.open(vfs);

    expect(pack.assetPath("textures", "_example:item/icon", ".png")).toBe(
      "assets/_example/textures/item/icon.png",
    );
  });
});
