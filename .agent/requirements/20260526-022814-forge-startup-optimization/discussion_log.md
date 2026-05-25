# Discussion Log

## 2026-05-26 02:28

User requested Forge Ready time and runtime speed optimization using 2026-05-26 current best practices, with `define-requirements`, `codex-brain`, and `orchestrate-skills`.

Current local baseline from `userdata/startup-metrics.jsonl`:

- Renderer load is already low, usually around 150-200 ms.
- Forge Ready is the primary bottleneck, usually around 17-23 s with occasional 37-39 s samples.
- Current settings use `forgeExtraArgs: --cuda-malloc`.

Initial accepted scope:

- Improve startup arguments and environment defaults without removing required generation features.
- Keep Forge API-only and keep Gradio UI unembedded.
- Avoid destructive runtime changes, extension deletion, model deletion, or risky model-load deferral by default.
