import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: {
          0: '#0a0a0b',
          1: '#111113',
          2: '#17171a',
          3: '#1f1f23',
          4: '#27272c'
        },
        line: {
          DEFAULT: '#2a2a30',
          strong: '#3a3a42'
        },
        ink: {
          0: '#f5f5f7',
          1: '#d4d4dc',
          2: '#9a9aa6',
          3: '#6a6a76'
        },
        accent: {
          DEFAULT: '#7c8cff',
          hover: '#9aa6ff',
          dim: '#4a55b8'
        },
        ok: '#5fc37e',
        warn: '#e0b34d',
        err: '#e26b6b'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
} satisfies Config
