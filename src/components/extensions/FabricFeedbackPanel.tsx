import { AlertTriangle, Heart, ImagePlus, ThumbsDown, ThumbsUp, Trash2, Upload } from 'lucide-react'
import { useRef } from 'react'
import toast from 'react-hot-toast'
import { useStore, type FabricFeedbackItem } from '@/lib/store'
import { api } from '@/lib/ipc'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { hasActiveControlNetReference } from '@/lib/extension-guards'
import { CollapsiblePanel } from '../CollapsiblePanel'

type FeedbackKind = 'positive' | 'negative'

export function FabricFeedbackPanel(): JSX.Element {
  const fabric = useStore((s) => s.fabric)
  const controlnetReferenceActive = useStore((s) => hasActiveControlNetReference(s.controlnet))
  const patch = useStore((s) => s.patchFabric)
  const lastImage = useStore((s) => s.lastImage)
  const inputImage = useStore((s) => s.inputImage)
  const t = useT()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pendingKindRef = useRef<FeedbackKind>('positive')

  async function addFeedback(image: string | null, kind: FeedbackKind, sourceLabel: string): Promise<void> {
    if (!image) {
      toast.error(tStatic('fabric.needImage'))
      return
    }
    try {
      const saved = await api.storage.saveFabricFeedbackImage(image)
      const item: FabricFeedbackItem = {
        filename: saved.filename,
        path: saved.path,
        image,
        sourceLabel,
        addedAt: Date.now()
      }
      const list = kind === 'positive' ? fabric.positive : fabric.negative
      patch({
        enabled: true,
        [kind]: [...list.filter((current) => current.filename !== item.filename), item]
      } as Partial<typeof fabric>)
      toast.success(tStatic(kind === 'positive' ? 'fabric.addedPositive' : 'fabric.addedNegative'))
    } catch (e) {
      toast.error(tStatic('fabric.saveFailed', { message: (e as Error).message }))
    }
  }

  function removeFeedback(kind: FeedbackKind, filename: string): void {
    const list = kind === 'positive' ? fabric.positive : fabric.negative
    patch({ [kind]: list.filter((item) => item.filename !== filename) } as Partial<typeof fabric>)
  }

  function openUpload(kind: FeedbackKind): void {
    pendingKindRef.current = kind
    fileInputRef.current?.click()
  }

  async function handleFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      toast.error(tStatic('cn.notAnImage'))
      return
    }
    const dataUrl = await readFileAsDataUrl(file)
    await addFeedback(dataUrl, pendingKindRef.current, file.name)
  }

  const activeFeedbackCount = fabric.positive.length + fabric.negative.length
  const conflictWarning = fabric.enabled && activeFeedbackCount > 0 && controlnetReferenceActive

  return (
    <CollapsiblePanel
      title={t('fabric.title')}
      hint={t('fabric.hint')}
      enabled={fabric.enabled}
      onEnabledChange={(enabled) => patch({ enabled })}
      testId="fabric-panel"
    >
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <FeedbackActions
            tone="positive"
            onLast={() => { void addFeedback(lastImage, 'positive', tStatic('fabric.sourceLast')) }}
            onInput={() => { void addFeedback(inputImage, 'positive', tStatic('fabric.sourceInput')) }}
            onUpload={() => openUpload('positive')}
          />
          <FeedbackActions
            tone="negative"
            onLast={() => { void addFeedback(lastImage, 'negative', tStatic('fabric.sourceLast')) }}
            onInput={() => { void addFeedback(inputImage, 'negative', tStatic('fabric.sourceInput')) }}
            onUpload={() => openUpload('negative')}
          />
        </div>

        {conflictWarning && (
          <div className="flex items-start gap-1.5 rounded-md border border-warn/45 bg-warn/5 p-2 text-[10px] leading-relaxed text-warn">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{t('guard.fabricControlnetReference')}</span>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
            e.target.value = ''
          }}
        />

        <div className="grid grid-cols-2 gap-2">
          <FeedbackList
            title={t('fabric.positive')}
            kind="positive"
            items={fabric.positive}
            onRemove={(filename) => removeFeedback('positive', filename)}
          />
          <FeedbackList
            title={t('fabric.negative')}
            kind="negative"
            items={fabric.negative}
            onRemove={(filename) => removeFeedback('negative', filename)}
          />
        </div>

        <div className="rounded-md border border-line bg-bg-2/50 p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 text-[10px] text-ink-3">
              <Heart className="h-3 w-3 text-accent" />
              {t('fabric.feedbackCount', { count: activeFeedbackCount })}
            </div>
            <button
              type="button"
              className="text-[10px] text-ink-3 hover:text-ink-1"
              onClick={() => patch({ positive: [], negative: [] })}
            >
              {t('fabric.clear')}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <RangeField label={t('fabric.strength')} value={fabric.maxWeight} min={0} max={1} step={0.05} onChange={(maxWeight) => patch({ maxWeight })} />
            <RangeField label={t('fabric.negativeWeight')} value={fabric.negativeWeight} min={0} max={1} step={0.05} onChange={(negativeWeight) => patch({ negativeWeight })} />
            <RangeField label={t('fabric.start')} value={fabric.start} min={0} max={1} step={0.01} onChange={(start) => patch({ start: Math.min(start, fabric.end) })} />
            <RangeField label={t('fabric.end')} value={fabric.end} min={0} max={1} step={0.01} onChange={(end) => patch({ end: Math.max(end, fabric.start) })} />
          </div>
          <label className="mt-2 flex items-center gap-2 text-[11px] text-ink-2">
            <input
              type="checkbox"
              checked={fabric.burnoutProtection}
              onChange={(e) => patch({ burnoutProtection: e.target.checked })}
            />
            <span>{t('fabric.burnoutProtection')}</span>
          </label>
          <label className="mt-1 flex items-center gap-2 text-[11px] text-ink-2">
            <input
              type="checkbox"
              checked={fabric.tomeEnabled}
              onChange={(e) => patch({ tomeEnabled: e.target.checked })}
            />
            <span>{t('fabric.tome')}</span>
          </label>
        </div>
      </div>
    </CollapsiblePanel>
  )
}

function FeedbackActions({
  tone,
  onLast,
  onInput,
  onUpload
}: {
  tone: FeedbackKind
  onLast(): void
  onInput(): void
  onUpload(): void
}): JSX.Element {
  const t = useT()
  const positive = tone === 'positive'
  return (
    <div className={cn('rounded-md border bg-bg-2/50 p-2', positive ? 'border-accent/40' : 'border-warn/40')}>
      <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-ink-1">
        {positive ? <ThumbsUp className="h-3.5 w-3.5 text-accent" /> : <ThumbsDown className="h-3.5 w-3.5 text-warn" />}
        {t(positive ? 'fabric.positive' : 'fabric.negative')}
      </div>
      <div className="grid grid-cols-3 gap-1">
        <MiniButton onClick={onLast} title={t('fabric.addLast')}><ImagePlus className="h-3 w-3" /></MiniButton>
        <MiniButton onClick={onInput} title={t('fabric.addInput')}><Heart className="h-3 w-3" /></MiniButton>
        <MiniButton onClick={onUpload} title={t('fabric.upload')}><Upload className="h-3 w-3" /></MiniButton>
      </div>
    </div>
  )
}

function FeedbackList({
  title,
  kind,
  items,
  onRemove
}: {
  title: string
  kind: FeedbackKind
  items: FabricFeedbackItem[]
  onRemove(filename: string): void
}): JSX.Element {
  const t = useT()
  return (
    <div className="rounded-md border border-line bg-bg-2/40 p-2">
      <div className="mb-1 text-[10px] text-ink-3">{title}</div>
      {items.length === 0 ? (
        <div className="flex h-20 items-center justify-center rounded bg-bg-3 text-[10px] text-ink-3">
          {t('fabric.empty')}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1">
          {items.map((item) => (
            <div key={`${kind}:${item.filename}`} className="group relative">
              <img src={item.image} alt={item.sourceLabel} className="h-16 w-full rounded bg-bg-3 object-cover" />
              <button
                type="button"
                className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded bg-bg-1/85 text-ink-2 hover:text-ink-0 group-hover:flex"
                onClick={() => onRemove(item.filename)}
                title={t('fabric.remove')}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MiniButton({ title, onClick, children }: { title: string; onClick(): void; children: JSX.Element }): JSX.Element {
  return (
    <button type="button" className="btn btn-ghost h-7 justify-center px-1" onClick={onClick} title={title}>
      {children}
    </button>
  )
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange(value: number): void
}): JSX.Element {
  return (
    <label className="block">
      <span className="flex justify-between gap-2 text-[10px] text-ink-3">
        <span>{label}</span>
        <span className="font-mono">{value.toFixed(2)}</span>
      </span>
      <input
        className="w-full accent-accent"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}
