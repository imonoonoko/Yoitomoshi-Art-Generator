import type { AppState, ControlNetState, RegionalPrompterState } from './store'

export type ExtensionGuardSeverity = 'block'

export interface ExtensionGuardIssue {
  code:
    | 'fabric-controlnet-reference'
    | 'regional-ratio-invalid'
    | 'regional-region-count-mismatch'
    | 'regional-prompt-count-mismatch'
    | 'regional-empty-region'
  severity: ExtensionGuardSeverity
  messageKey: string
  params?: Record<string, string | number>
}

export interface RegionalValidation {
  areaCount: number | null
  expectedPromptParts: number | null
  promptParts: number
  issues: ExtensionGuardIssue[]
}

export function getExtensionGuardIssues(state: AppState): ExtensionGuardIssue[] {
  const issues: ExtensionGuardIssue[] = []

  if (hasActiveFabricFeedback(state) && hasActiveControlNetReference(state.controlnet)) {
    issues.push({
      code: 'fabric-controlnet-reference',
      severity: 'block',
      messageKey: 'guard.fabricControlnetReference'
    })
  }

  issues.push(...getRegionalValidation(state.regionalPrompter, state.prompt).issues)
  return issues
}

export function hasActiveFabricFeedback(state: Pick<AppState, 'fabric'>): boolean {
  return state.fabric.enabled && (state.fabric.positive.length > 0 || state.fabric.negative.length > 0)
}

export function hasActiveControlNetReference(controlnet: ControlNetState): boolean {
  return controlnet.enabled && controlnet.units.some(isActiveReferenceUnit)
}

export function isActiveReferenceUnit(unit: ControlNetState['units'][number]): boolean {
  if (!unit.enabled) return false
  const module = unit.module.toLowerCase()
  const model = unit.model.toLowerCase()
  return module.includes('reference') || model.includes('reference')
}

export function getRegionalValidation(
  regional: RegionalPrompterState,
  prompt: string
): RegionalValidation {
  const areaCount = countRegionalAreasFromRatios(regional.ratios)
  const promptParts = countRegionalPromptParts(prompt)
  const issues: ExtensionGuardIssue[] = []

  if (!regional.enabled) {
    return { areaCount, expectedPromptParts: null, promptParts, issues }
  }

  if (regional.regionPrompts.some((item) => item.trim().length === 0)) {
    issues.push({
      code: 'regional-empty-region',
      severity: 'block',
      messageKey: 'guard.regionalEmptyRegion'
    })
  }

  if (areaCount == null) {
    issues.push({
      code: 'regional-ratio-invalid',
      severity: 'block',
      messageKey: 'guard.regionalRatioInvalid'
    })
    return { areaCount, expectedPromptParts: null, promptParts, issues }
  }

  if (areaCount !== regional.regionPrompts.length) {
    issues.push({
      code: 'regional-region-count-mismatch',
      severity: 'block',
      messageKey: 'guard.regionalRegionCountMismatch',
      params: { expected: areaCount, actual: regional.regionPrompts.length }
    })
  }

  const expectedPromptParts = areaCount + (regional.useCommon ? 1 : 0) + (regional.useBase ? 1 : 0)
  if (promptParts !== expectedPromptParts) {
    issues.push({
      code: 'regional-prompt-count-mismatch',
      severity: 'block',
      messageKey: 'guard.regionalPromptCountMismatch',
      params: { expected: expectedPromptParts, actual: promptParts }
    })
  }

  return { areaCount, expectedPromptParts, promptParts, issues }
}

export function countRegionalAreasFromRatios(rawRatios: string): number | null {
  const rows = rawRatios
    .split(';')
    .map((row) => row.trim())
    .filter(Boolean)
  if (rows.length === 0) return null

  let count = 0
  for (const row of rows) {
    const cells = row
      .split(',')
      .map((cell) => cell.trim())
      .filter(Boolean)
    if (cells.length === 0) return null
    for (const cell of cells) {
      const value = Number(cell)
      if (!Number.isFinite(value) || value <= 0) return null
    }
    count += cells.length
  }
  return count
}

export function countRegionalPromptParts(prompt: string): number {
  return prompt
    .split(/\b(?:BREAK|ADDROW|ADDCOL|ADDBASE|ADDCOMM)\b/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .length
}
