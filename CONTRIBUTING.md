# Contributing

Yoitomoshi Art Generator is currently maintained as a personal project. Contributions are welcome after the repository becomes public, but the project prioritizes stability for the local Forge workflow over broad framework changes.

## Before You Start

Read:

- [`README.md`](README.md)
- [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md)
- [`docs/DOCS_INDEX.md`](docs/DOCS_INDEX.md)
- [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md)

## Development

Use Windows / PowerShell commands.

```powershell
npm.cmd run typecheck
npm.cmd run build
```

For UI changes that affect the Electron renderer, use the DOM QA guide:

```powershell
npm.cmd run qa:dom -- selectors --port=9338
```

## Boundaries

Do not commit:

- `runtime/`
- `userdata/`
- `node_modules/`
- `out/`
- `dist/`
- `output/`
- model weights, generated private images, local API keys, browser traces, or logs

Forge extensions should be controlled through the React/Electron UI and Forge API payloads. Do not embed Forge's Gradio UI.

## Pull Request Expectations

- Keep changes scoped.
- Preserve existing generation payload behavior unless the PR explicitly changes it.
- Add or update DOM QA selectors for UI behavior.
- Update docs when user-facing workflows change.
- Run `npm.cmd run typecheck` before submitting.
