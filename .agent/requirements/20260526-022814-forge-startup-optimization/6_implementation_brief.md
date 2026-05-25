# Implementation Brief

## Implemented Phase 1

- Add `--skip-torch-cuda-test` only when `.yoitomoshi-install-ready.json` is current and `--skip-install` is also safe.
- Add `--disable-console-progressbars` and `--no-prompt-history` to the default Forge API-only launch.
- Remove default `--api-log`; users can still pass it through `forgeExtraArgs` when debugging.
- Add environment defaults:
  - `HF_HOME`, `HF_HUB_CACHE`, `HF_ASSETS_CACHE`, `HF_DATASETS_CACHE` to Forge's `models/diffusers` cache.
  - `PIP_DISABLE_PIP_VERSION_CHECK=1`
  - `GRADIO_ANALYTICS_ENABLED=False`
  - `HF_HUB_DISABLE_TELEMETRY=1`
  - `DISABLE_TELEMETRY=YES`
  - `USE_TF=0`
  - `TRANSFORMERS_NO_TF=1`
  - `TRANSFORMERS_NO_FLAX=1`
- Do not set deprecated `TRANSFORMERS_CACHE`; current Hugging Face tooling prefers `HF_HOME` / `HF_HUB_CACHE`.
- Reduce local readiness poll interval from 750 ms to 300 ms.

## Later Candidate Work

- Add a UI startup profile selector: Stable, Fast Ready, Minimal API.
- Make optional extension groups explicit so heavy features can be disabled when unused.
- Add a benchmark script that runs two or three cold/warm starts and summarizes p50/p90 Forge ready.
- Add first-generation latency measurement to avoid optimizing ready time while hurting actual generation readiness.
