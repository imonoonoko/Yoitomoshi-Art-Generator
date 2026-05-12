import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { useMemo } from 'react'
import { useStore, type AppState } from '@/lib/store'
import { useT } from '@/lib/i18n'
import { getExtensionGuardIssues } from '@/lib/extension-guards'
import { cn } from '@/lib/utils'

type PreflightSeverity = 'block' | 'warn' | 'ok'

interface PreflightItem {
  severity: PreflightSeverity
  key: string
  messageKey: string
  params?: Record<string, string | number>
}

export function GenerationPreflightPanel(): JSX.Element {
  const state = useStore((s) => s)
  const t = useT()
  const items = useMemo(() => buildPreflightItems(state), [state])
  const blockers = items.filter((item) => item.severity === 'block').length
  const warnings = items.filter((item) => item.severity === 'warn').length
  const ok = blockers === 0 && warnings === 0

  return (
    <section className="rounded-md border border-line bg-bg-0/50 p-2 text-[11px]">
      <div className="flex items-center gap-1.5 text-ink-2">
        {ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-ok" />
        ) : blockers > 0 ? (
          <AlertTriangle className="h-3.5 w-3.5 text-warn" />
        ) : (
          <Info className="h-3.5 w-3.5 text-accent" />
        )}
        <span className="font-medium text-ink-1">{t('preflight.title')}</span>
        <span className={cn(
          'ml-auto rounded border px-1.5 py-0.5 font-mono text-[10px]',
          ok
            ? 'border-ok/45 text-ok'
            : blockers > 0
              ? 'border-warn/45 text-warn'
              : 'border-accent/45 text-accent'
        )}>
          {ok
            ? t('preflight.ready')
            : t('preflight.summary', { blocks: blockers, warnings })}
        </span>
      </div>

      {!ok && (
        <div className="mt-2 space-y-1">
          {items.filter((item) => item.severity !== 'ok').slice(0, 6).map((item) => (
            <div key={item.key} className="flex items-start gap-1.5 leading-relaxed">
              {item.severity === 'block' ? (
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warn" />
              ) : (
                <Info className="mt-0.5 h-3 w-3 shrink-0 text-accent" />
              )}
              <span className={item.severity === 'block' ? 'text-warn' : 'text-ink-3'}>
                {t(item.messageKey, item.params)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function buildPreflightItems(state: AppState): PreflightItem[] {
  const items: PreflightItem[] = []

  if (state.forgeStatus.kind !== 'ready') {
    items.push({
      severity: 'block',
      key: 'forge',
      messageKey: 'preflight.forgeNotReady',
      params: { status: state.forgeStatus.kind }
    })
  }
  if (!state.selectedModelTitle) {
    items.push({ severity: 'block', key: 'model', messageKey: 'preflight.noModel' })
  }
  if (state.currentTab !== 'txt2img' && state.currentTab !== 'img2img') {
    items.push({
      severity: 'block',
      key: 'tab',
      messageKey: 'preflight.unsupportedTab',
      params: { tab: state.currentTab }
    })
  }
  if (state.currentTab === 'img2img' && !state.inputImage) {
    items.push({ severity: 'block', key: 'img2img-image', messageKey: 'preflight.img2imgNeedsImage' })
  }

  for (const issue of getExtensionGuardIssues(state)) {
    items.push({
      severity: 'block',
      key: issue.code,
      messageKey: issue.messageKey,
      params: issue.params
    })
  }

  if (state.selectedVae !== 'Automatic' && state.selectedVae !== 'None') {
    const hasVae = state.vaes.some((vae) => vae.modelName === state.selectedVae)
    if (!hasVae) {
      items.push({
        severity: 'warn',
        key: 'vae',
        messageKey: 'preflight.vaeMissing',
        params: { name: state.selectedVae }
      })
    }
  }

  const knownLoras = new Set(state.loras.map((lora) => lora.name))
  const missingLoras = state.activeLoras.filter((lora) => !knownLoras.has(lora.name))
  if (missingLoras.length > 0) {
    items.push({
      severity: 'warn',
      key: 'lora',
      messageKey: 'preflight.loraMissing',
      params: { count: missingLoras.length }
    })
  }

  if (state.controlnet.enabled) {
    const enabledUnits = state.controlnet.units.filter((unit) => unit.enabled)
    if (enabledUnits.length === 0) {
      items.push({ severity: 'warn', key: 'cn-none', messageKey: 'preflight.controlnetNoEnabledUnits' })
    }
    enabledUnits.forEach((unit, index) => {
      if (!unit.image) {
        items.push({
          severity: 'block',
          key: `cn-image-${index}`,
          messageKey: 'preflight.controlnetNoImage',
          params: { unit: index + 1 }
        })
      }
      if (unit.model === 'None' && !unit.module.toLowerCase().includes('reference')) {
        items.push({
          severity: 'warn',
          key: `cn-model-${index}`,
          messageKey: 'preflight.controlnetModelMissing',
          params: { unit: index + 1 }
        })
      }
    })
  }

  if (state.fabric.enabled && state.fabric.positive.length + state.fabric.negative.length === 0) {
    items.push({ severity: 'warn', key: 'fabric-empty', messageKey: 'preflight.fabricNoFeedback' })
  }
  if (state.adetailer.enabled && state.adetailer.units.every((unit) => unit.model === 'None')) {
    items.push({ severity: 'warn', key: 'adetailer-empty', messageKey: 'preflight.adetailerNoModel' })
  }

  if (items.length === 0) {
    items.push({ severity: 'ok', key: 'ok', messageKey: 'preflight.ok' })
  }
  return items
}
