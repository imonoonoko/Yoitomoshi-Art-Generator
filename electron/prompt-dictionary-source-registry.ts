import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  PromptDictionarySourceAllowedMode,
  PromptDictionarySourceDefinition,
  PromptDictionarySourceQueryValue,
  PromptDictionarySourceRegistryResult,
  PromptDictionarySourceType
} from '../src/shared/types.js'

const REGISTRY_RELATIVE_PATH = join('prompt-dictionary', 'sources.json')
const SOURCE_TYPES = new Set<PromptDictionarySourceType>(['api', 'dataset', 'local', 'manual', 'blocked'])
const ALLOWED_MODES = new Set<PromptDictionarySourceAllowedMode>(['enabled', 'manual-only', 'disabled'])

interface RawRegistry {
  schemaVersion?: unknown
  updatedAt?: unknown
  sources?: unknown
}

export function promptDictionarySourceRegistryPath(resourcesDir: string): string {
  return join(resourcesDir, REGISTRY_RELATIVE_PATH)
}

export function loadPromptDictionarySourceRegistry(resourcesDir: string): PromptDictionarySourceRegistryResult {
  const registryPath = promptDictionarySourceRegistryPath(resourcesDir)
  const parsed = JSON.parse(readFileSync(registryPath, 'utf8')) as RawRegistry
  const warnings: string[] = []

  const schemaVersion = readPositiveInteger(parsed.schemaVersion, 'schemaVersion')
  const updatedAt = readString(parsed.updatedAt, 'updatedAt')
  if (!Array.isArray(parsed.sources)) {
    throw new Error('Prompt dictionary source registry must contain a sources array')
  }

  const seen = new Set<string>()
  const sources: PromptDictionarySourceDefinition[] = []
  for (const rawSource of parsed.sources) {
    const source = normalizeSource(rawSource)
    if (seen.has(source.sourceId)) {
      throw new Error(`Duplicate prompt dictionary source id: ${source.sourceId}`)
    }
    seen.add(source.sourceId)
    if (source.storesImages) {
      throw new Error(`Prompt dictionary source must not store images: ${source.sourceId}`)
    }
    if (source.sourceType === 'blocked' && source.allowedMode !== 'disabled') {
      warnings.push(`${source.sourceId}: blocked source should use allowedMode=disabled`)
    }
    if (source.allowedMode === 'enabled' && source.sourceType === 'blocked') {
      throw new Error(`Blocked prompt dictionary source cannot be enabled: ${source.sourceId}`)
    }
    if (source.allowedMode !== 'disabled' && !source.licenseNote.trim()) {
      warnings.push(`${source.sourceId}: licenseNote is empty`)
    }
    sources.push(source)
  }

  return {
    schemaVersion,
    updatedAt,
    registryPath,
    sources,
    warnings
  }
}

function normalizeSource(raw: unknown): PromptDictionarySourceDefinition {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Prompt dictionary source must be an object')
  }
  const value = raw as Record<string, unknown>
  const sourceId = readIdentifier(value.sourceId, 'sourceId')
  const sourceType = readEnum(value.sourceType, SOURCE_TYPES, `${sourceId}.sourceType`)
  const allowedMode = readEnum(value.allowedMode, ALLOWED_MODES, `${sourceId}.allowedMode`)
  const defaultQuery = normalizeDefaultQuery(value.defaultQuery, sourceId)

  return {
    sourceId,
    displayName: readString(value.displayName, `${sourceId}.displayName`),
    sourceType,
    allowedMode,
    baseUrl: readOptionalString(value.baseUrl),
    termsUrl: readOptionalString(value.termsUrl),
    licenseNote: readOptionalString(value.licenseNote),
    rateLimitRps: readRateLimit(value.rateLimitRps, `${sourceId}.rateLimitRps`),
    storesRawPrompts: value.storesRawPrompts === true,
    storesImages: value.storesImages === true,
    adultPolicy: readOptionalString(value.adultPolicy),
    checkedAt: readString(value.checkedAt, `${sourceId}.checkedAt`),
    ...(defaultQuery ? { defaultQuery } : {})
  }
}

function normalizeDefaultQuery(
  input: unknown,
  sourceId: string
): Record<string, PromptDictionarySourceQueryValue> | undefined {
  if (input == null) return undefined
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${sourceId}.defaultQuery must be an object`)
  }
  const out: Record<string, PromptDictionarySourceQueryValue> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) {
      throw new Error(`${sourceId}.defaultQuery contains invalid key: ${key}`)
    }
    out[key] = normalizeDefaultQueryValue(value, `${sourceId}.defaultQuery.${key}`)
  }
  return out
}

function normalizeDefaultQueryValue(input: unknown, fieldName: string): PromptDictionarySourceQueryValue {
  if (typeof input === 'string' || typeof input === 'boolean') return input
  if (typeof input === 'number' && Number.isFinite(input)) return input
  if (Array.isArray(input)) {
    return input.map((item, index) =>
      normalizeDefaultQueryScalar(item, `${fieldName}[${index}]`)
    )
  }
  throw new Error(`${fieldName} must be a string, number, boolean, or an array of those values`)
}

function normalizeDefaultQueryScalar(input: unknown, fieldName: string): string | number | boolean {
  if (typeof input === 'string' || typeof input === 'boolean') return input
  if (typeof input === 'number' && Number.isFinite(input)) return input
  throw new Error(`${fieldName} must be a string, number, or boolean`)
}

function readIdentifier(input: unknown, fieldName: string): string {
  const value = readString(input, fieldName)
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(value)) {
    throw new Error(`Invalid prompt dictionary source ${fieldName}: ${value}`)
  }
  return value
}

function readString(input: unknown, fieldName: string): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error(`Prompt dictionary source registry ${fieldName} must be a non-empty string`)
  }
  return input.trim()
}

function readOptionalString(input: unknown): string {
  return typeof input === 'string' ? input.trim() : ''
}

function readPositiveInteger(input: unknown, fieldName: string): number {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 1) {
    throw new Error(`Prompt dictionary source registry ${fieldName} must be a positive integer`)
  }
  return input
}

function readRateLimit(input: unknown, fieldName: string): number {
  if (input == null) return 0
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 0 || input > 10) {
    throw new Error(`${fieldName} must be a number between 0 and 10`)
  }
  return input
}

function readEnum<T extends string>(input: unknown, allowed: Set<T>, fieldName: string): T {
  if (typeof input !== 'string' || !allowed.has(input as T)) {
    throw new Error(`${fieldName} has invalid value: ${String(input)}`)
  }
  return input as T
}
