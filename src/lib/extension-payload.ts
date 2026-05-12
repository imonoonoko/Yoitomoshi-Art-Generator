import type { AlwaysOnScripts } from '@shared/types'
import type { AppState } from './store'

/**
 * Build the `alwayson_scripts` payload that goes into every txt2img / img2img
 * request based on which extension panels are enabled. One central function
 * keeps the wire format in lockstep with each extension's `args` shape, which
 * matters because Forge expects positional arguments in the exact order the
 * extension's `ui()` method returned them.
 *
 * Extensions are added incrementally — keep only the enabled ones in the
 * output map. Disabled extensions are omitted entirely so Forge doesn't
 * spend CPU running their hooks.
 *
 * @param state full Zustand state
 * @param ctx   optional flags. `forUpscaleDiffusion` swaps in the Upscale
 *              workspace's MultiDiffusion settings instead of looking at the
 *              prompt-panel extension toggles. The Upscale workflow is a
 *              one-shot img2img call; we don't want any of the prompt-panel
 *              augmentations (ADetailer, ControlNet, etc.) bleeding in.
 */
export function buildAlwaysOnScripts(
  state: AppState,
  ctx?: { forUpscaleDiffusion?: boolean; forUpscaleUltimate?: boolean }
): AlwaysOnScripts | undefined {
  const scripts: AlwaysOnScripts = {}

  if (ctx?.forUpscaleDiffusion) {
    const u = state.upscale
    scripts['MultiDiffusion Integrated'] = {
      args: [
        true,
        u.diffusionMethod,
        u.tileWidth,
        u.tileHeight,
        u.tileOverlap,
        4 // tile_batch_size — Forge default; surfacing this in UI was
          // overwhelming for marginal benefit. Power users can tweak in
          // the source.
      ]
    }
    addUpscaleTileControlNet(scripts, u)
    return Object.keys(scripts).length > 0 ? scripts : undefined
  }

  if (ctx?.forUpscaleUltimate) {
    addUpscaleTileControlNet(scripts, state.upscale)
    return Object.keys(scripts).length > 0 ? scripts : undefined
  }

  // ---- Dynamic Thresholding (CFG-Fix) -----------------------------------
  // Script title from sd_forge_dynamic_thresholding/scripts/forge_dynamic_thresholding.py
  // The 12 args MUST match the order returned by its ui() method.
  if (state.dynThres.enabled) {
    const d = state.dynThres
    scripts['DynamicThresholding (CFG-Fix) Integrated'] = {
      args: [
        d.enabled,
        d.mimicScale,
        d.thresholdPercentile,
        d.mimicMode,
        d.mimicScaleMin,
        d.cfgMode,
        d.cfgScaleMin,
        d.schedVal,
        d.separateFeatureChannels,
        d.scalingStartpoint,
        d.variabilityMeasure,
        d.interpolatePhi
      ]
    }
  }

  // ---- FreeU ------------------------------------------------------------
  // Script title from sd_forge_freeu/scripts/forge_freeu.py
  // Args: enabled, b1, b2, s1, s2, startStep, endStep
  if (state.freeu.enabled) {
    const f = state.freeu
    scripts['FreeU Integrated (SD 1.x, SD 2.x, SDXL)'] = {
      args: [f.enabled, f.b1, f.b2, f.s1, f.s2, f.startStep, f.endStep]
    }
  }

  // ---- ADetailer --------------------------------------------------------
  // Script title is just "ADetailer" (from adetailer/__init__.py).
  //
  // The args layout in ADetailer's `is_ad_enabled` / `get_args` is unusual:
  // it filters `args_` for dicts and treats the first bool (if any) as the
  // master enabled flag, the second as `skip_img2img`. Standard A1111 docs
  // show three formats that all work:
  //
  //   (a) [bool, bool, dict, dict, ...]  — explicit enable + skip + units
  //   (b) [dict, dict, ...]              — dicts only; enable inferred True
  //   (c) [bool, dict]                   — just enable + 1 unit
  //
  // We use (b) — the bare-dicts form. The reason is empirical: Forge's
  // `init_default_script_args` builds the cached `script_args` list by
  // calling every script's `ui()` and slice-assigning the resulting default
  // values. Some installed extension's `ui()` returns fewer components
  // than its registered slot count (a Gradio version-skew issue), which
  // SHRINKS the cached list below ADetailer's `args_from + 5` boundary.
  // Subsequent writes to the bool slots (idx 0, 1) then hit OOB and raise
  //   IndexError: list assignment index out of range
  //
  // By sending dicts only, we *also* slot into the same range — but
  // ADetailer's processing path explicitly tolerates the absence of bools
  // (defaults to enabled=True), so we can keep our payload short enough
  // that all writes stay below the shrink point. ADetailer's
  // `is_ad_enabled` then re-derives the master enable state from the
  // presence of dicts with `ad_model != "None"`.
  if (state.adetailer.enabled && state.adetailer.units.length > 0) {
    const a = state.adetailer
    const realUnits = a.units.map((u) => ({
      ad_model: u.model,
      // ad_model_classes is only honored by YOLO-world models — leaving it
      // empty for non-world models is a safe no-op.
      ad_model_classes: u.modelClasses,
      ad_prompt: u.prompt,
      ad_negative_prompt: u.negativePrompt,
      ad_confidence: u.confidence,
      ad_denoising_strength: u.denoisingStrength,
      ad_mask_blur: u.maskBlur,
      ad_inpaint_only_masked_padding: u.inpaintOnlyMaskedPadding,
      ad_dilate_erode: u.dilateErode
    }))
    scripts['ADetailer'] = { args: realUnits }
  }

  // ---- ControlNet -------------------------------------------------------
  // Script title from sd_forge_controlnet/scripts/controlnet.py is "ControlNet".
  // Args layout: [unit1_dict, unit2_dict, ...] (one dict per unit).
  // ControlNet itself looks at each unit's `enabled` flag, so we always send
  // *all* configured units — leaving unit-level enabled untouched. The panel
  // toggle gates the entire feature: when off, we omit the script entirely.
  if (state.controlnet.enabled && state.controlnet.units.length > 0) {
    const units = state.controlnet.units.map((u) => ({
      enabled: u.enabled,
      module: u.module,
      model: u.model,
      // Strip the data: prefix — Forge's controlnet expects raw base64.
      image: u.image
        ? u.image.replace(/^data:image\/[a-z]+;base64,/, '')
        : null,
      weight: u.weight,
      resize_mode: u.resizeMode,
      processor_res: u.processorRes,
      threshold_a: u.thresholdA,
      threshold_b: u.thresholdB,
      guidance_start: u.guidanceStart,
      guidance_end: u.guidanceEnd,
      pixel_perfect: u.pixelPerfect,
      control_mode: u.controlMode,
      // Apply on both first and hires-fix passes by default. Overriding
      // requires per-unit UI we haven't surfaced yet.
      hr_option: 0
    }))
    scripts['ControlNet'] = { args: units }
  }

  // ---- Regional Prompter -----------------------------------------------
  // hako-mikan/sd-webui-regional-prompter exposes an AlwaysVisible script
  // titled "Regional Prompter". Its UI returns positional args in this order:
  // active, debug placeholder, selected tab, matrix/mask/prompt submodes,
  // ratios, base ratios, base/common flags, calc mode, options, LoRA text
  // ratios, prompt threshold, mask image, LoRA stop steps, flip.
  if (state.regionalPrompter.enabled) {
    const r = state.regionalPrompter
    scripts['Regional Prompter'] = {
      args: [
        true,
        false,
        'Matrix',
        r.splitMode,
        'Mask',
        'Prompt',
        r.ratios,
        r.baseRatios,
        r.useBase,
        r.useCommon,
        r.useCommonNegative,
        r.calcMode,
        [],
        '0',
        '0',
        '0',
        null,
        '0',
        '0',
        r.flip
      ]
    }
  }

  // ---- FABRIC ----------------------------------------------------------
  // dvruette/sd-webui-fabric stores feedback images under its own
  // log/fabric/images folder and receives only those filenames in the API
  // args. The renderer saves files via storageSaveFabricFeedbackImage before
  // enabling this payload.
  if (state.fabric.enabled && (state.fabric.positive.length > 0 || state.fabric.negative.length > 0)) {
    const f = state.fabric
    scripts['FABRIC'] = {
      args: [
        f.positive.map((item) => item.filename),
        f.negative.map((item) => item.filename),
        true,
        f.start,
        f.end,
        f.minWeight,
        f.maxWeight,
        f.negativeWeight,
        f.feedbackDuringHighResFix,
        f.tomeEnabled,
        f.tomeRatio,
        f.tomeMaxTokens,
        f.tomeSeed,
        f.burnoutProtection
      ]
    }
  }

  return Object.keys(scripts).length > 0 ? scripts : undefined
}

function addUpscaleTileControlNet(
  scripts: AlwaysOnScripts,
  u: AppState['upscale']
): void {
  if (!u.tileControlNetEnabled || !u.inputImage || u.tileControlNetModel === 'None') return

  scripts['ControlNet'] = {
    args: [
      {
        enabled: true,
        // tile_resample is preferred when the full sd-webui-controlnet
        // preprocessor catalog is installed. Forge's built-in "None"
        // preprocessor is a valid fallback: it passes the source image
        // through as the condition map.
        module: u.tileControlNetModule || 'None',
        model: u.tileControlNetModel,
        image: stripImageDataUrl(u.inputImage),
        weight: u.tileControlNetWeight,
        resize_mode: 0,
        processor_res: -1,
        threshold_a: -1,
        threshold_b: -1,
        guidance_start: u.tileControlNetGuidanceStart,
        guidance_end: u.tileControlNetGuidanceEnd,
        pixel_perfect: true,
        control_mode: 2,
        hr_option: 0
      }
    ]
  }
}

function stripImageDataUrl(image: string): string {
  return image.replace(/^data:image\/[a-z]+;base64,/, '')
}
