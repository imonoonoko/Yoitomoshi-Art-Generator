# Alternatives

## Alternative A: Add a new top-level Pro tab

### Pros

- Clear new destination for the workflow.
- Easy to design from scratch.

### Cons

- Conflicts with the current rule to keep top-level tabs stable.
- Risks duplicating History, Prompt, Model Library, and Upscale surfaces.
- Larger UI and QA blast radius.

### Decision

Reject for MVP. Use existing tabs and panels.

## Alternative B: Start with latest external model backend support

### Pros

- Appears aligned with latest model trends like FLUX.2, Qwen, Hunyuan, and Z-Image.
- Could unlock new quality ceilings later.

### Cons

- High dependency, VRAM, license, and runtime risk.
- Does not solve the core workflow problem inside the current Forge app.
- Could destabilize existing Forge runtime.

### Decision

Defer to later optional phase. Keep external backends isolated under Tools.

## Alternative C: Start with Prompt Composer only

### Pros

- Builds on recent Prompt Composer work.
- Easy to make visible quickly.

### Cons

- Prompt quality alone does not create a professional workflow.
- Without recipe review and candidate selection, improvements are hard to reuse.

### Decision

Do after Pro Recipe and model profile foundations.

## Alternative D: Start with History as Pro Recipe

### Pros

- Uses existing `HistoryItem`, labels, params, LoRA, ControlNet, Upscale, and metadata.
- Low migration risk if added as optional fields.
- Directly supports selection, reuse, and iteration.

### Cons

- Requires careful UI design to avoid bloating History.
- Needs persistence QA.

### Decision

Adopt as Phase 1.
