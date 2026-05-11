import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

/**
 * Round to a multiple — Stable Diffusion image dimensions must be multiples of 8
 * (or 64 for SDXL). We snap user-entered sizes to keep generation reliable.
 */
export function snapTo(n: number, step: number): number {
  return Math.max(step, Math.round(n / step) * step)
}

export function shortHash(h: string | null): string {
  if (!h) return '—'
  return h.slice(0, 10)
}
