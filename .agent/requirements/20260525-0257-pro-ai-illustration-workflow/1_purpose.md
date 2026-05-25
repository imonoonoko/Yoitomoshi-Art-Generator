# Pro AI Illustration Workflow Purpose

## Problem

Yoitomoshi Forge Studio already supports Forge generation, Prompt Composer, History, Model Library, Civitai metadata, LoRA, ControlNet, and Upscale. However, the workflow still treats generation results mostly as output images rather than reusable production recipes.

SNS-quality AI illustration usually comes from repeated selection, revision, reference control, LoRA/model matching, and final polishing. The current app has many of the needed parts, but the user still has to mentally connect them.

## Target User

The target user is a personal creator using Yoitomoshi Forge Studio to make high-quality AI illustrations for SNS, personal projects, character design, or visual ideation.

The user wants to:

- create images closer to professional AI illustrator quality;
- reuse successful recipes instead of starting over each time;
- choose models and LoRAs with better guidance;
- compare multiple candidates efficiently;
- improve prompts without needing to memorize every model-specific convention.

## Current Workaround

- Save good images in History or mark them as favorite/candidate/rejected.
- Reuse metadata from generated images manually.
- Use Prompt Composer and Prompt Helper separately.
- Use Model Library and Civitai metadata manually.
- Send strong images to img2img or Upscale by hand.

## Desired Outcome

Yoitomoshi should support a Pro Recipe workflow:

1. Generate multiple candidates.
2. Review and label them.
3. Save the reason a result is good or weak.
4. Reuse successful settings, prompts, models, and LoRAs.
5. Improve prompts based on model profile and past successful recipes.
6. Send the strongest image into img2img, inpaint, or Upscale.

## Success Definition

- A generated image can become a Pro Recipe with review data and reuse notes.
- Model profiles guide prompt style and generation settings.
- Prompt Composer can build model-aware prompts from production slots.
- Candidate comparison is supported without losing existing History behavior.
- Civitai-derived metadata improves model/LoRA/prompt suggestions without blocking app startup.
