import { spawn, ChildProcess } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { ForgeStatus } from '../src/shared/types.js'

const READY_REGEX = /Running on local URL:\s+https?:\/\/[^:]+:(\d+)/i
const ERROR_HINTS = [
  /Error loading script/i,
  /Traceback \(most recent call last\)/i,
  /OSError:.*WinError/i,
  /CUDA out of memory/i,
  /No module named/i
]
// "Error calling: <abs path>...\extensions\<name>\scripts\..."
// Captures the extension folder name. Forge prints these in red and continues
// running, but the broken extension may be partially non-functional.
const BROKEN_EXT_REGEX = /Error calling:.*extensions[\\/]([^\\/]+)[\\/]/i

/** Strip the legacy `.disabled` rename suffix so we report canonical names. */
function canonicalExtensionName(raw: string): string {
  return raw.replace(/\.disabled$/i, '')
}

const LOG_LIMIT = 200
const API_ONLY_DISABLED_EXTENSIONS = [
  // Gradio UI helper extension. It crashes on newer Gradio because it calls
  // Component.style(), and Electron does not use its tab in API-only mode.
  'model_preset_manager',
  // Browser-side prompt helpers duplicated by the Electron Prompt Library /
  // Civitai / autocomplete UI. Keeping them enabled only adds Forge script load
  // cost in --nowebui mode.
  'a1111-sd-webui-tagcomplete',
  'Config-Presets',
  'sd-webui-prompt-all-in-one',
  'Stable-Diffusion-Webui-Civitai-Helper',
  'stable-diffusion-webui-localization-ja_JP'
]

/**
 * Manages the Forge WebUI subprocess lifecycle.
 *
 * Forge ships with run.bat → environment.bat → webui-user.bat → webui.bat → launch.py.
 * We skip the batch chain and launch the bundled Python directly. Electron is the UI,
 * so Forge starts in API-only `--nowebui` mode instead of building the Gradio app.
 */
export class ForgeManager extends EventEmitter {
  private proc: ChildProcess | null = null
  private status: ForgeStatus = { kind: 'stopped' }
  private logTail: string[] = []
  private readinessPolling = false
  private brokenExtensions = new Set<string>()

  constructor(
    private opts: {
      forgePath: string
      port: number
      extraArgs: string
    }
  ) {
    super()
  }

  getStatus(): ForgeStatus {
    return this.status
  }

  isAlive(): boolean {
    return this.proc !== null && !this.proc.killed
  }

  async start(): Promise<void> {
    if (this.isAlive()) return

    const sysDir = join(this.opts.forgePath, 'system')
    const pyDir = join(sysDir, 'python')
    const pythonExe = join(pyDir, 'python.exe')
    const webuiDir = join(this.opts.forgePath, 'webui')
    const launchPy = join(webuiDir, 'launch.py')

    console.log('[forge] start requested')
    for (const required of [pythonExe, launchPy]) {
      if (!existsSync(required)) {
        const msg = `Required file not found: ${required}`
        console.error('[forge]', msg)
        this.setStatus({ kind: 'error', message: msg, logTail: [] })
        return
      }
    }
    await this.stopPreviousManagedProcess(launchPy)

    this.logTail = []
    this.setStatus({ kind: 'starting', phase: 'launching', logTail: [] })

    // Keep this config patch for users who temporarily opt out of API-only
    // startup through extra args or direct Forge launches.
    this.suppressForgeAutoBrowser()

    // We replicate Forge's environment.bat + webui.bat env setup directly here
    // and skip the .bat chain. Why: modern Windows non-interactive cmd refuses
    // to resolve `call <script>` against cwd, breaking run.bat's first line.
    // Going straight to launch.py with the right env avoids the whole chain.
    const extraArgs = this.opts.extraArgs ? this.opts.extraArgs.split(/\s+/).filter(Boolean) : []
    const addSkipInstall = this.shouldAddSkipInstall(extraArgs)
    const args = [
      '--nowebui',
      '--api-log',
      '--port', String(this.opts.port),
      '--skip-version-check',
      ...(addSkipInstall ? ['--skip-install'] : []),
      ...extraArgs
    ]
    if (addSkipInstall) {
      console.log('[forge] install checks skipped; marker is current')
    }

    const env = {
      ...process.env,
      // PATH: bundled Git + bundled Python first so launch.py finds the right tools.
      PATH: [
        join(sysDir, 'git', 'bin'),
        pyDir,
        join(pyDir, 'Scripts'),
        process.env.PATH ?? ''
      ].join(';'),
      PY_LIBS: [
        join(pyDir, 'Scripts', 'Lib'),
        join(pyDir, 'Scripts', 'Lib', 'site-packages')
      ].join(';'),
      PY_PIP: join(pyDir, 'Scripts'),
      SKIP_VENV: '1',
      PIP_INSTALLER_LOCATION: join(pyDir, 'get-pip.py'),
      TRANSFORMERS_CACHE: join(sysDir, 'transformers-cache'),
      // launch.py reads COMMANDLINE_ARGS from env — same mechanism A1111 uses.
      COMMANDLINE_ARGS: args.join(' '),
      PYTHONUNBUFFERED: '1'
    }

    try {
      this.proc = spawn(pythonExe, [launchPy], {
        cwd: webuiDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      console.log('[forge] spawned pid=', this.proc.pid)
      if (this.proc.pid !== undefined) this.writeManagedPid(this.proc.pid)
      this.startReadinessPoll(this.opts.port)
    } catch (e) {
      const msg = `spawn failed: ${(e as Error).message}`
      console.error('[forge]', msg)
      this.setStatus({ kind: 'error', message: msg, logTail: [] })
      return
    }

    this.proc.on('error', (err) => {
      console.error('[forge] proc error:', err)
      this.setStatus({
        kind: 'error',
        message: `Forge process error: ${err.message}`,
        logTail: this.logTail.slice(-50)
      })
    })

    const onChunk = (data: Buffer) => {
      const text = data.toString('utf8')
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue
        if (process.env.NODE_ENV !== 'production') console.log('[forge]', line)
        this.appendLog(line)

        // Track broken extensions so the UI can offer to disable them.
        // Strip a legacy `.disabled` suffix from the captured name so old
        // renames (which DON'T actually disable in Forge) are reported under
        // their canonical name — the user's config-based disable then works.
        const ext = line.match(BROKEN_EXT_REGEX)
        if (ext && ext[1]) {
          const name = canonicalExtensionName(ext[1])
          if (!this.brokenExtensions.has(name)) {
            this.brokenExtensions.add(name)
            // If we're already past starting, re-emit so the renderer updates.
            if (this.status.kind === 'ready') {
              this.setStatus({ ...this.status, brokenExtensions: this.brokenExtsArr() })
            }
          }
        }

        // API-only mode starts polling immediately after spawn. Keep this as a
        // fallback if the user launches a web UI mode through custom args.
        const m = line.match(READY_REGEX)
        if (m && this.status.kind !== 'ready' && !this.readinessPolling) {
          const port = parseInt(m[1], 10)
          this.startReadinessPoll(port)
        }

        // Detect error hints when we're still starting.
        if (this.status.kind === 'starting') {
          for (const hint of ERROR_HINTS) {
            if (hint.test(line)) {
              // Don't immediately fail — Forge sometimes prints harmless errors during
              // startup. Just record and continue; the timeout will catch real failures.
              this.setStatus({
                kind: 'starting',
                phase: 'error-detected',
                logTail: this.logTail.slice(-30)
              })
              break
            }
          }
        }
      }
    }

    this.proc.stdout?.on('data', onChunk)
    this.proc.stderr?.on('data', onChunk)

    const spawnedProc = this.proc
    this.proc.on('exit', (code) => {
      console.log('[forge] proc exit code=', code)
      if (this.proc === spawnedProc) this.proc = null
      if (spawnedProc.pid !== undefined) this.clearManagedPid(spawnedProc.pid)
      if (this.status.kind === 'ready') {
        this.setStatus({ kind: 'stopped' })
      } else {
        this.setStatus({
          kind: 'error',
          message: `Forge exited unexpectedly (code ${code}). Check the log.`,
          logTail: this.logTail.slice(-50)
        })
      }
    })

    // Hard timeout — if we don't see "Running on local URL" within 5 minutes, give up.
    setTimeout(() => {
      if (this.status.kind === 'starting') {
        this.setStatus({
          kind: 'error',
          message: 'Forge did not become ready within 5 minutes',
          logTail: this.logTail.slice(-50)
        })
        this.stop()
      }
    }, 5 * 60 * 1000)
  }

  private brokenExtsArr(): string[] {
    return Array.from(this.brokenExtensions).sort()
  }

  /**
   * Patch Forge's config.json for Electron API-only usage. Run before each
   * `start()` so direct Forge UI changes do not re-enable browser launches or
   * UI-only extensions that are known to break API startup.
   */
  private suppressForgeAutoBrowser(): void {
    const cfgPath = join(this.opts.forgePath, 'webui', 'config.json')
    let cfg: Record<string, unknown> = {}
    if (existsSync(cfgPath)) {
      try {
        cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>
      } catch (e) {
        console.warn('[forge] config.json parse failed, recreating:', e)
        cfg = {}
      }
    }
    let changed = false
    if (cfg.auto_launch_browser !== 'Disable') {
      cfg.auto_launch_browser = 'Disable'
      changed = true
    }
    const disabled = Array.isArray(cfg.disabled_extensions)
      ? (cfg.disabled_extensions as unknown[]).filter((item): item is string => typeof item === 'string')
      : []
    for (const name of API_ONLY_DISABLED_EXTENSIONS) {
      if (!disabled.includes(name)) {
        disabled.push(name)
        changed = true
      }
    }
    cfg.disabled_extensions = disabled
    if (!changed) return
    try {
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 4))
      console.log('[forge] API-only config patched in config.json')
    } catch (e) {
      console.warn('[forge] could not patch config.json:', e)
    }
  }

  getBrokenExtensions(): string[] {
    return this.brokenExtsArr()
  }

  getForgePath(): string {
    return this.opts.forgePath
  }

  private pidFilePath(): string {
    return join(this.opts.forgePath, 'webui', '.yoitomoshi-forge.pid')
  }

  private installReadyMarkerPath(): string {
    return join(this.opts.forgePath, 'webui', '.yoitomoshi-install-ready.json')
  }

  private shouldAddSkipInstall(extraArgs: string[]): boolean {
    if (extraArgs.includes('--skip-install')) return false
    if (extraArgs.some((arg) => [
      '--reinstall-torch',
      '--reinstall-xformers',
      '--update-all-extensions'
    ].includes(arg))) {
      return false
    }

    const marker = this.installReadyMarkerPath()
    if (!existsSync(marker)) return false

    let markerTime = 0
    try {
      markerTime = statSync(marker).mtimeMs
    } catch {
      return false
    }

    for (const watched of this.installWatchedFiles()) {
      try {
        if (existsSync(watched) && statSync(watched).mtimeMs > markerTime + 1000) {
          return false
        }
      } catch {
        return false
      }
    }
    return true
  }

  private installWatchedFiles(): string[] {
    const webuiDir = join(this.opts.forgePath, 'webui')
    const files = [
      join(webuiDir, 'requirements_versions.txt'),
      join(webuiDir, 'requirements.txt'),
      join(webuiDir, 'requirements_npu.txt')
    ]
    for (const root of [join(webuiDir, 'extensions'), join(webuiDir, 'extensions-builtin')]) {
      if (!existsSync(root)) continue
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const dir = join(root, entry.name)
        files.push(join(dir, 'install.py'), join(dir, 'requirements.txt'))
      }
    }
    return files
  }

  private writeInstallReadyMarker(): void {
    try {
      writeFileSync(
        this.installReadyMarkerPath(),
        JSON.stringify({ readyAt: new Date().toISOString() }, null, 2)
      )
    } catch (e) {
      console.warn('[forge] could not write install-ready marker:', e)
    }
  }

  private readManagedPid(): number | null {
    try {
      const path = this.pidFilePath()
      if (!existsSync(path)) return null
      const pid = Number.parseInt(readFileSync(path, 'utf8').trim(), 10)
      return Number.isFinite(pid) && pid > 0 ? pid : null
    } catch {
      return null
    }
  }

  private writeManagedPid(pid: number): void {
    try {
      writeFileSync(this.pidFilePath(), `${pid}\n`)
    } catch (e) {
      console.warn('[forge] could not write pid file:', e)
    }
  }

  private clearManagedPid(pid?: number): void {
    const recorded = this.readManagedPid()
    if (pid !== undefined && recorded !== null && recorded !== pid) return
    try {
      const path = this.pidFilePath()
      if (existsSync(path)) unlinkSync(path)
    } catch {
      // Best effort only — a stale pid file is revalidated on next start.
    }
  }

  private async stopPreviousManagedProcess(launchPy: string): Promise<void> {
    const pid = this.readManagedPid()
    if (!pid || pid === this.proc?.pid) return

    const commandLine = await this.commandLineForPid(pid)
    if (!commandLine) {
      this.clearManagedPid(pid)
      return
    }

    const normalizedCommand = commandLine.toLowerCase().replace(/\//g, '\\')
    const normalizedLaunch = launchPy.toLowerCase().replace(/\//g, '\\')
    if (!normalizedCommand.includes(normalizedLaunch)) {
      this.clearManagedPid(pid)
      return
    }

    console.log('[forge] stopping stale managed process pid=', pid)
    await this.killProcessTree(pid)
    this.clearManagedPid(pid)
  }

  private async commandLineForPid(pid: number): Promise<string | null> {
    return await new Promise((resolve) => {
      const command = [
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue`,
        'if ($p) { $p.CommandLine }'
      ].join('; ')
      const ps = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
        { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
      )
      let stdout = ''
      ps.stdout?.on('data', (data: Buffer) => { stdout += data.toString('utf8') })
      ps.on('error', () => resolve(null))
      ps.on('exit', (code) => {
        const value = stdout.trim()
        resolve(code === 0 && value ? value : null)
      })
    })
  }

  private async killProcessTree(pid: number): Promise<void> {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    })
    await new Promise<void>((resolve) => {
      killer.on('error', () => resolve())
      killer.on('exit', () => resolve())
    })
  }

  /**
   * Poll /sdapi/v1/options until it succeeds — only then can the renderer call
   * /sdapi/v1/sd-models without 404. In API-only mode there is no Gradio ready
   * line, so polling starts immediately after spawn.
   */
  private startReadinessPoll(port: number): void {
    this.readinessPolling = true
    const url = `http://127.0.0.1:${port}/sdapi/v1/options`
    const startedAt = Date.now()
    const maxWaitMs = 180_000

    const tick = async (): Promise<void> => {
      if (!this.proc || this.status.kind === 'ready') {
        this.readinessPolling = false
        return
      }
      try {
        const r = await fetch(url)
        if (r.ok) {
          this.readinessPolling = false
          this.writeInstallReadyMarker()
          this.setStatus({
            kind: 'ready',
            port,
            url: `http://127.0.0.1:${port}`,
            brokenExtensions: this.brokenExtsArr()
          })
          return
        }
      } catch {
        // Connection refused while Gradio is still starting — keep waiting.
      }
      if (Date.now() - startedAt > maxWaitMs) {
        this.readinessPolling = false
        this.setStatus({
          kind: 'error',
          message: 'Forge API did not respond within 180s after process start',
          logTail: this.logTail.slice(-50)
        })
        return
      }
      setTimeout(tick, 750)
    }
    tick()
  }

  async stop(): Promise<void> {
    // Clear broken-extension cache on stop — a restart re-detects what's broken
    // (the user may have disabled some in the interim).
    this.brokenExtensions.clear()
    const pid = this.proc?.pid ?? this.readManagedPid() ?? undefined
    this.proc?.removeAllListeners('exit')

    // On Windows, killing cmd.exe doesn't reliably kill the python child.
    // Use taskkill /T to terminate the entire process tree.
    if (pid !== undefined) {
      try {
        await this.killProcessTree(pid)
      } catch {
        this.proc?.kill('SIGKILL')
      }
    }
    this.proc = null
    this.clearManagedPid(pid)
    this.setStatus({ kind: 'stopped' })
  }

  private appendLog(line: string): void {
    this.logTail.push(line)
    if (this.logTail.length > LOG_LIMIT) {
      this.logTail.splice(0, this.logTail.length - LOG_LIMIT)
    }
    if (this.status.kind === 'starting') {
      this.status = {
        ...this.status,
        logTail: this.logTail.slice(-30)
      }
      this.emit('status', this.status)
    }
  }

  private setStatus(s: ForgeStatus): void {
    this.status = s
    this.emit('status', s)
  }
}
