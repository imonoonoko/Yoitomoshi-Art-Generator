import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveBundledResourcePath } from './app-paths.js'
import type {
  PromptTextTranslationMode,
  PromptTextTranslationProvider,
  PromptTextTranslationRequest,
  PromptTextTranslationResult,
  PromptTextTranslationRuntimeStatus,
  PromptTextTranslationSource,
  PromptTextTranslationTarget
} from '../src/shared/types.js'

const PROVIDER: PromptTextTranslationProvider = 'deep-translator-google'
const MAX_PROMPT_TRANSLATION_CHARS = 4000
const TRANSLATION_TIMEOUT_MS = 15_000
const PREPARE_TIMEOUT_MS = 120_000
const IMPORT_TIMEOUT_MS = 8_000
const MAX_PROCESS_OUTPUT_CHARS = 24_000
const DEPENDENCY_SPEC = 'deep-translator==1.11.4'
const HELPER_PATH = resolveBundledResourcePath('python', 'deep_translate_prompt.py')
const JAPANESE_TEXT = /[\u3040-\u30ff\u3400-\u9fff]/

interface CacheFile {
  schema: 1
  entries: Record<string, {
    translatedText: string
    provider: PromptTextTranslationProvider
    source: PromptTextTranslationSource
    target: PromptTextTranslationTarget
    mode: PromptTextTranslationMode
    createdAt: number
  }>
}

let preparePromise: Promise<PromptTextTranslationRuntimeStatus> | null = null

export async function inspectPromptTranslationRuntimeStatus(): Promise<PromptTextTranslationRuntimeStatus> {
  const python = await resolvePython()
  const paths = translationRuntimePaths()
  const deepTranslatorReady = python.pythonExists
    ? await canImportDeepTranslator(python.python, paths.dependencyRoot)
    : false
  const warnings = [
    ...python.warnings,
    ...(!existsSync(HELPER_PATH) ? ['prompt-translator-helper-missing'] : []),
    ...(!deepTranslatorReady ? ['deep-translator-not-ready'] : [])
  ]
  return {
    python: python.python,
    pythonExists: python.pythonExists,
    helperPath: HELPER_PATH,
    helperExists: existsSync(HELPER_PATH),
    runtimeRoot: paths.runtimeRoot,
    dependencyRoot: paths.dependencyRoot,
    dependencyRootExists: existsSync(paths.dependencyRoot),
    deepTranslatorReady,
    preparing: preparePromise !== null,
    warnings: uniqueStrings(warnings)
  }
}

export async function preparePromptTranslationRuntime(): Promise<PromptTextTranslationRuntimeStatus> {
  if (preparePromise) return preparePromise
  preparePromise = preparePromptTranslationRuntimeInner()
  try {
    return await preparePromise
  } finally {
    preparePromise = null
  }
}

export async function translatePromptText(input: unknown): Promise<PromptTextTranslationResult> {
  const req = validatePromptTextTranslationRequest(input)
  const cacheKey = promptTranslationCacheKey(req)
  const cache = readCache()
  const cached = cache.entries[cacheKey]
  if (cached?.translatedText) {
    return {
      translatedText: cached.translatedText,
      provider: cached.provider,
      sourceText: req.text,
      source: cached.source,
      target: cached.target,
      mode: cached.mode,
      cacheHit: true,
      warnings: []
    }
  }

  const status = await preparePromptTranslationRuntime()
  if (!status.pythonExists || !status.python) throw new Error('Prompt translator Python was not found')
  if (!status.helperExists) throw new Error('Prompt translator helper was not found')
  if (!status.deepTranslatorReady) throw new Error('deep-translator is not ready')

  const segmented = segmentPromptForTranslation(req.text, req.mode)
  if (segmented.texts.length === 0) {
    const warnings = req.mode === 'segments' ? ['no-japanese-segments'] : []
    return {
      translatedText: req.text,
      provider: req.provider,
      sourceText: req.text,
      source: req.source,
      target: req.target,
      mode: req.mode,
      cacheHit: false,
      warnings
    }
  }

  const helperResult = await runTranslationHelper(status.python, status.dependencyRoot, {
    texts: segmented.texts,
    source: req.source,
    target: req.target
  })
  const translatedText = rebuildTranslatedPrompt(segmented.parts, helperResult.translatedTexts)
  const warnings = uniqueStrings(helperResult.warnings)
  cache.entries[cacheKey] = {
    translatedText,
    provider: req.provider,
    source: req.source,
    target: req.target,
    mode: req.mode,
    createdAt: Date.now()
  }
  writeCache(trimCache(cache))

  return {
    translatedText,
    provider: req.provider,
    sourceText: req.text,
    source: req.source,
    target: req.target,
    mode: req.mode,
    cacheHit: false,
    warnings
  }
}

async function preparePromptTranslationRuntimeInner(): Promise<PromptTextTranslationRuntimeStatus> {
  const status = await inspectPromptTranslationRuntimeStatus()
  if (status.deepTranslatorReady) return status
  if (!status.pythonExists || !status.python) throw new Error('Prompt translator Python was not found')
  if (!status.helperExists) throw new Error(`Prompt translator helper was not found: ${status.helperPath}`)
  mkdirSync(status.runtimeRoot, { recursive: true })
  mkdirSync(status.dependencyRoot, { recursive: true })
  const result = await runProcess(status.python, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--no-input',
    '--upgrade',
    '--target',
    status.dependencyRoot,
    DEPENDENCY_SPEC
  ], {
    cwd: status.runtimeRoot,
    timeoutMs: PREPARE_TIMEOUT_MS,
    env: pythonEnv(status.dependencyRoot)
  })
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `pip install failed with code ${result.code ?? 'unknown'}`)
  }
  const next = await inspectPromptTranslationRuntimeStatus()
  if (!next.deepTranslatorReady) throw new Error('deep-translator was installed but could not be imported')
  return next
}

function validatePromptTextTranslationRequest(input: unknown): Required<PromptTextTranslationRequest> {
  if (!input || typeof input !== 'object') throw new Error('Prompt translation request must be an object')
  const raw = input as Partial<PromptTextTranslationRequest>
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (!text) throw new Error('Prompt translation text is required')
  if (text.length > MAX_PROMPT_TRANSLATION_CHARS) {
    throw new Error(`Prompt translation text is too long (${text.length}/${MAX_PROMPT_TRANSLATION_CHARS})`)
  }
  assertNoUnsafeControlChars(text, 'prompt translation text')
  const provider = raw.provider ?? PROVIDER
  if (provider !== PROVIDER) throw new Error('Unsupported prompt translation provider')
  const source = raw.source ?? 'ja'
  if (source !== 'ja' && source !== 'auto') throw new Error('Unsupported prompt translation source')
  const target = raw.target ?? 'en'
  if (target !== 'en') throw new Error('Unsupported prompt translation target')
  const mode = raw.mode ?? 'segments'
  if (mode !== 'whole' && mode !== 'segments') throw new Error('Unsupported prompt translation mode')
  return { text, provider, source, target, mode }
}

function segmentPromptForTranslation(text: string, mode: PromptTextTranslationMode): {
  texts: string[]
  parts: Array<{ kind: 'literal'; text: string } | { kind: 'translated'; leading: string; trailing: string; index: number }>
} {
  if (mode === 'whole') {
    return {
      texts: [text],
      parts: [{ kind: 'translated', leading: '', trailing: '', index: 0 }]
    }
  }

  const pieces = text.split(/([,;、。\n\r]+)/)
  const texts: string[] = []
  const parts: Array<{ kind: 'literal'; text: string } | { kind: 'translated'; leading: string; trailing: string; index: number }> = []
  for (const piece of pieces) {
    if (!piece) continue
    const core = piece.trim()
    if (!core || !JAPANESE_TEXT.test(core)) {
      parts.push({ kind: 'literal', text: piece })
      continue
    }
    const leading = piece.match(/^\s*/)?.[0] ?? ''
    const trailing = piece.match(/\s*$/)?.[0] ?? ''
    const index = texts.length
    texts.push(core)
    parts.push({ kind: 'translated', leading, trailing, index })
  }
  return { texts, parts }
}

function rebuildTranslatedPrompt(
  parts: Array<{ kind: 'literal'; text: string } | { kind: 'translated'; leading: string; trailing: string; index: number }>,
  translatedTexts: string[]
): string {
  return parts.map((part) => {
    if (part.kind === 'literal') return part.text
    return `${part.leading}${translatedTexts[part.index] ?? ''}${part.trailing}`
  }).join('').replace(/[ \t]{2,}/g, ' ').trim()
}

async function runTranslationHelper(
  python: string,
  dependencyRoot: string,
  payload: { texts: string[]; source: PromptTextTranslationSource; target: PromptTextTranslationTarget }
): Promise<{ translatedTexts: string[]; warnings: string[] }> {
  const result = await runProcess(python, [HELPER_PATH], {
    cwd: translationRuntimePaths().runtimeRoot,
    timeoutMs: TRANSLATION_TIMEOUT_MS,
    env: pythonEnv(dependencyRoot),
    stdin: JSON.stringify(payload)
  })
  const parsed = parseJsonOutput(result.stdout)
  if (result.code !== 0 || !parsed || parsed.ok !== true) {
    const message = readString(parsed?.error) ?? result.stderr ?? result.stdout ?? 'Prompt translation failed'
    throw new Error(message)
  }
  const translatedTexts = Array.isArray(parsed.translatedTexts)
    ? parsed.translatedTexts.map((item) => typeof item === 'string' ? normalizeTranslationText(item) : '')
    : []
  if (translatedTexts.length !== payload.texts.length) throw new Error('Prompt translator returned an unexpected result count')
  return {
    translatedTexts,
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((item): item is string => typeof item === 'string')
      : []
  }
}

async function canImportDeepTranslator(python: string | null, dependencyRoot: string): Promise<boolean> {
  if (!python) return false
  if (!existsSync(dependencyRoot)) return false
  const result = await runProcess(python, [
    '-c',
    'import deep_translator; print("ok")'
  ], {
    cwd: translationRuntimePaths().runtimeRoot,
    timeoutMs: IMPORT_TIMEOUT_MS,
    env: pythonEnv(dependencyRoot)
  }).catch(() => ({ code: 1, stdout: '', stderr: '' }))
  return result.code === 0 && result.stdout.includes('ok')
}

async function resolvePython(): Promise<{ python: string | null; pythonExists: boolean; warnings: string[] }> {
  const warnings: string[] = []
  const envPython = process.env.PYTHON
  if (envPython && existsSync(envPython)) {
    warnings.push('prompt-translator-python-from-env')
    return { python: envPython, pythonExists: true, warnings }
  }

  const forgePython = join(process.cwd(), 'runtime', 'forge', 'system', 'python', 'python.exe')
  if (existsSync(forgePython)) {
    warnings.push('prompt-translator-python-from-forge')
    return { python: forgePython, pythonExists: true, warnings }
  }

  const pathPython = await runProcess('python', ['--version'], {
    timeoutMs: IMPORT_TIMEOUT_MS
  }).catch(() => ({ code: 1, stdout: '', stderr: '' }))
  if (pathPython.code === 0) {
    warnings.push('prompt-translator-python-from-path')
    return { python: 'python', pythonExists: true, warnings }
  }
  return { python: null, pythonExists: false, warnings: uniqueStrings([...warnings, 'prompt-translator-python-missing']) }
}

function translationRuntimePaths(): { runtimeRoot: string; dependencyRoot: string; cachePath: string } {
  const base = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Yoitomoshi-Art-Generator')
    : join(process.cwd(), 'userdata')
  const runtimeRoot = join(base, 'translator-runtime')
  return {
    runtimeRoot,
    dependencyRoot: join(runtimeRoot, 'python-packages'),
    cachePath: join(runtimeRoot, 'translation-cache.json')
  }
}

function pythonEnv(dependencyRoot: string): Record<string, string> {
  const existingPythonPath = process.env.PYTHONPATH
  return {
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONPATH: existingPythonPath ? `${dependencyRoot};${existingPythonPath}` : dependencyRoot
  }
}

function runProcess(
  command: string,
  args: string[],
  opts: {
    cwd?: string
    env?: Record<string, string>
    timeoutMs?: number
    stdin?: string
  } = {}
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolveRun) => {
    if (opts.cwd) mkdirSync(opts.cwd, { recursive: true })
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      stderr += `\ncommand timed out after ${opts.timeoutMs ?? TRANSLATION_TIMEOUT_MS}ms`
      killProcessTree(child.pid)
    }, opts.timeoutMs ?? TRANSLATION_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => { stdout = capProcessOutput(stdout + chunk.toString('utf8')) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = capProcessOutput(stderr + chunk.toString('utf8')) })
    child.once('error', (error) => {
      clearTimeout(timer)
      resolveRun({ code: 1, stdout, stderr: stderr || error.message })
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolveRun({ code: timedOut && code == null ? 124 : code, stdout: stdout.trim(), stderr: stderr.trim() })
    })
    if (opts.stdin != null) {
      child.stdin.end(opts.stdin, 'utf8')
    } else {
      child.stdin.end()
    }
  })
}

function killProcessTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    killer.on('error', () => undefined)
    return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // The caller reports the timeout; cleanup failure is non-fatal here.
  }
}

function parseJsonOutput(output: string): Record<string, unknown> | null {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].startsWith('{')) continue
    try {
      const parsed = JSON.parse(lines[i]) as unknown
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
    } catch {
      // Keep scanning older lines.
    }
  }
  return null
}

function readCache(): CacheFile {
  const { runtimeRoot, cachePath } = translationRuntimePaths()
  mkdirSync(runtimeRoot, { recursive: true })
  if (!existsSync(cachePath)) return { schema: 1, entries: {} }
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as Partial<CacheFile>
    return parsed.schema === 1 && parsed.entries && typeof parsed.entries === 'object'
      ? { schema: 1, entries: parsed.entries as CacheFile['entries'] }
      : { schema: 1, entries: {} }
  } catch {
    return { schema: 1, entries: {} }
  }
}

function writeCache(cache: CacheFile): void {
  const { runtimeRoot, cachePath } = translationRuntimePaths()
  mkdirSync(runtimeRoot, { recursive: true })
  writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
}

function trimCache(cache: CacheFile): CacheFile {
  const entries = Object.entries(cache.entries)
    .sort((a, b) => b[1].createdAt - a[1].createdAt)
    .slice(0, 300)
  return { schema: 1, entries: Object.fromEntries(entries) }
}

function promptTranslationCacheKey(req: Required<PromptTextTranslationRequest>): string {
  return createHash('sha256')
    .update(JSON.stringify({
      provider: req.provider,
      source: req.source,
      target: req.target,
      mode: req.mode,
      text: req.text
    }))
    .digest('hex')
}

function normalizeTranslationText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  assertNoUnsafeControlChars(normalized, 'prompt translation result')
  return normalized
}

function assertNoUnsafeControlChars(value: string, label: string): void {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) throw new Error(`Unsafe control characters in ${label}`)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function capProcessOutput(value: string): string {
  return value.length > MAX_PROCESS_OUTPUT_CHARS ? value.slice(-MAX_PROCESS_OUTPUT_CHARS) : value
}
