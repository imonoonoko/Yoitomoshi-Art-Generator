# Discussion Log

- 2026-05-25: User set the long-running goal for Yoitomoshi Forge Studio personal-use improvements and explicitly invoked `$define-requirements`.
- 2026-05-25: Current priority order is startup/recovery stability, history search, Download/Model Library cleanup, then Prompt assets, Candidate Board, Reference Board, and Upscale finishing.
- 2026-05-25: Startup/recovery already has the first two slices: Personal Environment Health and safe recovery IPC. Next active slice is History searchability.
- 2026-05-25: History search first slice implemented: broadened search text, quick filters, and Pro Recipe note visibility in the grid.
- 2026-05-25: History search second slice implemented: rating range filter plus Candidate Board adoption/failure/next-action notes saved as Pro Recipe review data.
- 2026-05-25: Download/Model Library cleanup first slice implemented: stale running downloads and orphan partials are split in the Model Library UI, and active running downloads are protected from discard/resume.
- 2026-05-25: Model profile relationship slice implemented: checkpoint Prompt Profiles now store related LoRA / VAE / ControlNet references with role, weight, and notes.
- 2026-05-25: Related model profile data is now visible in Preflight and Prompt Composer as non-blocking production notes.
- 2026-05-26: Prompt asset slice started: Prompt Composer Slot templates are persisted in userdata and can be saved, loaded, and deleted from the Composer panel.
- 2026-05-26: Prompt Library now has use-case recipe buttons for character base, social thumbnail, material asset, pose reference, and upscale finish; recipes append to slots or Prompt/Negative based on slot-insert mode.
- 2026-05-26: Candidate Board now supports SNS/reference purpose labels and can send seed+1, CFG±0.5, and LoRA weight±0.05 derivations from the selected candidate into txt2img settings without auto-generating.
- 2026-05-26: Reference Board first slice implemented in Tools: labeled history/current images can be collected with source notes, saved/restored in Workspace, and routed to img2img, Inpaint setup, or ControlNet Unit 1.
- 2026-05-26: Upscale finishing slice implemented: comparison cards now expose adoption settings, finish failure checks are structured, and saving an adopted Upscale result to History automatically writes those settings/checks to Pro Recipe.
- 2026-05-26: Completion audit finished. Added focused Personal Health DOM QA and verified startup/recovery, history search, Download/Model Library cleanup, Prompt assets, Candidate Board, Reference Board, and Upscale finishing against the original personal-use objective.
