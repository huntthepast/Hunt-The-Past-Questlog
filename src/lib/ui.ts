/**
 * Static class maps keyed by the `color` names used in constants.js.
 * They must be full literal strings so Tailwind's scanner can see them.
 */
export type ColorName = 'zinc' | 'sky' | 'orange' | 'teal' | 'emerald' | 'violet' | 'amber' | 'rose';

export const BADGE: Record<ColorName, string> = {
  zinc: 'bg-zinc-500/15 text-zinc-300 ring-zinc-500/30',
  sky: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  orange: 'bg-orange-500/15 text-orange-300 ring-orange-500/30',
  teal: 'bg-teal-500/15 text-teal-300 ring-teal-500/30',
  emerald: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  violet: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  rose: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
};

export const DOT: Record<ColorName, string> = {
  zinc: 'bg-zinc-400',
  sky: 'bg-sky-400',
  orange: 'bg-orange-400',
  teal: 'bg-teal-400',
  emerald: 'bg-emerald-400',
  violet: 'bg-violet-400',
  amber: 'bg-amber-400',
  rose: 'bg-rose-400',
};

export const BAR: Record<ColorName, string> = {
  zinc: 'bg-zinc-500',
  sky: 'bg-sky-400',
  orange: 'bg-orange-400',
  teal: 'bg-teal-400',
  emerald: 'bg-emerald-400',
  violet: 'bg-violet-400',
  amber: 'bg-amber-400',
  rose: 'bg-rose-400',
};

export const TEXT: Record<ColorName, string> = {
  zinc: 'text-zinc-300',
  sky: 'text-sky-300',
  orange: 'text-orange-300',
  teal: 'text-teal-300',
  emerald: 'text-emerald-300',
  violet: 'text-violet-300',
  amber: 'text-amber-300',
  rose: 'text-rose-300',
};

export const badge = (color: string) => BADGE[(color as ColorName) in BADGE ? (color as ColorName) : 'zinc'];
export const dot = (color: string) => DOT[(color as ColorName) in DOT ? (color as ColorName) : 'zinc'];
export const bar = (color: string) => BAR[(color as ColorName) in BAR ? (color as ColorName) : 'zinc'];
export const text = (color: string) => TEXT[(color as ColorName) in TEXT ? (color as ColorName) : 'zinc'];
