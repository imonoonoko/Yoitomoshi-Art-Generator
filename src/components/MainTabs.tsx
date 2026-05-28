import { useStore, type WorkspaceTab } from '@/lib/store'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { BookOpenText, Clapperboard, Database, Tags, Type, Image as ImageIcon, Maximize2, Wrench } from 'lucide-react'

/**
 * Top-level workspace tab strip. Sits between the title bar and the main
 * content area. Each tab can own a distinct layout, so workspace-scale
 * workflows belong here while smaller helpers stay inside collapsible panels.
 *
 * Why hand-rolled instead of `@radix-ui/react-tabs`: Radix couples the tab
 * trigger to its `Tabs.Content` siblings, and our content for each tab is
 * a different *layout* (3-column vs single-column for tools), not just a
 * different content node. A simple controlled button strip backed by the
 * store gives us full layout control in App.tsx without contortion.
 */
const TABS: { id: WorkspaceTab; iconKey: 'txt' | 'img' | 'dict' | 'tags' | 'video' | 'up' | 'models' | 'tool' }[] = [
  { id: 'txt2img', iconKey: 'txt' },
  { id: 'img2img', iconKey: 'img' },
  { id: 'dictionary', iconKey: 'dict' },
  { id: 'tags', iconKey: 'tags' },
  { id: 'video', iconKey: 'video' },
  { id: 'upscale', iconKey: 'up' },
  { id: 'models',  iconKey: 'models' },
  { id: 'tools',   iconKey: 'tool' }
]

const ICON_BY_KEY = {
  txt:  Type,
  img:  ImageIcon,
  dict: BookOpenText,
  tags: Tags,
  video: Clapperboard,
  up:   Maximize2,
  models: Database,
  tool: Wrench
}

export function MainTabs(): JSX.Element {
  const current = useStore((s) => s.currentTab)
  const setCurrent = useStore((s) => s.setCurrentTab)
  const t = useT()

  return (
    <div
      className="flex items-stretch h-9 px-3 gap-0.5 bg-bg-1 border-b border-line shrink-0"
      role="tablist"
      aria-label="workspace"
    >
      {TABS.map((tab) => {
        const Icon = ICON_BY_KEY[tab.iconKey]
        const active = current === tab.id
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            data-testid={`main-tab-${tab.id}`}
            className={cn(
              'flex items-center gap-1.5 px-3 text-xs transition-colors border-b-2',
              active
                ? 'text-accent border-accent'
                : 'text-ink-2 hover:text-ink-1 border-transparent'
            )}
            onClick={() => setCurrent(tab.id)}
            title={t(`tab.${tab.id}.hint`)}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{t(`tab.${tab.id}`)}</span>
          </button>
        )
      })}
    </div>
  )
}
