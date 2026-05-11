import { Loader2, AlertTriangle } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/ipc'
import { useT } from '@/lib/i18n'

export function StartupOverlay(): JSX.Element | null {
  const status = useStore((s) => s.forgeStatus)
  const t = useT()

  if (status.kind === 'ready') return null
  if (status.kind === 'stopped') {
    return (
      <Backdrop>
        <div className="text-center space-y-3">
          <h2 className="text-xl font-semibold">{t('startup.stoppedTitle')}</h2>
          <p className="text-ink-2 text-sm">{t('startup.stoppedBody')}</p>
          <button className="btn btn-primary mt-2" onClick={() => api.forge.start()}>
            {t('startup.start')}
          </button>
        </div>
      </Backdrop>
    )
  }
  if (status.kind === 'starting') {
    return (
      <Backdrop>
        <div className="space-y-4 max-w-2xl w-full">
          <div className="flex items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
            <h2 className="text-xl font-semibold">{t('startup.startingTitle')}</h2>
          </div>
          <p className="text-ink-2 text-sm">
            {t('startup.startingBody')}
          </p>
          <pre className="card p-3 max-h-64 overflow-auto text-[11px] font-mono text-ink-2 whitespace-pre-wrap leading-relaxed">
            {status.logTail.join('\n') || '…'}
          </pre>
        </div>
      </Backdrop>
    )
  }
  // error
  return (
    <Backdrop>
      <div className="space-y-4 max-w-2xl w-full">
        <div className="flex items-center gap-3 text-err">
          <AlertTriangle className="h-6 w-6" />
          <h2 className="text-xl font-semibold">{t('startup.errorTitle')}</h2>
        </div>
        <p className="text-ink-1 text-sm">{status.message}</p>
        <pre className="card p-3 max-h-64 overflow-auto text-[11px] font-mono text-ink-2 whitespace-pre-wrap leading-relaxed">
          {status.logTail.join('\n')}
        </pre>
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={() => api.forge.start()}>
            {t('startup.retry')}
          </button>
        </div>
      </div>
    </Backdrop>
  )
}

function Backdrop({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="absolute inset-0 z-40 bg-bg-0/95 backdrop-blur flex items-center justify-center p-8">
      <div className="w-full max-w-2xl">{children}</div>
    </div>
  )
}
