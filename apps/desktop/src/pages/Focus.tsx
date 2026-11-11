import { useMemo, useState } from 'react';
import { Pause, Play, RotateCcw, SkipForward, Square } from 'lucide-react';
import type { FocusMode } from '@monk/shared-types';
import { MODE_DEFAULT_MIN, MODE_LABELS, PRESET_DURATIONS_MIN, formatDuration, localDateKey, progress } from '@monk/shared-core';
import { focusByDay } from '@monk/analytics';
import type { PageProps } from '../App';
import { Badge, Button, Card, Field, Input, PageHeader, ProgressRing, Select, Textarea, cx, useConfirm, useToast } from '../components/ui';
import { call, errorMessage } from '../lib/ipc';
import { useHotkeys, useNow, useTimer } from '../lib/hooks';
import { useSettings } from '../lib/settings';
import { useCategories, useSessionsSince, useSubjects, useTasks } from '../lib/data';
import { fmtMs } from '../lib/format';

const MODES: FocusMode[] = ['pomodoro', 'deep_work', 'study', 'reading', 'custom', 'stopwatch', 'break'];

const PHASE_LABEL = { focus: 'Focus', short_break: 'Short break', long_break: 'Long break' } as const;

export default function Focus(_: PageProps) {
  const { settings } = useSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const timer = useTimer();
  const session = timer.snapshot?.session ?? null;
  const now = useNow(1000);
  const [mode, setMode] = useState<FocusMode>(settings.defaultMode);
  const [minutes, setMinutes] = useState<number | ''>(MODE_DEFAULT_MIN[settings.defaultMode] ?? 25);
  const [categoryId, setCategoryId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const categories = useCategories();
  const subjects = useSubjects();
  const tasks = useTasks();
  const sessions = useSessionsSince(1);

  const todayMs = useMemo(() => focusByDay(sessions.data).get(localDateKey(now)) ?? 0, [sessions.data, now]);
  const liveFocusMs = session?.phase === 'focus' ? timer.elapsed : 0;
  const pomodoroMin = settings.pomodoro.focusMin;

  const pickMode = (m: FocusMode) => {
    setMode(m);
    setMinutes(m === 'pomodoro' ? pomodoroMin : m === 'break' ? settings.pomodoro.shortBreakMin : MODE_DEFAULT_MIN[m] ?? '');
  };

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      timer.reload();
      if (ok) toast(ok, 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(() =>
      call('focus_start', {
        req: {
          mode,
          durationMin: mode === 'stopwatch' ? undefined : Number(minutes) || undefined,
          categoryId: categoryId || null,
          subjectId: subjectId || null,
          taskId: taskId || null,
          note,
        },
      }),
    );
  const pause = () => run(() => call('focus_pause'));
  const resume = () => run(() => call('focus_resume'));
  const end = async () => {
    if (session?.strict && session.phase === 'focus' && !(await confirm({ title: 'End during strict mode?', body: 'A strict session is running. Ending the timer will not lift strict-mode blocks.', confirmLabel: 'End timer' }))) return;
    await run(() => call('focus_end'), 'Session saved');
  };
  const reset = async () => {
    if (await confirm({ title: 'Discard this session?', body: 'Reset removes the current session without recording any focus time.', confirmLabel: 'Discard', danger: true })) await run(() => call('focus_reset'));
  };
  const skip = () => run(() => call('focus_skip_break'));

  useHotkeys({
    ' ': () => (session ? (session.status === 'running' ? pause() : resume()) : start()),
    'mod+enter': () => session && end(),
  });

  const isBreak = session ? session.phase !== 'focus' : false;
  const display = session ? (timer.remaining != null ? timer.remaining : timer.elapsed) : (mode === 'stopwatch' ? 0 : (Number(minutes) || 0) * 60_000);
  const ring = session ? (session.plannedMs ? progress(session, now) : (timer.elapsed % 3_600_000) / 3_600_000) : 0;
  const openTasks = tasks.data.filter((t) => t.status === 'todo' && !t.parentId);

  return (
    <>
      <PageHeader title="Focus" subtitle="One thing at a time. The timer keeps running even if you close the window." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
        <Card className="flex flex-col items-center py-6">
          {!session && (
            <div role="radiogroup" aria-label="Focus mode" className="mb-8 flex flex-wrap justify-center gap-1.5">
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => pickMode(m)}
                  className={cx('rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors', mode === m ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-muted hover:border-line-strong hover:text-ink')}
                >
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
          )}
          {session && (
            <div className="mb-8 flex items-center gap-2">
              <Badge tone={isBreak ? 'success' : 'accent'}>{PHASE_LABEL[session.phase]}</Badge>
              <Badge>{MODE_LABELS[session.mode]}</Badge>
              {session.mode === 'pomodoro' && session.cycleIndex > 0 && <Badge>Round {session.cycleIndex} of {settings.pomodoro.longBreakEvery}</Badge>}
              {session.status === 'paused' && <Badge tone="warning">Paused</Badge>}
            </div>
          )}

          <ProgressRing value={ring} size={300} stroke={5} muted={isBreak || session?.status === 'paused'}>
            <div className="tabular text-[64px] font-light tracking-[-0.04em] text-ink" aria-live="off">
              {formatDuration(display, { seconds: settings.showSecondsInTimer || display < 3_600_000 })}
            </div>
            <div className="mt-1 text-[12px] text-ink-faint">{session ? (session.plannedMs ? 'remaining' : 'elapsed') : mode === 'stopwatch' ? 'open-ended' : 'ready'}</div>
          </ProgressRing>

          <div className="mt-8 flex items-center gap-2">
            {!session && (
              <Button variant="primary" size="lg" icon={<Play className="h-4 w-4" />} onClick={start} loading={busy} className="min-w-[160px]">
                Start {mode === 'break' ? 'break' : 'focus'}
              </Button>
            )}
            {session?.status === 'running' && (
              <Button size="lg" icon={<Pause className="h-4 w-4" />} onClick={pause} disabled={busy}>
                Pause
              </Button>
            )}
            {session?.status === 'paused' && (
              <Button variant="primary" size="lg" icon={<Play className="h-4 w-4" />} onClick={resume} disabled={busy}>
                Resume
              </Button>
            )}
            {session && isBreak && (
              <Button size="lg" icon={<SkipForward className="h-4 w-4" />} onClick={skip} disabled={busy}>
                Skip break
              </Button>
            )}
            {session && (
              <Button size="lg" icon={<Square className="h-3.5 w-3.5" />} onClick={end} disabled={busy}>
                End
              </Button>
            )}
            {session && (
              <Button size="lg" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={reset} disabled={busy} aria-label="Reset">
                Reset
              </Button>
            )}
          </div>
          <p className="mt-4 text-[11px] text-ink-faint">Space to start or pause · {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to end</p>
        </Card>

        <div className="space-y-5">
          {!session && (
            <Card title="Session setup">
              <div className="space-y-4">
                {mode !== 'stopwatch' && (
                  <Field label="Duration (minutes)">
                    {(id) => (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                          {PRESET_DURATIONS_MIN.map((d) => (
                            <button key={d} type="button" onClick={() => setMinutes(d)} className={cx('tabular rounded-md border px-2.5 py-1 text-[12px]', minutes === d ? 'border-accent text-accent' : 'border-line text-ink-muted hover:text-ink')}>
                              {d}
                            </button>
                          ))}
                        </div>
                        <Input id={id} type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value === '' ? '' : Number(e.target.value))} />
                      </div>
                    )}
                  </Field>
                )}
                <Field label="Category">
                  {(id) => (
                    <Select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                      <option value="">None</option>
                      {categories.data.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Subject">
                  {(id) => (
                    <Select id={id} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                      <option value="">None</option>
                      {subjects.data.filter((s) => !s.archived).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Working on">
                  {(id) => (
                    <Select id={id} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                      <option value="">No specific task</option>
                      {openTasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Intention">{(id) => <Textarea id={id} rows={2} placeholder="What will this session produce?" value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
              </div>
            </Card>
          )}
          {session && (
            <SessionNote key={session.id} id={session.id} initial={session.note} categoryId={session.categoryId} subjectId={session.subjectId} taskId={session.taskId} />
          )}
          <Card title="Today">
            <div className="flex items-baseline justify-between">
              <span className="tabular text-[22px] font-semibold text-ink">{fmtMs(todayMs + liveFocusMs)}</span>
              <span className="text-[12px] text-ink-muted">of {fmtMs(settings.dailyTargetMin * 60_000)} target</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.min(100, ((todayMs + liveFocusMs) / Math.max(1, settings.dailyTargetMin * 60_000)) * 100)}%` }} />
            </div>
            <p className="mt-3 text-[12px] text-ink-muted">Pomodoro: {settings.pomodoro.focusMin}m focus · {settings.pomodoro.shortBreakMin}m short · {settings.pomodoro.longBreakMin}m long every {settings.pomodoro.longBreakEvery}.</p>
          </Card>
        </div>
      </div>
    </>
  );
}

function SessionNote({ id, initial, categoryId, subjectId, taskId }: { id: string; initial: string; categoryId: string | null; subjectId: string | null; taskId: string | null }) {
  const [note, setNote] = useState(initial);
  const toast = useToast();
  const save = async () => {
    if (note === initial) return;
    try {
      await call('session_update', { id, note, categoryId, subjectId, taskId });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <Card title="Session notes">
      <Textarea rows={5} value={note} onChange={(e) => setNote(e.target.value)} onBlur={save} placeholder="Notes are saved with the session." aria-label="Session notes" />
    </Card>
  );
}
