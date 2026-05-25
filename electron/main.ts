import { app, BrowserWindow, shell } from 'electron'
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ForgeManager } from './forge-manager.js'
import { ForgeApi } from './forge-api.js'
import { Storage } from './storage.js'
import { loadPromptLibrary } from './prompt-library.js'
import { registerIpcHandlers } from './ipc-handlers.js'
import type { StartupMetrics } from '../src/shared/types.js'

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null
const projectRoot = isDev
  ? app.getAppPath()
  : dirname(app.getPath('exe'))
const portableDataRoot = join(projectRoot, 'userdata')
const electronProfileRoot = join(portableDataRoot, 'electron-profile')
const EXTERNAL_LINK_DOMAINS = [
  'civitai.com',
  'civitai.green',
  'huggingface.co',
  'github.com',
  'aipictors.com',
  'lexica.art'
]
const startupMetrics: StartupMetrics = {
  processStartedAt: Date.now(),
  appReadyAt: null,
  windowCreatedAt: null,
  rendererLoadStartedAt: null,
  rendererLoadedAt: null,
  readyToShowAt: null,
  windowShownAt: null,
  ipcRegisteredAt: null,
  forgeAutoStartRequestedAt: null,
  forgeLastStatusAt: null,
  forgeReadyAt: null,
  forgeLastStatusKind: null
}

const qaRemoteDebuggingPort = resolveQaRemoteDebuggingPort()
if (qaRemoteDebuggingPort) {
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
  app.commandLine.appendSwitch('remote-debugging-port', qaRemoteDebuggingPort)
}

// --- Portable userdata setup ---------------------------------------------
//
// User-facing data lives in <project>/userdata, while Electron's Chromium
// profile/cache lives in <project>/userdata/electron-profile. Keeping those
// apart preserves the portable app layout without letting Cache, GPUCache,
// Preferences, etc. spill into the project root. On first launch after the
// rename to "Yoitomoshi Art Generator", we also one-time migrate legacy
// contents from %APPDATA%\sd-electron-ui\userdata\ to the portable location
// so existing favorites/history aren't lost.
//
// Must happen BEFORE app.whenReady() — once the app starts using userData
// (e.g., for cookies/cache), changing the path is a no-op.
{
  app.setPath('userData', electronProfileRoot)
  app.setName('Yoitomoshi Art Generator')

  mkdirSync(portableDataRoot, { recursive: true })
  mkdirSync(electronProfileRoot, { recursive: true })
  const migratedMarker = join(portableDataRoot, '.migrated-from-legacy')

  if (!existsSync(migratedMarker)) {
    const legacyUserdata = join(app.getPath('appData'), 'sd-electron-ui', 'userdata')
    if (existsSync(legacyUserdata)) {
      try {
        copyDirSync(legacyUserdata, portableDataRoot)
        writeFileSync(migratedMarker, new Date().toISOString())
        console.log(
          `[migration] copied userdata from ${legacyUserdata} → ${portableDataRoot}`
        )
      } catch (e) {
        console.warn('[migration] copy failed (continuing with empty data):', e)
      }
    } else {
      // No legacy data — just stamp the marker so we don't recheck every launch.
      writeFileSync(migratedMarker, new Date().toISOString())
    }
  }
}

function copyDirSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const name of readdirSync(src)) {
    const s = join(src, name)
    const d = join(dest, name)
    const st = statSync(s)
    if (st.isDirectory()) copyDirSync(s, d)
    else if (!existsSync(d)) copyFileSync(s, d)
  }
}

function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' || url.username || url.password) return false
    const host = url.hostname.toLowerCase()
    return EXTERNAL_LINK_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

function resolveQaRemoteDebuggingPort(): string | null {
  const fromEnv = process.env.YOITOMOSHI_REMOTE_DEBUGGING_PORT
  const value = fromEnv
  if (!value || !/^\d{2,5}$/.test(value)) return null
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return String(port)
}

/**
 * Resource path resolution.
 *
 * In dev (electron-vite), resources/ sits next to the project root.
 * In packaged builds, electron-builder places extraResources under
 * process.resourcesPath. We try both so the loader works in either mode.
 */
function resourcesDir(): string {
  if (isDev) {
    // out/main/index.js → ../../resources
    return join(__dirname, '..', '..', 'resources')
  }
  return process.resourcesPath
}

async function createWindow(beforeLoad?: (win: BrowserWindow) => void): Promise<BrowserWindow> {
  startupMetrics.windowCreatedAt = Date.now()
  const win = new BrowserWindow({
    title: 'Yoitomoshi Art Generator',
    width: 1480,
    height: 940,
    minWidth: 1200,
    minHeight: 720,
    backgroundColor: '#0a0a0b',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  })
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.once('ready-to-show', () => {
    startupMetrics.readyToShowAt = Date.now()
    win.show()
    startupMetrics.windowShownAt = Date.now()
  })

  win.webContents.once('did-finish-load', () => {
    startupMetrics.rendererLoadedAt = Date.now()
  })

  // External links open in the user's browser, not a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return
    event.preventDefault()
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url)
    }
  })

  beforeLoad?.(win)
  startupMetrics.rendererLoadStartedAt = Date.now()
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await win.loadFile(join(__dirname, '..', 'renderer', 'index.html'))
  }

  return win
}

function focusMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.moveTop()
  mainWindow.focus()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    focusMainWindow()
  })

  app.whenReady().then(async () => {
    startupMetrics.appReadyAt = Date.now()
    const storage = new Storage({ dataRoot: portableDataRoot, projectRoot })
    const settings = storage.getSettings()

    const resourceRoot = resourcesDir()
    const library = loadPromptLibrary(resourceRoot)
    const manager = new ForgeManager({
      forgePath: settings.forgePath,
      port: settings.forgePort,
      extraArgs: settings.forgeExtraArgs
    })
    const api = new ForgeApi(`http://127.0.0.1:${settings.forgePort}`)

    await createWindow((win) => {
      registerIpcHandlers({
        win,
        manager,
        api,
        storage,
        library,
        resourcesDir: resourceRoot,
        dataRoot: portableDataRoot,
        startupMetrics
      })
      startupMetrics.ipcRegisteredAt = Date.now()
    })

    let shutdownStarted = false
    async function stopForgeForQuit(): Promise<void> {
      if (shutdownStarted) return
      shutdownStarted = true
      await manager.stop().catch((e) => {
        console.warn('[forge] shutdown stop failed:', e)
      })
    }

    // Auto-start Forge if enabled. Fire-and-forget — UI subscribes to status events.
    if (settings.autoStartForge) {
      startupMetrics.forgeAutoStartRequestedAt = Date.now()
      manager.start().catch((e) => {
        console.error('Forge auto-start failed:', e)
      })
    }

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createWindow()
      else focusMainWindow()
    })

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit()
    })

    app.on('before-quit', (e) => {
      if (!manager.isAlive() || shutdownStarted) return
      e.preventDefault()
      void stopForgeForQuit().finally(() => app.exit(0))
    })
  })
}
