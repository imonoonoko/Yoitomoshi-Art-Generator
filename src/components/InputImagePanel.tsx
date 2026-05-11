import { useEffect, useRef, useState } from 'react'
import { X, ScanLine, Image as ImageIcon, Plus, Upload, Paintbrush, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { promptAppend } from '@/lib/prompt-utils'
import { useT, t as tStatic } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * img2img input image controls.
 *
 * What it does:
 *   - Empty state: drag-and-drop / Ctrl+V / file picker prompt. Tells the user
 *     this tab needs an input image and how to provide one.
 *   - Loaded state: thumbnail + filename + dismiss (×)
 *   - Denoising-strength slider (0 = identical, 1 = ignore source)
 *   - "タグ抽出" — calls Forge's interrogator to pull a danbooru-style tag list
 *     from the image, then renders them as clickable chips that splice into the
 *     positive prompt. Cheap way to seed a prompt from a reference image.
 */
export function InputImagePanel(): JSX.Element {
  const inputImage = useStore((s) => s.inputImage)
  const inputFilename = useStore((s) => s.inputImageFilename)
  const setInputImage = useStore((s) => s.setInputImage)
  const inpaintMaskImage = useStore((s) => s.inpaintMaskImage)
  const setInpaintMaskImage = useStore((s) => s.setInpaintMaskImage)
  const params = useStore((s) => s.params)
  const patchParams = useStore((s) => s.patchParams)
  const extractedTags = useStore((s) => s.extractedTags)
  const setExtractedTags = useStore((s) => s.setExtractedTags)
  const prompt = useStore((s) => s.prompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const status = useStore((s) => s.forgeStatus)
  const t = useT()

  const [interrogating, setInterrogating] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!inputImage) return <EmptyState fileInputRef={fileInputRef} dragOver={dragOver} setDragOver={setDragOver} setInputImage={setInputImage} />

  async function interrogate(): Promise<void> {
    if (status.kind !== 'ready') {
      toast.error(tStatic('inputImage.waitForge'))
      return
    }
    if (!inputImage) return
    setInterrogating(true)
    try {
      const r = await api.forge.interrogate(inputImage, 'deepdanbooru')
      setExtractedTags(r.tags)
      if (r.tags.length === 0) toast(tStatic('inputImage.noTags'), { icon: 'ℹ' })
    } catch (e) {
      toast.error(tStatic('inputImage.interrogateFailed', { message: (e as Error).message }))
    } finally {
      setInterrogating(false)
    }
  }

  function addTag(tag: string): void {
    setPrompt(promptAppend(prompt, tag))
  }

  function addAllTags(): void {
    let next = prompt
    for (const t of extractedTags) next = promptAppend(next, t)
    setPrompt(next)
    toast.success(tStatic('inputImage.tagsAdded', { count: extractedTags.length }))
  }

  function clear(): void {
    setInputImage(null)
    setExtractedTags([])
  }

  return (
    <div className="card p-2 space-y-2">
      <div className="flex gap-2 items-start">
        <img
          src={inputImage}
          alt={t('inputImage.alt')}
          className="w-20 h-20 object-cover rounded bg-bg-3 shrink-0"
        />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-1">
            <ImageIcon className="h-3.5 w-3.5 text-accent" />
            <span className="text-xs text-ink-2 uppercase tracking-wider">img2img</span>
            {inputFilename && (
              <span className="text-[10px] text-ink-3 truncate ml-1 font-mono">{inputFilename}</span>
            )}
            <button
              onClick={clear}
              className="ml-auto btn btn-icon btn-ghost"
              title={t('inputImage.clear')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <label className="block">
            <div className="flex items-baseline justify-between text-[10px] text-ink-3">
              <span>{t('inputImage.denoise')}</span>
              <span className="font-mono text-ink-1">{params.denoisingStrength.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={params.denoisingStrength}
              onChange={(e) => patchParams({ denoisingStrength: parseFloat(e.target.value) })}
              className="w-full accent-accent"
            />
            <div className="flex justify-between text-[9px] text-ink-3">
              <span>{t('inputImage.same')}</span>
              <span>{t('inputImage.largeChange')}</span>
            </div>
          </label>
        </div>
      </div>

      <InpaintMaskEditor
        inputImage={inputImage}
        maskImage={inpaintMaskImage}
        onMaskChange={setInpaintMaskImage}
      />

      <div className="flex gap-1.5">
        <button
          className="btn flex-1 text-xs"
          onClick={interrogate}
          disabled={interrogating || status.kind !== 'ready'}
        >
          <ScanLine className={cn('h-3.5 w-3.5', interrogating && 'animate-pulse')} />
          {interrogating ? t('inputImage.analyzing') : t('inputImage.interrogate')}
        </button>
        {extractedTags.length > 0 && (
          <button className="btn text-xs" onClick={addAllTags} title={t('inputImage.addAllTitle')}>
            <Plus className="h-3.5 w-3.5" />
            {t('inputImage.addAll')}
          </button>
        )}
      </div>

      {extractedTags.length > 0 && (
        <div className="border-t border-line pt-2">
          <div className="text-[10px] text-ink-3 mb-1">{t('inputImage.clickToAdd')}</div>
          <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
            {extractedTags.map((t) => {
              const inPrompt = prompt.toLowerCase().includes(t.toLowerCase())
              return (
                <button
                  key={t}
                  onClick={() => addTag(t)}
                  className={cn(
                    'px-1.5 py-0.5 rounded text-[10px] border transition-all',
                    inPrompt
                      ? 'bg-accent-dim/40 border-accent/60 text-ink-1'
                      : 'border-line text-ink-1 hover:border-accent hover:bg-bg-3'
                  )}
                  title={t}
                >
                  {t}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function InpaintMaskEditor({
  inputImage,
  maskImage: _maskImage,
  onMaskChange
}: {
  inputImage: string
  maskImage: string | null
  onMaskChange: (image: string | null) => void
}): JSX.Element {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [brush, setBrush] = useState(48)
  const [hasMask, setHasMask] = useState(false)

  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      setHasMask(false)
      onMaskChange(null)
    }
    img.src = inputImage
    return () => { cancelled = true }
    // Reset the mask when the base image changes. The store also clears it,
    // but the canvas needs to clear its drawn strokes too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputImage])

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height
    }
  }

  function drawTo(point: { x: number; y: number }): void {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const last = lastPointRef.current ?? point
    const scale = canvas.width / Math.max(canvas.clientWidth, 1)
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.lineWidth = brush * scale
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
    lastPointRef.current = point
  }

  function exportMask(): void {
    const canvas = canvasRef.current
    if (!canvas) return
    const out = document.createElement('canvas')
    out.width = canvas.width
    out.height = canvas.height
    const ctx = out.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = 'black'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(canvas, 0, 0)
    onMaskChange(out.toDataURL('image/png'))
    setHasMask(true)
  }

  function clearMask(): void {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    onMaskChange(null)
    setHasMask(false)
  }

  return (
    <div className="border-t border-line pt-2 space-y-2">
      <div className="flex items-center gap-2">
        <Paintbrush className="h-3.5 w-3.5 text-accent" />
        <span className="text-[11px] font-medium text-ink-1">{t('inputImage.maskTitle')}</span>
        <span className={cn('ml-auto text-[10px]', hasMask ? 'text-ok' : 'text-ink-3')}>
          {hasMask ? t('inputImage.maskEnabled') : t('inputImage.maskDisabled')}
        </span>
      </div>
      <div className="relative rounded overflow-hidden bg-bg-3 max-h-56">
        <img src={inputImage} alt="" className="w-full max-h-56 object-contain pointer-events-none select-none" />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-contain cursor-crosshair touch-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            drawingRef.current = true
            const p = pointFromEvent(e)
            lastPointRef.current = p
            drawTo(p)
          }}
          onPointerMove={(e) => {
            if (!drawingRef.current) return
            drawTo(pointFromEvent(e))
          }}
          onPointerUp={(e) => {
            drawingRef.current = false
            lastPointRef.current = null
            e.currentTarget.releasePointerCapture(e.pointerId)
            exportMask()
          }}
          onPointerCancel={() => {
            drawingRef.current = false
            lastPointRef.current = null
            exportMask()
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="flex-1">
          <div className="flex items-baseline justify-between text-[10px] text-ink-3">
            <span>{t('inputImage.maskBrush')}</span>
            <span className="font-mono text-ink-1">{brush}px</span>
          </div>
          <input
            type="range"
            min={8}
            max={160}
            step={2}
            value={brush}
            onChange={(e) => setBrush(parseInt(e.target.value, 10))}
            className="w-full accent-accent"
          />
        </label>
        <button className="btn btn-icon btn-ghost" onClick={clearMask} title={t('inputImage.maskClear')}>
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-[10px] text-ink-3 leading-relaxed">{t('inputImage.maskHint')}</p>
    </div>
  )
}

/**
 * Drop zone shown on the img2img tab when no input image is set.
 *
 * Three input paths:
 *   1. Drag-and-drop a file from the OS
 *   2. Ctrl+V (handled globally in App.tsx — we just hint here)
 *   3. Click to open the OS file picker
 */
function EmptyState({
  fileInputRef,
  dragOver,
  setDragOver,
  setInputImage
}: {
  // React 19's `useRef<T>(null)` returns `RefObject<T | null>` (the ref is
  // assignable, so the inner type includes null). Match that here so the
  // caller can pass the ref through without a cast.
  fileInputRef: React.RefObject<HTMLInputElement | null>
  dragOver: boolean
  setDragOver: (v: boolean) => void
  setInputImage: (image: string | null, filename?: string | null, sourcePath?: string | null) => void
}): JSX.Element {
  const t = useT()

  function readFile(file: File): void {
    const reader = new FileReader()
    reader.onload = () => setInputImage(reader.result as string, file.name, filePathOf(file))
    reader.readAsDataURL(file)
  }

  return (
    <div
      className={cn(
        'card p-4 text-center transition-colors cursor-pointer',
        dragOver ? 'border-accent bg-accent-dim/10' : 'border-dashed hover:border-ink-2'
      )}
      onClick={() => fileInputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'))
        if (file) readFile(file)
      }}
    >
      <Upload className="h-6 w-6 mx-auto text-ink-3 mb-1.5" />
      <div className="text-xs text-ink-2 leading-relaxed">
        {t('inputImage.dropHint')}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) readFile(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

function filePathOf(file: File): string | null {
  const path = (file as File & { path?: string }).path
  return typeof path === 'string' && path.length > 0 ? path : null
}
