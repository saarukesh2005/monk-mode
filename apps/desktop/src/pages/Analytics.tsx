import { useMemo, useState } from 'react';
import { Download, Info } from 'lucide-react';
import type { AppUsage, BlockEvent, BlockRule, MetricProvenance, PauseEvent, WebUsage } from '@monk/shared-types';
import { addDays, hostMatches, localDateKey, presetById, startOfMonth, startOfWeek, appMatches } from '@monk/shared-core';
import { comparePeriods, dailySeries, distractionMs, focusByDay, focusStreak, heatmap, hourOfDayDistribution, summarizeFocus, toCsv, topApps, topDomains, usageByDay, weekdayDistribution } from '@monk/analytics';
import type { PageProps } from '../App';
import { Badge, Button, Card, Loading, PageHeader, Segmented, Stat, Tooltip, useToast } from '../components/ui';
import { HourBars, Heatmap, RankList, TrendLine, WeekBars } from '../components/charts';
import { useSessionsSince } from '../lib/data';
import { useTable } from '../lib/hooks';
import { where } from '../lib/db';
import { call, errorMessage } from '../lib/ipc';
import { fmtMs, fmtPct } from '../lib/format';
import { useSettings } from '../lib/settings';

type Period = 'day' | 'week' | 'month';
const DAY = 86_400_000;

const PROVENANCE: Record<MetricProvenance, { label: string; tone: 'success' | 'accent' | 'warning' | 'neutral'; tip: string }> = {
  measured: { label: 'Measured', tone: 'success', tip: 'Measured on this device while MONK MODE (or the browser extension) was running.' },
  recorded: { label: 'Recorded', tone: 'accent', tip: 'Calculated from focus sessions you recorded.' },
  estimated: { label: 'Estimated', tone: 'warning', tip: 'Derived from partial data.' },
  unavailable: { label: 'No data', tone: 'neutral', tip: 'Not enough data has been collected yet.' },
};

function Prov({ p }: { p: MetricProvenance }) {
  const m = PROVENANCE[p];
  return (
    <Tooltip label={m.tip}>
      <Badge tone={m.tone}>{m.label}</Badge>
    </Tooltip>
  );
}

export default function Analytics(_: PageProps) {
  const toast = useToast();
  const { settings } = useSettings();
  const [period, setPeriod] = useState<Period>('week');
  const today = localDateKey(Date.now());
  const since = Date.now() - 70 * DAY;
  const sessions = useSessionsSince(400);
  const apps = useTable<AppUsage>('app_usage', { filters: [where('started_at', 'gte', since)], limit: 50_000 }, [today]);
  const web = useTable<WebUsage>('web_usage', { filters: [where('started_at', 'gte', since)], limit: 50_000 }, [today]);
  const blocks = useTable<BlockEvent>('block_events', { filters: [where('ts', 'gte', since)], limit: 50_000 }, [today]);
  const rules = useTable<BlockRule>('block_rules');
  const pauses = useTable<PauseEvent>('pause_events', { filters: [where('ts', 'gte', since)], limit: 50_000 }, [today]);

  const { start, days } = period === 'day' ? { start: today, days: 1 } : period === 'week' ? { start: startOfWeek(today), days: 7 } : { start: startOfMonth(today), days: new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate() };
  const startMs = new Date(`${start}T00:00`).getTime();
  const endMs = new Date(`${addDays(start, days)}T00:00`).getTime();

  const r = useMemo(() => {
    const byDay = focusByDay(sessions.data);
    const inRange = sessions.data.filter((s) => s.startedAt >= startMs && s.startedAt < endMs);
    const appsIn = apps.data.filter((a) => a.startedAt >= startMs && a.startedAt < endMs);
    const webIn = web.data.filter((a) => a.startedAt >= startMs && a.startedAt < endMs);
    const blockedApps = rules.data.filter((x) => x.type === 'app').map((x) => x.value);
    const blockedDomains = [...rules.data.filter((x) => x.type === 'domain').map((x) => x.value), ...rules.data.filter((x) => x.type === 'category').flatMap((x) => presetById(x.value)?.domains ?? [])];
    const isDistractingApp = (u: AppUsage) => blockedApps.some((b) => appMatches(b, [u.appId, u.appName]));
    const isDistractingDomain = (d: string) => blockedDomains.some((b) => hostMatches(d, b));
    const screenByDay = usageByDay(apps.data);
    const trendDays = period === 'month' ? 30 : 14;
    return {
      summary: summarizeFocus(inRange),
      focusMs: dailySeries(byDay, start, days).reduce((a, d) => a + d.ms, 0),
      series: dailySeries(byDay, start, days),
      compare: comparePeriods(byDay, start, days),
      streak: focusStreak(byDay, today, 60_000),
      heat: heatmap(byDay, today, 26),
      trend: dailySeries(byDay, addDays(today, -(trendDays - 1)), trendDays),
      hours: hourOfDayDistribution(inRange),
      weekdays: weekdayDistribution(new Map([...byDay].filter(([d]) => d >= addDays(today, -90)))),
      topApps: topApps(appsIn, 8),
      topWeb: topDomains(webIn, 8),
      screenMs: dailySeries(screenByDay, start, days).reduce((a, d) => a + d.ms, 0),
      screenCompare: comparePeriods(screenByDay, start, days),
      distraction: distractionMs(appsIn, webIn, isDistractingApp, isDistractingDomain),
      isDistractingApp: (key: string) => blockedApps.some((b) => appMatches(b, [key])),
      isDistractingDomain,
      blockCount: blocks.data.filter((b) => b.ts >= startMs && b.ts < endMs).length,
      blockTop: Object.entries(blocks.data.filter((b) => b.ts >= startMs && b.ts < endMs).reduce<Record<string, number>>((a, b) => ({ ...a, [b.target]: (a[b.target] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).slice(0, 5),
      pauses: pauses.data.filter((p) => p.ts >= startMs && p.ts < endMs),
      hasUsage: apps.data.length > 0,
      hasWeb: web.data.length > 0,
    };
  }, [sessions.data, apps.data, web.data, blocks.data, rules.data, pauses.data, start, days, startMs, endMs, today, period]);

  const target = (period === 'day' ? settings.dailyTargetMin : period === 'week' ? settings.weeklyTargetMin : settings.weeklyTargetMin * (days / 7)) * 60_000;
  const delta = (c: { deltaPct: number | null }) => (c.deltaPct == null ? 'no earlier data' : `${c.deltaPct >= 0 ? '+' : ''}${Math.round(c.deltaPct * 100)}% vs previous ${period}`);

  const exportData = async (kind: 'csv' | 'json') => {
    try {
      const content =
        kind === 'json'
          ? JSON.stringify(await call('export_json_payload'), null, 2)
          : toCsv(
              sessions.data.map((s) => ({ id: s.id, mode: s.mode, phase: s.phase, status: s.status, started_at: new Date(s.startedAt).toISOString(), ended_at: s.endedAt ? new Date(s.endedAt).toISOString() : '', focused_minutes: Math.round(s.focusedMs / 600) / 100, planned_minutes: s.plannedMs ? s.plannedMs / 60_000 : '', note: s.note })),
            );
      const path = await call<string | null>('save_text_file', { defaultName: `monk-mode-${kind === 'csv' ? 'sessions' : 'export'}-${today}.${kind}`, content, extension: kind });
      if (path) toast(`Saved to ${path}`, 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const loading = sessions.loading || apps.loading;

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Everything is computed on this device from data it actually recorded."
        actions={
          <>
            <Segmented label="Report period" value={period} onChange={setPeriod} options={[{ value: 'day', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }]} />
            <Button icon={<Download className="h-3.5 w-3.5" />} onClick={() => exportData('csv')}>CSV</Button>
            <Button icon={<Download className="h-3.5 w-3.5" />} onClick={() => exportData('json')}>JSON</Button>
          </>
        }
      />
      {loading ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <Card title="Focus" action={<Prov p={r.summary.sessionCount ? 'recorded' : 'unavailable'} />}>
            <div className="grid grid-cols-2 gap-6 md:grid-cols-5">
              <Stat label="Focus time" value={fmtMs(r.focusMs)} hint={delta(r.compare)} tone="accent" />
              <Stat label="Target" value={fmtPct(target ? Math.min(1, r.focusMs / target) : null)} hint={`of ${fmtMs(target)}`} />
              <Stat label="Sessions" value={r.summary.sessionCount} hint={`${r.summary.completedCount} completed`} />
              <Stat label="Completion" value={fmtPct(r.summary.completionRate)} hint={`avg ${fmtMs(r.summary.averageMs)}`} />
              <Stat label="Longest · Streak" value={fmtMs(r.summary.longestMs)} hint={`${r.streak.current}-day streak · best ${r.streak.best}`} />
            </div>
            {period !== 'day' && (
              <div className="mt-6">
                <WeekBars days={r.series.map((d) => ({ label: period === 'week' ? new Date(`${d.date}T12:00`).toLocaleDateString([], { weekday: 'short' }) : String(Number(d.date.slice(8))), ms: d.ms, highlight: d.date === today }))} targetMs={period === 'week' ? settings.dailyTargetMin * 60_000 : undefined} height={140} />
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card title="Screen time" action={<Prov p={r.hasUsage ? 'measured' : 'unavailable'} />}>
              {r.hasUsage ? (
                <>
                  <div className="mb-5 grid grid-cols-2 gap-4">
                    <Stat label="Active screen time" value={fmtMs(r.screenMs)} hint={delta(r.screenCompare)} />
                    <Stat label="On blocked apps & sites" value={fmtMs(r.distraction)} hint={r.screenMs ? `${fmtPct(r.distraction / r.screenMs)} of screen time` : undefined} />
                  </div>
                  <RankList items={r.topApps} empty="No app usage in this period." highlight={r.isDistractingApp} />
                </>
              ) : (
                <p className="text-[12px] leading-relaxed text-ink-muted">App usage is measured from the frontmost app while MONK MODE runs, ignoring idle time over 5 minutes. Nothing has been measured yet{settings.usageTracking ? '' : ' — usage tracking is turned off in Settings'}.</p>
              )}
            </Card>
            <Card title="Websites" action={<Prov p={r.hasWeb ? 'measured' : 'unavailable'} />}>
              {r.hasWeb ? <RankList items={r.topWeb} empty="No website usage in this period." highlight={r.isDistractingDomain} /> : <p className="text-[12px] leading-relaxed text-ink-muted">Website time is measured by the MONK MODE browser extension (active tab only). Install and pair it in Settings to see this.</p>}
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <Card title="Time of day" action={<Prov p="recorded" />}>
              <HourBars hours={r.hours} />
            </Card>
            <Card title="Best weekdays · 90 days" action={<Prov p="recorded" />}>
              <WeekBars days={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, i) => ({ label, ms: r.weekdays[i] ?? 0 }))} height={96} />
            </Card>
            <Card title="Blocked attempts" action={<Prov p={r.blockCount ? 'measured' : 'unavailable'} />}>
              <div className="tabular text-[24px] font-semibold text-ink">{r.blockCount}</div>
              <ul className="mt-3 space-y-1.5">
                {r.blockTop.map(([target, n]) => (
                  <li key={target} className="flex justify-between text-[12px]"><span className="truncate text-ink">{target}</span><span className="tabular text-ink-muted">{n}×</span></li>
                ))}
              </ul>
            </Card>
          </div>

          <Card title="Mindful pauses" action={<Prov p={r.pauses.length ? 'measured' : 'unavailable'} />}>
            {r.pauses.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-ink-muted">Switch a blocklist to <span className="text-ink">Mindful pause</span> (Blocker page) to see how often a moment of breathing changes your mind.</p>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
                <div className="grid grid-cols-2 gap-4">
                  <Stat label="Pauses" value={r.pauses.length} />
                  <Stat label="Turned back" value={fmtPct(r.pauses.filter((p) => p.outcome === 'turned_back').length / r.pauses.length)} tone="accent" />
                </div>
                <ul className="space-y-1.5">
                  {r.pauses
                    .filter((p) => p.outcome === 'continued' && p.intention)
                    .slice(-6)
                    .reverse()
                    .map((p) => (
                      <li key={p.id} className="flex justify-between gap-4 text-[12px]">
                        <span className="truncate text-ink">“{p.intention}”</span>
                        <span className="shrink-0 text-ink-faint">{p.target}</span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1fr]">
            <Card title={`Trend · last ${period === 'month' ? 30 : 14} days`} action={<Prov p="recorded" />}>
              <TrendLine series={r.trend} />
            </Card>
            <Card title="Six months" action={<Prov p="recorded" />}>
              <Heatmap cells={r.heat} />
            </Card>
          </div>

          <p className="flex items-center gap-1.5 text-[11px] text-ink-faint">
            <Info className="h-3 w-3" /> Measured = observed on this device. Recorded = from your focus sessions. Nothing is estimated or sent anywhere.
          </p>
        </div>
      )}
    </>
  );
}
