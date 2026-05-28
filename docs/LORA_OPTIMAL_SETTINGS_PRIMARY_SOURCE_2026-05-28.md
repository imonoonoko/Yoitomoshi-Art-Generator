# LoRA Optimal Settings Primary Source Report

Generated: 2026-05-27T18:45:33.563Z
Mode: applied

## Summary

- Scanned LoRA/LyCORIS files: 43
- Overrides generated: 43
- Unique override IDs written: 42
- Live Civitai exact hash matches: 42
- Local Civitai cache fallbacks: 0
- Unmatched files left unchanged: 0
- Author/sample-specific weights: 35
- Civitai guide fallback weights: 8
- Civitai API key used: no; public API/cache only

## Evidence Policy

- Primary match: local file SHA-256 to Civitai `GET /api/v1/model-versions/by-hash/:hash`.
- Local primary fallback: project-owned LoRA versions that are not public on Civitai use local training config/report evidence.
- Prompt hints: Civitai trained words first, then author description sections such as recommended prompt/tags.
- Weight: author-stated recommendation first, then LoRA weights in Civitai sample prompts, then Civitai guide starting point 0.85 when no per-LoRA source exists.
- Sampler/steps/CFG/clip skip: median or mode from the same model version sample image metadata only; no generic fallback is invented.
- Unmatched files are not given guessed model-card settings.

Sources used: Civitai API exact hash endpoint, Civitai model/version pages referenced below, and Civitai How-to-use-models guide for fallback LoRA starting weight.

## Per-LoRA Results

| File | Source | Civitai | Base | Weight | Params | Prompt Hints | Notes |
|---|---|---|---|---:|---|---:|---|
| Lora/add_detail | live | [Detail Tweaker LoRA (细节调整LoRA)](https://civitai.com/models/58390?modelVersionId=62833) | SD 1.5 | 1 (sample-prompts) | sampler=DPM++ 2M Karras<br>steps=20<br>cfg=7<br>clipSkip=2 | 0 |  |
| Lora/bottom_up_spread_epoch_10 | live | [Hip lift sexy pose](https://civitai.com/models/2631708?modelVersionId=2954783) | Illustrious | 0.8 (sample-prompts) | sampler=Euler a<br>steps=30<br>cfg=6.5<br>clipSkip=2 | 18 |  |
| Lora/cas-xl-ill-v2-000014 | live | [[concept]no testicles xl](https://civitai.com/models/379699?modelVersionId=1042627) | Illustrious | 1 (sample-prompts) | sampler=DPM++ 2M<br>steps=30<br>cfg=5.5 | 2 |  |
| Lora/cat lingerie_anima_V1.0 | live | [猫ランジェリー/cat lingerie](https://civitai.com/models/1284777?modelVersionId=2939201) | Anima | 1 (sample-prompts) | sampler=Euler a<br>steps=25<br>cfg=4<br>clipSkip=2 | 10 |  |
| Lora/chocolate_illustrious_V2.1 | live | [チョコレート/chocolate(XL,ill,pony)](https://civitai.com/models/651846?modelVersionId=2676938) | Illustrious | 0.85 (civitai-guide-starting-point) | sampler=DPM++ 2M<br>steps=30<br>cfg=7<br>clipSkip=2 | 13 |  |
| Lora/covering privates_illustrious_V2.1 | live | [covering privates(XL,ill,pony)](https://civitai.com/models/720206?modelVersionId=2642350) | Illustrious | 0.9 (sample-prompts) | sampler=DPM++ 2M<br>steps=30<br>cfg=7<br>clipSkip=2 | 11 |  |
| Lora/female ejaculation_illustrious_V2.0 | live | [潮吹き/ female ejaculation](https://civitai.com/models/558452?modelVersionId=2792952) | Illustrious | 0.8 (sample-prompts) | sampler=DPM++ 2M<br>steps=30<br>cfg=7 | 1 |  |
| Lora/Female_POVILLV5 | live | [Female POV](https://civitai.com/models/427349?modelVersionId=2486222) | Illustrious | 0.7 (sample-prompts) | sampler=Euler a Karras<br>steps=35<br>cfg=6<br>clipSkip=1 | 9 |  |
| Lora/garter belt_illustrious_V2.0 | live | [ガーターベルト/garter belt(SD,XL,ILL,pony)](https://civitai.com/models/545762?modelVersionId=2561439) | Illustrious | 1 (sample-prompts) | sampler=DPM++ 2M<br>steps=30<br>cfg=7 | 10 |  |
| Lora/hands and collar bound_illustrious_V1.0 | live | [手錠と首輪/wrists and collar bound](https://civitai.com/models/2606681?modelVersionId=2929492) | Illustrious | 0.95 (sample-prompts) | sampler=DPM++ 2M<br>steps=25<br>cfg=7<br>clipSkip=2 | 4 |  |
| Lora/hands between legs all fours_illustrious_V1.0 | live | [尻上げ姿勢/bottom up and hands between legs](https://civitai.com/models/2217351?modelVersionId=2496354) | Illustrious | 1 (sample-prompts) | sampler=DPM++ 2M SDE<br>steps=25<br>cfg=5 | 4 |  |
| Lora/hands between legs all fours_illustrious_V1.0 (1) | live | [尻上げ姿勢/bottom up and hands between legs](https://civitai.com/models/2217351?modelVersionId=2496354) | Illustrious | 1 (sample-prompts) | sampler=DPM++ 2M SDE<br>steps=25<br>cfg=5 | 4 | Duplicate SHA-256; shares override with hands between legs all fours_illustrious_V1.0. |
| LyCORIS/ichika_v1_epoch34 | live | [Style:壱珂/ichika [Anima]](https://civitai.com/models/2627306?modelVersionId=2949775) | Anima | 0.85 (civitai-guide-starting-point) |  | 1 | No Civitai sample metadata. |
| LyCORIS/IomayaIllustrious | live | [Iomaya Style](https://civitai.com/models/2255704?modelVersionId=2539197) | Illustrious | 0.85 (civitai-guide-starting-point) |  | 1 | No Civitai sample metadata. |
| Lora/jinki-style_restrained_ilxl_goofy | live | [Jinki-Style Restrained \| Goofy Ai](https://civitai.com/models/2641322?modelVersionId=2965770) | Illustrious | 1 (sample-prompts) | sampler=DPM++ 2M<br>steps=20<br>cfg=5<br>clipSkip=2 | 7 |  |
| Lora/jyojishitagi_illustrious_V2.0 | live | [女児下着/girl's underwear(XL,ill,Pony)](https://civitai.com/models/435069?modelVersionId=2508931) | Illustrious | 0.8 (sample-prompts) | sampler=DPM++ 2M SDE<br>steps=25<br>cfg=5 | 11 |  |
| Lora/manguri_illustrious_V2.1 | live | [まんぐり返し/folded pose(XL,ill,pony)](https://civitai.com/models/623820?modelVersionId=2529782) | Illustrious | 0.8 (sample-prompts) | sampler=DPM++ 2M SDE<br>steps=25<br>cfg=5 | 13 |  |
| Lora/mecha_tentacles_av2_epoch_10 | live | [mecha_tentacles & sex_machine](https://civitai.com/models/1923423?modelVersionId=2917097) | Illustrious | 0.9 (sample-prompts) | sampler=Euler a<br>steps=21<br>cfg=7<br>clipSkip=2 | 19 |  |
| Lora/Meltdown_Highway__-_IL_-_ | live | [Meltdown Highway _-= IL =-_](https://civitai.com/models/2554856?modelVersionId=2871262) | Illustrious | 0.7 (sample-prompts) | sampler=LCM<br>steps=10<br>cfg=1.2<br>clipSkip=2 | 4 |  |
| Lora/more_details | live | [Add More Details - Detail Enhancer / Tweaker (细节调整) LoRA](https://civitai.com/models/82098?modelVersionId=87153) | SD 1.5 | -1 (sample-prompts) | sampler=DPM++ SDE Karras<br>steps=25<br>cfg=7<br>clipSkip=2 | 0 |  |
| Lora/naked ribbon_illustrious_V2.0 | live | [裸リボン/naked ribbon(SD,XL,ill,pony)](https://civitai.com/models/590767?modelVersionId=2520807) | Illustrious | 0.85 (civitai-guide-starting-point) | sampler=DPM++ 2M SDE<br>steps=25<br>cfg=5 | 9 |  |
| Lora/nipple chain_V2.0 | live | [乳首チェーン/nipples chain(SD,XL,Pony)](https://civitai.com/models/474884?modelVersionId=2712278) | Illustrious | 0.8 (sample-prompts) | sampler=DPM++ 2M<br>steps=23<br>cfg=5 | 4 |  |
| Lora/NM_anal_fingering | live | [Solo anal fingering, LoRA, PonyXL \| Illustrious XL](https://civitai.com/models/1010249?modelVersionId=2929157) | Illustrious | 1 (sample-prompts) | sampler=Euler a<br>steps=27<br>cfg=5.5 | 11 |  |
| Lora/old school swimsuit_illustrious_V2.0 | live | [スク水/school swimsuit(XL,ill,pony)](https://civitai.com/models/461839?modelVersionId=2507993) | Illustrious | 1 (sample-prompts) | sampler=DPM++ 2M SDE<br>steps=25<br>cfg=5 | 9 |  |
| Lora/onoko_0n0k0_sdxl_v3_2_patch_b | local-primary |  | SDXL 1.0 / Illustrious | 0.65 (local-primary) | sampler=Euler a<br>steps=28<br>cfg=4.5<br>clipSkip=2 | 9 | No Civitai sample metadata. |
| Lora/onoko_0n0k0_sdxl_v3_patch_a | live | [ONOKO - AI Girl (SDXL char LoRA)](https://civitai.com/models/2638281?modelVersionId=2962236) | SDXL 1.0 | 0.85 (author-card) | sampler=Euler a<br>steps=28<br>cfg=7 | 3 |  |
| LyCORIS/panties wrinkles_illustrious_V1.0 | live | [パンツの皺/panties wrinkles](https://civitai.com/models/1737769?modelVersionId=1980610) | Illustrious | 0.7 (sample-prompts) | sampler=DPM++ 2M<br>steps=30<br>cfg=7<br>clipSkip=2 | 9 |  |
| Lora/present-for-windy-illustrious v3 | live | [present-for-windy-illustrious](https://civitai.com/models/1771454?modelVersionId=2913341) | Illustrious | 0.8 (sample-prompts) | sampler=Euler a<br>steps=30<br>cfg=5 | 10 |  |
| Lora/Restricted transmission-IL_NAI_PY | live | [Restricted live \| Stationary restraints \| Concept version \| Illustrious/NoobAI/Pony \| Commission](https://civitai.com/models/2571592?modelVersionId=2889440) | Illustrious | 0.85 (civitai-guide-starting-point) | sampler=Euler a<br>steps=40<br>cfg=8 | 44 |  |
| LyCORIS/Rumic0620Illustrious | live | [Rumic0620 Style (Anima & Illustrious)](https://civitai.com/models/2138436?modelVersionId=2418867) | Illustrious | 0.85 (civitai-guide-starting-point) |  | 1 |  |
| Lora/S425VYHVV2ZSHPFW94RPAX3A90 | live | [Sitting on Pole, Sitting on Fence](https://civitai.com/models/2648500?modelVersionId=2973852) | Illustrious | 0.85 (civitai-guide-starting-point) |  | 11 |  |
| Lora/sex machine_XL_illustrious_V1.0 | live | [機械姦/sex machine(XL,ill,pony)](https://civitai.com/models/829330?modelVersionId=972316) | Illustrious | 1 (sample-prompts) | sampler=DPM++ 2M Karras<br>steps=15<br>cfg=7<br>clipSkip=2 | 17 |  |
| Lora/shibari_anima_V1.0 | live | [縛り/shibari(SD,XL,ILL,pony)](https://civitai.com/models/591433?modelVersionId=2944205) | Anima | 1 (sample-prompts) | sampler=Euler a<br>steps=25<br>cfg=4<br>clipSkip=2 | 1 |  |
| LyCORIS/sitting backwards on chair_illustrious_V1.0 | live | [後ろ座り/sitting backwards on chair](https://civitai.com/models/2218787?modelVersionId=2497954) | Illustrious | 1 (sample-prompts) | sampler=DPM++ 2M SDE<br>steps=25<br>cfg=5 | 11 |  |
| Lora/skirt tug_illustrious_V2.0 | live | [スカートを抑える/skirt tug(SD,XL,pony)](https://civitai.com/models/721847?modelVersionId=2608630) | Illustrious | 1 (sample-prompts) | sampler=DPM++ 2M SDE<br>steps=30<br>cfg=5 | 9 |  |
| Lora/sports underwear_illustrious_V2.0 | live | [スポーツブラ/sports bra(XL,ILL,pony)](https://civitai.com/models/636297?modelVersionId=2514543) | Illustrious | 0.8 (sample-prompts) | sampler=DPM++ 2M SDE<br>steps=25<br>cfg=5 | 11 |  |
| Lora/thong_illustrious_V1.0 | live | [Ｔバック/thong(XL,pony)](https://civitai.com/models/494847?modelVersionId=1311924) | Illustrious | 0.7 (sample-prompts) | sampler=Euler<br>steps=25<br>cfg=7<br>clipSkip=2 | 11 |  |
| Lora/TonedBodySlider | live | [Toned body slider](https://civitai.com/models/2552628?modelVersionId=2868740) | Illustrious | 1 (sample-prompts) | sampler=Euler a<br>steps=25<br>cfg=6<br>clipSkip=2 | 1 |  |
| LyCORIS/umyonge_(ikakeu)_LoCon-AnimaPreview3 | live | [[Anima Preview 3] General Style: FlatLineMix](https://civitai.com/models/2619957?modelVersionId=2941533) | Anima | 0.85 (civitai-guide-starting-point) | sampler=er_sde<br>steps=28<br>cfg=4 | 0 |  |
| LyCORIS/underbutt_illustrious_V1.1 | live | [はみケツ/underbutt](https://civitai.com/models/2323233?modelVersionId=2613536) | Illustrious | 1.2 (sample-prompts) | sampler=DPM++ 2M SDE<br>steps=30<br>cfg=5 | 10 |  |
| Lora/vibrator under clothes_illustrious_V2.0 | live | [仕込みローター/ vibrator under clothes(ILL,pony)](https://civitai.com/models/534430?modelVersionId=2782187) | Illustrious | 0.8 (sample-prompts) | sampler=DPM++ 2M<br>steps=25<br>cfg=5 | 11 |  |
| Lora/wet clothes_illustrious_V2.0 | live | [濡れた服/wet clothes](https://civitai.com/models/782959?modelVersionId=2542024) | Illustrious | 0.8 (sample-prompts) | sampler=DPM++ 2M SDE<br>steps=30<br>cfg=5 | 9 |  |
| LyCORIS/whale tail clothing_illustrious_V1.0 | live | [ホエールテイル/whale tail(clothing)](https://civitai.com/models/2544625?modelVersionId=2859680) | Illustrious | 0.8 (sample-prompts) | sampler=DPM++ 2M<br>steps=25<br>cfg=7 | 11 |  |

## Unmatched

All scanned files had either a live exact Civitai match or a local Civitai cache.

