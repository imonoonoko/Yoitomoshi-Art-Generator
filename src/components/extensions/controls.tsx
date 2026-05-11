/**
 * Tiny form controls shared across extension panels (Dynamic Thresholding,
 * FreeU, ADetailer, ControlNet, …). Kept here rather than inline so each
 * panel reads as just its parameter list, and so styling tweaks propagate
 * everywhere at once.
 */

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  /**
   * Override decimal places for the value readout. Defaults to 2 for
   * fractional steps, 0 otherwise.
   */
  precision?: number
}
export function Slider({ label, value, min, max, step, onChange, precision }: SliderProps): JSX.Element {
  const decimals = precision ?? (step >= 1 ? 0 : 2)
  return (
    <label className="block">
      <div className="flex items-baseline justify-between text-[10px] text-ink-3">
        <span>{label}</span>
        <span className="font-mono text-ink-1">{value.toFixed(decimals)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-accent"
      />
    </label>
  )
}

interface SelectFieldProps {
  label: string
  value: string
  options: readonly string[]
  onChange: (v: string) => void
}
export function SelectField({ label, value, options, onChange }: SelectFieldProps): JSX.Element {
  return (
    <label className="block space-y-0.5">
      <span className="text-[10px] text-ink-3">{label}</span>
      <select
        className="input text-[11px] py-1 w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  )
}
