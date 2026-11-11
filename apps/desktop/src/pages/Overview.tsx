import { useMemo } from 'react';
import { ArrowRight, Flame, Play, Shield, Target } from 'lucide-react';
import type { ActiveBlockSet, BlockEvent, DailyPlan, Task } from '@monk/shared-types';
import { addDays, localDateKey, startOfWeek } from '@monk/shared-core';
import { dailySeries, focusByDay, focusStreak, summarizeFocus } from '@monk/analytics';
import type { PageProps } from '../App';
import { Badge, Bar, Button, Card, EmptyState, PageHeader, Stat } from '../components/ui';
import { useCommand, useNow, useTable, useTimer } from '../lib/hooks';
import { useSessionsSince } from '../lib/data';
import { useSettings } from '../lib/settings';
import { where } from '../lib/db';
import { fmtMs, fmtPct, fmtTime, greeting } from '../lib/format';
import { WeekBars } from '../components/charts';

export default function Overview({ navigate }: PageProps) {
  const { settings } = useSettings();
  const now = useNow(30_000);
  const today = localDateKey(now);
  const timer = useTimer();
  const sessions = useSessionsSince(400);
  const plan = useTable<DailyPlan>('daily_plans', { filters: [where('date', 'eq', today)] }, [today]);
  const tasks = useTable<Task>('tasks', { filters: [where('status', 'eq', 'todo'), where('parent_id', 'isnull')], orderBy: 'priority', desc: true, limit: 200 });
  const blocks = useTable<BlockEvent>('block_events', { filters: [where('ts', 'gte', now - 86_400_000)], orderBy: 'ts', desc: true, limit: 200 }, [today]);
  const blockSet = useCommand<ActiveBlockSet | null>('block_set_current', null, ['monk://blockset']);

  const stats = useMemo(() => {
    const byDay = focusByDay(sessions.data);
    const weekStart = startOfWeek(today);
    const week = dailySeries(byDay, weekStart, 7);
    const todaySessions = sessions.data.filter((s) => localDateKey(s.startedAt) === today);
    return {
      byDay,
      todayMs: byDay.get(today) ?? 0,
      weekMs: week.reduce((a, d) => a + d.ms, 0),
      week,
      streak: focusStreak(byDay, today, 60_000),
      todaySummary: summarizeFocus(todaySessions),
    };
  }, [sessions.data, today]);

  const live = timer.snapshot?.session?.phase === 'focus' ? timer.elapsed : 0;
  const todayMs = stats.todayMs + live;
  const target = (plan.data[0]?.focusTargetMin || settings.dailyTargetMin) * 60_000;
  const priorities = plan.data[0]?.priorities ?? [];
  const dueToday = tasks.data.filter((t) => t.dueDate && t.dueDate <= today);
  const widgets = new Set(settings.dashboardWidgets);

  return (
    <>
      <PageHeader
        title={`${greeting(new Date(now))}.`}
        subtitle={new Date(now).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
        actions={
          !timer.snapshot?.session && (
            <Button variant="primary" icon={<Play className="h-4 w-4" />} onClick={() => navigate('focus')}>
              Start focus
            </Button>
          )
        }
      />

      {widgets.has('today') && (
        <Card className="mb-5">
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            <Stat label="Focused today" value={fmtMs(todayMs)} hint={`${fmtPct(Math.min(1, todayMs / Math.max(1, target)))} of ${fmtMs(target)}`} tone="accent" />
            <Stat label="This week" value={fmtMs(stats.weekMs + live)} hint={`target ${fmtMs(settings.weeklyTargetMin * 60_000)}`} />
            <Stat label="Sessions today" value={stats.todaySummary.sessionCount} hint={stats.todaySummary.completionRate == null ? 'none finished yet' : `${fmtPct(stats.todaySummary.completionRate)} completed`} />
            <Stat label="Streak" value={`${stats.streak.current} ${stats.streak.current === 1 ? 'day' : 'days'}`} hint={`best ${stats.streak.best}`} />
          </div>
          <Bar value={todayMs / Math.max(1, target)} className="mt-5" />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {widgets.has('week') && (
          <Card title="This week" className="lg:col-span-2" action={<Button size="sm" variant="ghost" onClick={() => navigate('analytics')}>Analytics <ArrowRight className="h-3 w-3" /></Button>}>
            {sessions.loading ? <div className="h-40" /> : <WeekBars days={stats.week.map((d) => ({ label: new Date(`${d.date}T12:00`).toLocaleDateString([], { weekday: 'short' }), ms: d.date === today ? d.ms + live : d.ms, highlight: d.date === today }))} targetMs={target} />}
          </Card>
        )}

        {widgets.has('streak') && (
          <Card title="Today's intention">
            {plan.data[0]?.intention || priorities.length ? (
              <div className="space-y-3">
                {plan.data[0]?.intention && <p className="text-[14px] leading-relaxed text-ink">{plan.data[0].intention}</p>}
                <ol className="space-y-1.5">
                  {priorities.map((p, i) => (
                    <li key={i} className="flex gap-2 text-[13px] text-ink-muted">
                      <span className="tabular text-accent">{i + 1}.</span>
                      {p}
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <EmptyState icon={<Target className="h-5 w-5" />} title="No plan for today" body="Set an intention and three priorities. It takes a minute." action={<Button size="sm" onClick={() => navigate('planner')}>Plan my day</Button>} />
            )}
          </Card>
        )}

        {widgets.has('tasks') && (
          <Card title="Up next" className="lg:col-span-2" action={<Button size="sm" variant="ghost" onClick={() => navigate('tasks')}>All tasks <ArrowRight className="h-3 w-3" /></Button>}>
            {tasks.data.length === 0 ? (
              <EmptyState title="Nothing on your list" body="Add tasks to keep your focus sessions pointed at real work." />
            ) : (
              <ul className="divide-y divide-line">
                {(dueToday.length ? dueToday : tasks.data).slice(0, 6).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="truncate text-[13px] text-ink">{t.title}</span>
                    <span className="flex shrink-0 gap-1.5">
                      {t.priority >= 2 && <Badge tone={t.priority === 3 ? 'danger' : 'warning'}>{t.priority === 3 ? 'Urgent' : 'High'}</Badge>}
                      {t.dueDate && <Badge tone={t.dueDate < today ? 'danger' : 'neutral'}>{t.dueDate === today ? 'Today' : t.dueDate < today ? 'Overdue' : t.dueDate === addDays(today, 1) ? 'Tomorrow' : t.dueDate}</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {widgets.has('blocks') && (
          <Card title="Monk Guard" action={<Button size="sm" variant="ghost" onClick={() => navigate('blocker')}>Blocker <ArrowRight className="h-3 w-3" /></Button>}>
            <div className="flex items-center gap-3">
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${blockSet.data?.active ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink-faint'}`}>
                <Shield className="h-4 w-4" />
              </div>
              <div>
                <div className="text-[13px] font-medium text-ink">{blockSet.data?.active ? 'Blocking is active' : 'Not blocking right now'}</div>
                <div className="text-[12px] text-ink-muted">
                  {blockSet.data?.active ? `${blockSet.data.apps.length} apps · ${blockSet.data.domains.length + blockSet.data.urlPatterns.length} web rules · ${blockSet.data.triggers.join(', ')}` : 'Starts with focus sessions and schedules'}
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 text-[12px] text-ink-muted">
              <Flame className="h-3.5 w-3.5 text-accent" />
              {blocks.data.length} distraction{blocks.data.length === 1 ? '' : 's'} blocked in 24 h
            </div>
            {blocks.data.slice(0, 3).map((b) => (
              <div key={b.id} className="mt-2 flex justify-between text-[12px]">
                <span className="truncate text-ink">{b.target}</span>
                <span className="tabular text-ink-faint">{fmtTime(b.ts)}</span>
              </div>
            ))}
          </Card>
        )}
      </div>
    </>
  );
}
