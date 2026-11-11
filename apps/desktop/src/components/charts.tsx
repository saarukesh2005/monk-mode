import { useState } from 'react';
import type { HeatCell, UsageTotal } from '@monk/analytics';
import { localDateKey } from '@monk/shared-core';
import { fmtDate, fmtMs } from '../lib/format';
import { cx } from './ui';

/** Vertical bars with an optional dashed target line. */
export function WeekBars({ days, targetMs, height = 160 }: { days: { label: string; ms: number; highlight?: boolean }[]; targetMs?: number; height?: number }) {
  const max = Math.max(1, targetMs ?? 0, ...days.map((d) => d.ms));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <figure aria-label="Focus time per day">
      <div className="relative flex items-end gap-2" style={{ height }}>
        {targetMs ? (
          <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line-strong" style={{ bottom: `${(targetMs / max) * 100}%` }}>
            <span className="absolute -top-4 right-0 text-[10px] text-ink-faint">target</span>
          </div>
        ) : null}
        {days.map((d, i) => (
          <div key={i} className="relative flex h-full flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {hover === i && <div className="tabular absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-surface-3 px-2 py-1 text-[11px] text-ink shadow-pop">{fmtMs(d.ms)}</div>}
            <div className={cx('w-full rounded-[5px] transition-[height] duration-500', d.highlight ? 'bg-accent' : 'bg-surface-3 hover:bg-line-strong')} style={{ height: `${Math.max(d.ms > 0 ? 2 : 0, (d.ms / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        {days.map((d, i) => (
          <div key={i} className={cx('flex-1 text-center text-[11px]', d.highlight ? 'text-ink' : 'text-ink-faint')}>
            {d.label}
          </div>
        ))}
      </div>
      <figcaption className="sr-only">{days.map((d) => `${d.label}: ${fmtMs(d.ms)}`).join(', ')}</figcaption>
    </figure>
  );
}

const HEAT = ['var(--surface-3)', 'color-mix(in srgb, var(--accent) 30%, var(--surface-3))', 'color-mix(in srgb, var(--accent) 55%, var(--surface-3))', 'color-mix(in srgb, var(--accent) 78%, var(--surface-3))', 'var(--accent)'];

/** GitHub-style calendar heatmap (columns = weeks, rows = Mon..Sun). */
export function Heatmap({ cells }: { cells: HeatCell[] }) {
  const weeks: HeatCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const today = localDateKey(Date.now());
  return (
    <figure aria-label="Focus calendar heatmap" className="overflow-x-auto">
      <div className="flex gap-[3px]">
        {weeks.map((w, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {w.map((c) => (
              <div key={c.date} title={`${fmtDate(c.date, { weekday: 'short', month: 'short', day: 'numeric' })}: ${fmtMs(c.ms)}`} className={cx('h-[13px] w-[13px] rounded-[3px]', c.date > today && 'opacity-30')} style={{ background: HEAT[c.level] }} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-ink-faint">
        Less
        {HEAT.map((h) => (
          <span key={h} className="h-[10px] w-[10px] rounded-[2px]" style={{ background: h }} />
        ))}
        More
      </div>
    </figure>
  );
}

/** Ranked horizontal bars for apps/domains. */
export function RankList({ items, empty, highlight }: { items: UsageTotal[]; empty: string; highlight?: (key: string) => boolean }) {
  if (items.length === 0) return <p className="py-6 text-center text-[12px] text-ink-faint">{empty}</p>;
  const max = Math.max(1, ...items.map((i) => i.ms));
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.key}>
          <div className="mb-1 flex justify-between gap-3 text-[12px]">
            <span className={cx('truncate', highlight?.(i.key) ? 'text-danger' : 'text-ink')}>{i.label}</span>
            <span className="tabular shrink-0 text-ink-muted">{fmtMs(i.ms)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-3">
            <div className={cx('h-full rounded-full', highlight?.(i.key) ? 'bg-danger/70' : 'bg-accent/80')} style={{ width: `${(i.ms / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** 24 compact columns showing focus by hour of day. */
export function HourBars({ hours }: { hours: number[] }) {
  const max = Math.max(1, ...hours);
  return (
    <figure aria-label="Focus by hour of day">
      <div className="flex h-24 items-end gap-[3px]">
        {hours.map((ms, h) => (
          <div key={h} title={`${String(h).padStart(2, '0')}:00 — ${fmtMs(ms)}`} className="flex-1 rounded-t-[3px] bg-accent/75" style={{ height: `${Math.max(ms > 0 ? 3 : 0, (ms / max) * 100)}%`, opacity: ms > 0 ? 1 : 0.15 }} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-ink-faint">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </figure>
  );
}

/** Smooth line for a daily series (e.g. 30-day trend). */
export function TrendLine({ series, height = 120 }: { series: { date: string; ms: number }[]; height?: number }) {
  const w = 600;
  const max = Math.max(1, ...series.map((s) => s.ms));
  const step = series.length > 1 ? w / (series.length - 1) : w;
  const pts = series.map((s, i) => [i * step, height - 8 - (s.ms / max) * (height - 16)] as const);
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <figure aria-label="Focus trend">
      <svg viewBox={`0 0 ${w} ${height}`} className="h-[120px] w-full" preserveAspectRatio="none">
        <path d={`${path} L${w},${height} L0,${height} Z`} fill="var(--accent-soft)" />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      {series.length > 0 && (
        <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
          <span>{fmtDate(series[0]!.date)}</span>
          <span>{fmtDate(series[series.length - 1]!.date)}</span>
        </div>
      )}
    </figure>
  );
}
