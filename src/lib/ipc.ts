import type { AppApi } from '../../electron/preload.js'

declare global {
  interface Window {
    api: AppApi
  }
}

/** Re-export window.api as a typed singleton for convenience. */
export const api = (typeof window !== 'undefined' ? window.api : ({} as AppApi))
