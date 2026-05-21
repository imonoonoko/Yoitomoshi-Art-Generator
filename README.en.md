# Yoitomoshi Art Generator

[日本語](README.md) | **English** | [Русский](README.ru.md) | [Português](README.pt.md)

A personal Stable Diffusion frontend built for game development. It runs Stable Diffusion WebUI Forge in the background and exposes generation, asset management, and Civitai integration through a custom React/Electron UI.

> **Quick start**: Follow "Launch — 3 steps" below. The detailed setup guide is currently maintained in Japanese at [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md).

## Launch from GitHub — 4 steps

### 1. Get the repository

With Git:

```powershell
git clone https://github.com/imonoonoko/Yoitomoshi-Art-Generator.git
cd Yoitomoshi-Art-Generator
```

Without Git, use `Code` → `Download ZIP` on GitHub and extract the folder.

`runtime/`, `userdata/`, `node_modules/`, and build outputs are not included. Prepare Forge and models locally.

### 2. Prerequisites

| Required | Purpose |
|---|---|
| **Stable Diffusion WebUI Forge** | Already working (`run.bat` launches) — [release page](https://github.com/lllyasviel/stable-diffusion-webui-forge) |
| **Node.js 22.x (LTS)** | App runtime — install the LTS build from [nodejs.org](https://nodejs.org/) |
| **Windows 10/11** | Verified target (Mac/Linux untested) |
| **NVIDIA GPU** | Verified on RTX 4060 Ti 8GB. SDXL benefits from `--medvram`. |

About 5 GB of free disk space is required (node_modules + generated image history).

### 3. Launch via double-click

```
Double-click  Yoitomoshi.bat  in Explorer
```

On first run only, the following are executed automatically (3–5 minutes):

1. `npm install` — fetch dependencies
2. `npm run build` — build the app

The Electron window opens when build finishes. Subsequent launches start in seconds.

> **Desktop icon**: right-click [`create-desktop-shortcut.ps1`](create-desktop-shortcut.ps1) → "Run with PowerShell" to drop a shortcut on your desktop.

### 4. First-time setup — point at Forge

Click the ⚙ icon in the upper-right of the title bar to open the settings modal:

| Field | Description |
|---|---|
| **Forge installation path** | Absolute path to the parent folder containing `run.bat`. Default: `C:\宵灯工房アート\Yoitomoshi-Art-Generator\runtime\forge` |
| **Forge port** | Default `7860` (change if you run Forge on another port) |
| **Auto-start** | If on, Forge spawns when Electron launches |
| **Civitai API key** | Optional. Required for NSFW model lookup and higher rate limits. Generate from the "API Keys" tab in [Civitai → Account](https://civitai.com/user/account). |

After saving, click the power button on the left of the title bar to start Forge in the background (1–2 minutes the first time it resolves dependencies).

---

## Developer mode (hot reload)

Use this only if you want changes to source code to be reflected instantly:

```powershell
cd C:\宵灯工房アート\Yoitomoshi-Art-Generator
npm install --no-audit --no-fund    # first time only
npm run dev                          # start with HMR
```

For day-to-day use, `Yoitomoshi.bat` reads the prebuilt artifacts and launches faster.

## Where data is stored

The app is portable. Everything below sits under `userdata/` next to the project:

```
userdata/
├── settings.json              app settings (Forge path, API key, …)
├── presets.json               prompt presets
├── quick-presets.json         user-defined quick presets
├── hidden-quick-presets.json  IDs of built-in presets to hide
├── favorites.json             favorited tags
├── lora-favorites.json        favorited LoRA
├── lora-usage.json            LoRA use history (used to score auto-suggestion)
├── custom-prompt-library.json user-added categories/tags
├── civitai/                   Civitai metadata cache
│   ├── <sha256>.json          per-checkpoint
│   ├── lora-<sha256>.json     per-LoRA
│   ├── community-<id>.json    aggregated community samples
│   ├── update-check.json      model-update check (24h TTL)
│   └── tags.json              popular tag cache (24h TTL)
└── history/                   generation history
    ├── index.json
    └── <uuid>.png             each generated image (max 500)
```

Move the **whole project folder** to another drive or PC and your settings, history, and cache come along.

## Highlights

| Area | Features |
|---|---|
| Generation | txt2img / img2img / Video / Upscale / drag-and-drop input + Ctrl+V / batch |
| Models | First-class workspace for model / LoRA thumbnails, Civitai metadata, favorites, and notes |
| Parameters | Sampler / Steps / CFG / Size / Seed / Clip Skip / VAE / Denoising / weight tuning (Ctrl+↑↓) |
| Prompts | Built-in tag library (prompt-all-in-one MIT) + user additions / autocomplete / token counter / syntax highlight / quick presets |
| LoRA | Card UI / multi-LoRA / auto-suggestion (model recommendation gets +200 boost) / trigger-word auto-insert |
| Civitai | Search & download for models / LoRA / VAE / aggregate 200 community images / model-update notifications / tag browser |
| Metadata parsing | Extract from PNG / JPEG / WebP / paste label-style text / cross-reference model / LoRA / VAE on Civitai |

## Develop / build

```powershell
# TypeScript typecheck
npm run typecheck

# Production build
npm run build

# Package (Electron executable)
npm run dist
```

## Troubleshooting

### A browser window opens by itself
The app rewrites Forge's `webui/config.json` to set `auto_launch_browser` to `Disable` before launching. If a browser still opens, Forge may be starting through some other route — verify that "Forge extra args" in the settings modal does not contain something like `--api`.

### "Running on local URL" never appears
- Confirm the Forge installation path is correct (`<path>/webui/launch.py` should exist)
- Port conflict: another instance of Forge or another app already uses 7860
- Forge dependency updates can take a few minutes on the first launch

### "Metadata parse" fails → "not a PNG image"
Images that came through SNS / CDN often have EXIF stripped. Use the "Parse from text" button to paste an A1111-format parameter string or a label-newline-value-style string.

### Same extension errors keep appearing
Click the ⚠️ icon on the title bar → "Disable" to add the extension name to `disabled_extensions` in Forge's `webui/config.json`. Restart Forge to apply.

### Model recommendations look stale
Cache lives at `userdata/civitai/<sha>.json` with a 14-day TTL. Delete the file to force a refetch on next selection. Same for community aggregations (`community-<id>.json`).

## License & third-party

- The bundled `resources/prompt-library.ja.yaml` comes from [Physton/sd-webui-prompt-all-in-one](https://github.com/Physton/sd-webui-prompt-all-in-one) (MIT)
- Major dependencies: Electron / electron-vite / Vite 7 / React 19 / Tailwind / Radix UI / Zustand / js-yaml / lucide-react

## Known limitations

- **Distribution scope is narrow**: built for personal use, not meant for general public release
- **NSFW filter only on Civitai search**: generation itself is not moderated (left to Forge / the model)
- **PNG metadata**: only A1111 / Forge format (`parameters` chunk / EXIF UserComment) is parsed
- **Mac/Linux untested**: code is cross-platform, but Forge launching assumes Windows

## Contact

Send bug reports / requests directly to the maintainer (no public issue tracker — this is a personal project).
