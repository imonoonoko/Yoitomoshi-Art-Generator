import { Database } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { ModelLibraryCard } from './ToolsWorkspace'

export function ModelLibraryWorkspace(): JSX.Element {
  const t = useT()
  return (
    <main className="flex-1 overflow-auto p-6" data-testid="model-library-workspace">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-semibold text-ink-1">{t('tools.library.title')}</h2>
        </div>
        <ModelLibraryCard />
      </div>
    </main>
  )
}
