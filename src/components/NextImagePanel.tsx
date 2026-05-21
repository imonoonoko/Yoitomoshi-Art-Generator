import { useMemo, useState } from 'react'
import { Camera, Cpu, GitCompare, Image, Layers, RotateCcw, ShieldCheck, Shuffle, Smile, Wand2, type LucideIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore, type GenerationParams } from '@/lib/store'
import { buildNextImageActions, type NextImageAction, type NextImageActionId, type NextImagePatch } from '@/lib/next-image-actions'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { ActiveLora } from '@shared/types'

interface Props {
  onOpenVariation(): void
}

interface Snapshot {
  prompt: string
  negativePrompt: string
  params: GenerationParams
  activeLoras: ActiveLora[]
  selectedModelTitle: string | null
}

const ICONS: Record<NextImageAction['icon'], LucideIcon> = {
  shuffle: Shuffle,
  compare: GitCompare,
  smile: Smile,
  camera: Camera,
  image: Image,
  shield: ShieldCheck,
  layers: Layers,
  model: Cpu
}

export function NextImagePanel({ onOpenVariation }: Props): JSX.Element | null {
  const prompt = useStore((s) => s.prompt)
  const negativePrompt = useStore((s) => s.negativePrompt)
  const params = useStore((s) => s.params)
  const activeLoras = useStore((s) => s.activeLoras)
  const models = useStore((s) => s.models)
  const selectedModelTitle = useStore((s) => s.selectedModelTitle)
  const isGenerating = useStore((s) => s.isGenerating)
  const lastImage = useStore((s) => s.lastImage)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNegativePrompt = useStore((s) => s.setNegativePrompt)
  const patchParams = useStore((s) => s.patchParams)
  const setActiveLoras = useStore((s) => s.setActiveLoras)
  const setSelectedModel = useStore((s) => s.setSelectedModel)
  const t = useT()
  const [selectedId, setSelectedId] = useState<NextImageActionId>('continue-seed')
  const [undoSnapshot, setUndoSnapshot] = useState<Snapshot | null>(null)

  const actions = useMemo(() => buildNextImageActions({
    prompt,
    negativePrompt,
    params,
    activeLoras,
    models,
    selectedModelTitle
  }), [activeLoras, models, negativePrompt, params, prompt, selectedModelTitle])

  if (!lastImage) return null

  const selected = actions.find((action) => action.id === selectedId) ?? actions[0]
  if (!selected) return null

  function applyAction(action: NextImageAction): void {
    if (isGenerating) return
    if (action.kind === 'variation') {
      onOpenVariation()
      toast(tStatic('nextImage.variationOpened'), { icon: 'i' })
      return
    }
    if (!action.patch) return
    setUndoSnapshot({
      prompt,
      negativePrompt,
      params: { ...params },
      activeLoras: activeLoras.map((lora) => ({ ...lora, triggerWords: [...lora.triggerWords] })),
      selectedModelTitle
    })
    applyPatch(action.patch)
    toast.success(tStatic('nextImage.applied'))
  }

  function applyPatch(patch: NextImagePatch): void {
    if (patch.prompt !== undefined) setPrompt(patch.prompt)
    if (patch.negativePrompt !== undefined) setNegativePrompt(patch.negativePrompt)
    if (patch.params) patchParams(patch.params)
    if (patch.activeLoras !== undefined) setActiveLoras(patch.activeLoras)
    if (patch.selectedModelTitle !== undefined) setSelectedModel(patch.selectedModelTitle)
  }

  function undo(): void {
    if (!undoSnapshot) return
    setPrompt(undoSnapshot.prompt)
    setNegativePrompt(undoSnapshot.negativePrompt)
    patchParams(undoSnapshot.params)
    setActiveLoras(undoSnapshot.activeLoras)
    setSelectedModel(undoSnapshot.selectedModelTitle)
    setUndoSnapshot(null)
    toast.success(tStatic('nextImage.undone'))
  }

  return (
    <section className="border-t border-line bg-bg-1/95 px-3 py-2 shrink-0 space-y-2" data-testid="next-image-panel">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-ink-1">
          <Wand2 className="h-3.5 w-3.5 text-accent" />
          <span>{t('nextImage.title')}</span>
        </div>
        <span className="hidden md:inline text-[10px] text-ink-3">{t('nextImage.hint')}</span>
        {undoSnapshot && (
          <button type="button" className="btn btn-ghost ml-auto gap-1 py-1 text-[11px]" onClick={undo} disabled={isGenerating} data-testid="next-image-undo">
            <RotateCcw className="h-3 w-3" />
            {t('nextImage.undo')}
          </button>
        )}
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {actions.map((action) => {
          const Icon = ICONS[action.icon]
          const active = action.id === selected.id
          return (
            <button
              key={action.id}
              type="button"
              className={cn('btn shrink-0 gap-1.5 px-2 py-1 text-[11px]', active && 'btn-primary')}
              onClick={() => setSelectedId(action.id)}
              disabled={isGenerating}
              title={t(action.summaryKey)}
              data-testid={`next-image-action-${action.id}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(action.labelKey)}
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2 rounded-md border border-line/70 bg-bg-0/70 p-2">
        <div className="min-w-0 space-y-1">
          <div className="text-[11px] font-medium text-ink-1">{t(selected.summaryKey)}</div>
          <PreviewLine label={t('nextImage.previewPositive')} tone="ok" values={selected.preview.addedPositive} prefix="+" />
          <PreviewLine label={t('nextImage.previewRemoved')} tone="warn" values={selected.preview.removedPositive} prefix="-" />
          <PreviewLine label={t('nextImage.previewNegative')} tone="bad" values={selected.preview.addedNegative} prefix="+" />
          <PreviewLine label={t('nextImage.previewParams')} tone="info" values={selected.preview.paramChanges} />
        </div>
        <button type="button" className="btn btn-primary self-center gap-1 px-2 py-1.5 text-xs" onClick={() => applyAction(selected)} disabled={isGenerating} data-testid="next-image-apply">
          <Wand2 className="h-3.5 w-3.5" />
          {selected.kind === 'variation' ? t('nextImage.openVariation') : t('nextImage.apply')}
        </button>
      </div>
    </section>
  )
}

function PreviewLine({
  label,
  values,
  prefix = '',
  tone
}: {
  label: string
  values: string[]
  prefix?: string
  tone: 'ok' | 'warn' | 'bad' | 'info'
}): JSX.Element | null {
  if (values.length === 0) return null
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 text-[10px]">
      <span className="text-ink-3">{label}</span>
      {values.slice(0, 8).map((value) => (
        <span
          key={`${label}:${value}`}
          className={cn(
            'max-w-[180px] truncate rounded border px-1.5 py-0.5 font-mono',
            tone === 'ok' && 'border-ok/35 text-ok',
            tone === 'warn' && 'border-warn/35 text-warn',
            tone === 'bad' && 'border-err/35 text-err',
            tone === 'info' && 'border-accent/35 text-accent'
          )}
          title={value}
        >
          {prefix}{value}
        </span>
      ))}
    </div>
  )
}
