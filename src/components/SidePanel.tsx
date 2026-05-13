import { lazy, Suspense } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { Library, History, Star, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/lib/store'
import { useT, t as tStatic } from '@/lib/i18n'

const PromptLibrary = lazy(() =>
  import('./PromptLibrary').then((m) => ({ default: m.PromptLibrary }))
)
const LoraPanel = lazy(() =>
  import('./LoraPanel').then((m) => ({ default: m.LoraPanel }))
)
const HistoryGallery = lazy(() =>
  import('./HistoryGallery').then((m) => ({ default: m.HistoryGallery }))
)
const PresetList = lazy(() =>
  import('./PresetList').then((m) => ({ default: m.PresetList }))
)

const TAB_BTN =
  'flex-1 flex items-center justify-center gap-1 py-2 text-xs text-ink-2 ' +
  'data-[state=active]:text-ink-0 data-[state=active]:bg-bg-2 ' +
  'border-b-2 border-transparent data-[state=active]:border-accent transition-colors'

export function SidePanel(): JSX.Element {
  const activeCount = useStore((s) => s.activeLoras.length)
  const t = useT()
  return (
    <Tabs.Root
      defaultValue="library"
      className="w-[400px] shrink-0 flex flex-col bg-bg-1 border-l border-line min-h-0"
    >
      <Tabs.List className="flex shrink-0 border-b border-line bg-bg-1">
        <Tabs.Trigger value="library" className={cn(TAB_BTN)} data-testid="side-tab-library">
          <Library className="h-3.5 w-3.5" /> {t('side.library')}
        </Tabs.Trigger>
        <Tabs.Trigger value="lora" className={cn(TAB_BTN, 'relative')} data-testid="side-tab-lora">
          <Layers className="h-3.5 w-3.5" /> LoRA
          {activeCount > 0 && (
            <span className="absolute -top-0.5 right-1 bg-accent text-bg-0 text-[9px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
              {activeCount}
            </span>
          )}
        </Tabs.Trigger>
        <Tabs.Trigger value="history" className={cn(TAB_BTN)} data-testid="side-tab-history">
          <History className="h-3.5 w-3.5" /> {t('side.history')}
        </Tabs.Trigger>
        <Tabs.Trigger value="presets" className={cn(TAB_BTN)} data-testid="side-tab-presets">
          <Star className="h-3.5 w-3.5" /> {t('side.presets')}
        </Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="library" className="flex-1 min-h-0 outline-none" data-testid="side-content-library">
        <Suspense fallback={<SidePanelLoading />}>
          <PromptLibrary />
        </Suspense>
      </Tabs.Content>
      <Tabs.Content value="lora" className="flex-1 min-h-0 outline-none" data-testid="side-content-lora">
        <Suspense fallback={<SidePanelLoading />}>
          <LoraPanel />
        </Suspense>
      </Tabs.Content>
      <Tabs.Content value="history" className="flex-1 min-h-0 overflow-hidden outline-none" data-testid="side-content-history">
        <Suspense fallback={<SidePanelLoading />}>
          <HistoryGallery />
        </Suspense>
      </Tabs.Content>
      <Tabs.Content value="presets" className="flex-1 min-h-0 outline-none" data-testid="side-content-presets">
        <Suspense fallback={<SidePanelLoading />}>
          <PresetList />
        </Suspense>
      </Tabs.Content>
    </Tabs.Root>
  )
}

function SidePanelLoading(): JSX.Element {
  return <div className="p-4 text-sm text-ink-3">{tStatic('common.loading')}</div>
}
