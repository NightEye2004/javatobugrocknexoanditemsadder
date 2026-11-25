# Decisions

## Existing converter as the source code base

- **Decision:** Continue the existing TypeScript monorepo rather than creating a second converter in the empty project folder.
- **Reason:** The clone already contains the Java pack parser, conversion pipeline, Bedrock emitters, test suite, web UI, and API. This follows the project rule to maintain one shared codebase.
- **Scope:** Keep this project Geyser Custom Items API v2 focused, as requested. Desktop packaging and native standalone Bedrock item behavior are outside this decision.
- **Date:** 2026-11-13

## Prune only unreachable copied custom textures

- **Decision:** During lossless optimization, omit a copied custom-namespace PNG only when no emitted Bedrock JSON references its output path. Keep generated textures, vanilla remaps, and explicitly referenced texture files.
- **Reason:** The current model/item/block paths bake supported textures into generated atlases/icons, while the texture-copy stage also retained the raw Java namespace PNGs. A reference scan yields a narrow, reportable size optimization without claiming that arbitrary source files are unused.
- **Safety:** Any output JSON parse failure disables this cleanup for that conversion. Every omitted source PNG receives a report entry.
- **Date:** 2026-11-25
