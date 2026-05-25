import { app } from 'electron'
import { join, resolve } from 'node:path'

export function resolveBundledResourcePath(...segments: string[]): string {
  if (app.isPackaged) return join(process.resourcesPath, ...segments)
  return resolve(process.cwd(), 'resources', ...segments)
}

export function resolveBundledScriptPath(...segments: string[]): string {
  if (app.isPackaged) return join(process.resourcesPath, 'scripts', ...segments)
  return resolve(process.cwd(), 'scripts', ...segments)
}
