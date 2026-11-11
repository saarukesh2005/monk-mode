import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Moon, Sun } from 'lucide-react';
import type { DailyPlan, Task } from '@monk/shared-types';
import { addDays, localDateKey } from '@monk/shared-core';
import { focusByDay, summarizeFocus } from '@monk/analytics';
import { cleanText } from '@monk/validation';
import { Bar, Button, Card, Checkbox, Field, IconButton, Input, Stat, Textarea, cx, useToast } from '../ui';
import { save, where } from '../../lib/db';
import { errorMessage } from '../../lib/ipc';
import { useTable } from '../../lib/hooks';
import { useSessionsSince } from '../../lib/data';
import { useSettings } from '../../lib/settings';
import { fmtDate, fmtMs, fmtPct } from '../../lib/format';

const MOODS = ['Rough', 'Meh', 'Okay', 'Good', 'Great'];

export function DailyPlanner() {
  const toast = useToast();
  const { settings } = useSettings();
  const [date, setDate] = useState(() => localDateKey(Date.now()));
  const plans = useTable<DailyPlan>('daily_plans', { filters: [where('date', 'eq', date)] }, [date]);
  const tasks = useTable<Task>('tasks', { filters: [where('due_date', 'eq', date), where('parent_id', 'isnull')] }, [date]);
  const sessions = useSessionsSince(Math.max(2, Math.ceil((Date.now() - new Date(`${date}T00:00`).getTime()) / 86_400_000) + 1));
  const stored = plans.data[0];
  const [draft, setDraft] = useState({ intention: '', priorities: ['', '', ''], focusTargetMin: settings.dailyTargetMin, review: '', mood: null as number | null });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (plans.loading) return;
    setDraft({
      intention: stored?.intention ?? '',
      priorities: [...(stored?.priorities ?? []), '', '', ''].slice(0, 3),
      focusTargetMin: stored?.focusTargetMin || settings.dailyTargetMin,
      review: stored?.review ?? '',
      mood: stored?.mood ?? null,
    });
    setDirty(false);
  }, [stored, plans.loading, settings.dailyTargetMin, date]);

  const day = useMemo(() => {
    const own = sessions.data.filter((s) => localDateKey(s.startedAt) === date);
    return { ms: focusByDay(sessions.data).get(date) ?? 0, summary: summarizeFocus(own) };
  }, [sessions.data, date]);

  const persist = async (extra: Partial<DailyPlan> = {}) => {
    try {
      await save('daily_plans', {
        date,
        intention: cleanText(draft.intention, 500),
        priorities: draft.priorities.map((p) => cleanText(p, 200)).filter(Boolean),
        focusTargetMin: Math.max(0, Math.min(1440, Math.round(draft.focusTargetMin) || 0)),
        review: cleanText(draft.review, 5000),
        mood: draft.mood,
        ...extra,
      });
      setDirty(false);
      toast('Plan saved', 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };

  const today = localDateKey(Date.now());
  const done = tasks.data.filter((t) => t.status === 'done').length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <IconButton label="Previous day" onClick={() => setDate(addDays(date, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </IconButton>
          <div className="min-w-[200px] text-center text-[14px] font-medium text-ink">{fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <IconButton label="Next day" onClick={() => setDate(addDays(date, 1))}>
            <ChevronRight className="h-4 w-4" />
          </IconButton>
          {date !== today && (
            <Button size="sm" variant="ghost" onClick={() => setDate(today)}>
              Today
            </Button>
          )}
        </div>
        <Button variant="primary" disabled={!dirty} onClick={() => persist()}>
          Save plan
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-1.5"><Sun className="h-3.5 w-3.5" /> Morning planning</span>}>
          <div className="space-y-4">
            <Field label="Intention for the day">{(id) => <Textarea id={id} rows={2} placeholder="Today I will…" value={draft.intention} onChange={(e) => set('intention', e.target.value)} />}</Field>
            <div>
              <div className="mb-1.5 text-[12px] font-medium text-ink-muted">Top three priorities</div>
              <div className="space-y-2">
                {draft.priorities.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="tabular w-4 text-[12px] text-accent">{i + 1}</span>
                    <Input aria-label={`Priority ${i + 1}`} value={p} onChange={(e) => set('priorities', draft.priorities.map((x, j) => (j === i ? e.target.value : x)))} />
                  </div>
                ))}
              </div>
            </div>
            <Field label="Focus target (minutes)">{(id) => <Input id={id} type="number" min={0} max={1440} value={draft.focusTargetMin} onChange={(e) => set('focusTargetMin', Number(e.target.value))} className="w-32" />}</Field>
          </div>
        </Card>

        <Card title="Progress">
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Focused" value={fmtMs(day.ms)} tone="accent" />
            <Stat label="Sessions" value={day.summary.sessionCount} hint={fmtPct(day.summary.completionRate) + ' complete'} />
            <Stat label="Tasks" value={`${done}/${tasks.data.length}`} hint="due this day" />
          </div>
          <Bar value={draft.focusTargetMin ? day.ms / (draft.focusTargetMin * 60_000) : 0} className="mt-5" />
          <ul className="mt-5 space-y-2">
            {tasks.data.length === 0 && <li className="text-[12px] text-ink-faint">No tasks due on this day.</li>}
            {tasks.data.map((t) => (
              <li key={t.id} className="flex items-center gap-2.5">
                <Checkbox label={t.title} checked={t.status === 'done'} onChange={(v) => save('tasks', { id: t.id, status: v ? 'done' : 'todo', completedAt: v ? Date.now() : null }).catch((e) => toast(errorMessage(e), 'error'))} />
                <span className={cx('text-[13px]', t.status === 'done' ? 'text-ink-faint line-through' : 'text-ink')}>{t.title}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={<span className="flex items-center gap-1.5"><Moon className="h-3.5 w-3.5" /> End-of-day review</span>} className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_220px]">
            <Field label="What went well, what got in the way, what changes tomorrow?">{(id) => <Textarea id={id} rows={4} value={draft.review} onChange={(e) => set('review', e.target.value)} />}</Field>
            <div>
              <div className="mb-1.5 text-[12px] font-medium text-ink-muted">How did today feel?</div>
              <div className="flex flex-wrap gap-1.5">
                {MOODS.map((m, i) => (
                  <button key={m} type="button" aria-pressed={draft.mood === i + 1} onClick={() => set('mood', draft.mood === i + 1 ? null : i + 1)} className={cx('rounded-full border px-2.5 py-1 text-[11px]', draft.mood === i + 1 ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-muted hover:text-ink')}>
                    {m}
                  </button>
                ))}
              </div>
              <Button className="mt-4 w-full" onClick={() => persist({ reviewedAt: Date.now() })}>
                {stored?.reviewedAt ? 'Update review' : 'Close the day'}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
