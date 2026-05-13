export type TaggerCatalogTier = 'standard' | 'baseline' | 'experiment' | 'research' | 'defer'

export interface TaggerCatalogItem {
  id: string
  repoId: string
  name: string
  tier: TaggerCatalogTier
  license: string
  access: 'public' | 'gated'
  runtime: string
  tagCount: string
  dataSnapshot: string
  role: string
  thresholdHint: string
  strengths: string[]
  cautions: string[]
}

export const TAGGER_CATALOG: TaggerCatalogItem[] = [
  {
    id: 'pixai-onnx',
    repoId: 'deepghs/pixai-tagger-v0.9-onnx',
    name: 'PixAI Tagger v0.9 ONNX',
    tier: 'standard',
    license: 'Apache-2.0',
    access: 'public',
    runtime: 'ONNX / dghs-imgutils',
    tagCount: '13,461',
    dataSnapshot: 'Danbooru 2025-01',
    role: 'Default candidate for newer anime character and copyright coverage.',
    thresholdHint: 'general 0.30, character 0.85; lower general only for recall-heavy search.',
    strengths: [
      'Freshest practical Apache option found in the survey.',
      'Character recognition is the main reason to prefer it over WD v3.',
      'ONNX repack has selected_tags.csv and thresholds.csv.'
    ],
    cautions: [
      'Recall-leaning output needs allow/deny cleanup before prompt insertion.',
      'Original PixAI repo is gated; use the public ONNX repack first.'
    ]
  },
  {
    id: 'wd-eva02',
    repoId: 'SmilingWolf/wd-eva02-large-tagger-v3',
    name: 'WD EVA02 Large Tagger v3',
    tier: 'baseline',
    license: 'Apache-2.0',
    access: 'public',
    runtime: 'timm / ONNX / safetensors',
    tagCount: '10,861',
    dataSnapshot: 'Danbooru 2024-02',
    role: 'Stable baseline and regression comparison for any new tagger.',
    thresholdHint: 'P=R threshold 0.5296 from the model card.',
    strengths: [
      'Well-known WD v3 model with simple selected_tags.csv format.',
      'Safe fallback when a newer tagger returns too many false positives.'
    ],
    cautions: [
      'Older character/copyright coverage than PixAI.',
      'Keep as baseline rather than the only option.'
    ]
  },
  {
    id: 'oppai-oracle',
    repoId: 'Grio43/OppaiOracle',
    name: 'OppaiOracle V1.1',
    tier: 'experiment',
    license: 'Apache-2.0',
    access: 'public',
    runtime: 'ONNX / safetensors',
    tagCount: '19,294',
    dataSnapshot: '2026 model card',
    role: 'Experimental general-tag scorer with strong reported break-even metrics.',
    thresholdHint: 'macro 0.753, micro 0.793 from pr_thresholds.json.',
    strengths: [
      'Reported Macro-F1 and Micro-F1 are high on its validation protocol.',
      'General-tag-only vocabulary can be useful for prompt cleanup.'
    ],
    cautions: [
      'Does not replace character/copyright taggers.',
      'Very new; validate on local game assets before defaulting to it.'
    ]
  },
  {
    id: 'camie-v2',
    repoId: 'Camais03/camie-tagger-v2',
    name: 'Camie Tagger v2',
    tier: 'research',
    license: 'GPL-3.0',
    access: 'public',
    runtime: 'ONNX / PyTorch',
    tagCount: '70,527',
    dataSnapshot: 'danbooru-2024',
    role: 'Research comparator for broad artist/character/copyright/meta coverage.',
    thresholdHint: 'macro profile 0.492; micro profile 0.614.',
    strengths: [
      'Broadest vocabulary in this catalog.',
      'Strong category-level metrics for character, copyright, and artist tags.'
    ],
    cautions: [
      'GPL-3.0: do not bundle into distributable builds by default.',
      'Large vocabulary can be noisy for direct prompt insertion.'
    ]
  },
  {
    id: 'convnextv2-dbv4',
    repoId: 'animetimm/convnextv2_huge.dbv4-full',
    name: 'ConvNeXtV2 Huge DBv4 Full',
    tier: 'defer',
    license: 'GPL-3.0',
    access: 'gated',
    runtime: 'timm / safetensors',
    tagCount: '12,476',
    dataSnapshot: 'Danbooru WDTagger v4 dataset',
    role: 'Heavy gated comparison target, not an app default.',
    thresholdHint: 'per-tag best_threshold in selected_tags.csv.',
    strengths: [
      'Modern DBv4-oriented tagger with per-tag thresholds.',
      'Useful only after a manual benchmark pass.'
    ],
    cautions: [
      'Gated and GPL-3.0.',
      'ConvNeXtV2 huge is too heavy for the first local integration slice.'
    ]
  },
  {
    id: 'cl-tagger',
    repoId: 'cella110n/cl_tagger',
    name: 'CL Tagger',
    tier: 'experiment',
    license: 'Apache-2.0',
    access: 'public',
    runtime: 'ONNX',
    tagCount: '42,163',
    dataSnapshot: '2025 model card',
    role: 'Second experimental Apache option with broad vocabulary.',
    thresholdHint: 'No strong public threshold guidance; benchmark locally.',
    strengths: [
      'Apache ONNX package with optimized model files.',
      'Covers general, character, copyright, meta, model, rating, and quality tags.'
    ],
    cautions: [
      'Evaluation details are thin compared with PixAI, WD, Camie, and OppaiOracle.',
      'Keep behind an experimental label.'
    ]
  }
]

export function taggerTierLabel(tier: TaggerCatalogTier): string {
  switch (tier) {
    case 'standard': return 'Standard'
    case 'baseline': return 'Baseline'
    case 'experiment': return 'Experiment'
    case 'research': return 'Research'
    case 'defer': return 'Deferred'
  }
}
