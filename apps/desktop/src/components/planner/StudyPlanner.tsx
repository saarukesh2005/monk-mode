import { useMemo, useState } from 'react';
import { Archive, GraduationCap, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { Subject, Topic, TopicStatus } from '@monk/shared-types';
import { addDays, localDateKey, newId, startOfWeek } from '@monk/shared-core';
import { cleanText } from '@monk/validation';
import { ACCENTS } from '@monk/design-system';
import { Badge, Bar, Button, Card, EmptyState, IconButton, Input, Modal, Select, cx, useConfirm, useToast } from '../ui';
import { remove, save } from '../../lib/db';
import { errorMessage } from '../../lib/ipc';
import { useSessionsSince, useSubjects, useTopics } from '../../lib/data';
import { fmtMs, fmtPct } from '../../lib/format';

/** Expanding review intervals (days) for spaced revision. */
const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60];
const STATUS_LABEL: Record<TopicStatus, string> = { not_started: 'Not started', learning: 'Learning', done: 'Learned' };

export function StudyPlanner() {
  const toast = useToast();
  const confirm = useConfirm();
  const subjects = useSubjects();
  const topics = useTopics();
  const sessions = useSessionsSince(400);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState(180);
  const [newTopic, setNewTopic] = useState<Record<string, string>>({});
  const today = localDateKey(Date.now());
  const weekStart = startOfWeek(today);

  const stats = useMemo(() => {
    const m = new Map<string, { week: number; total: number; last: number | null }>();
    for (const s of sessions.data) {
      if (!s.subjectId || s.phase !== 'focus') continue;
      const cur = m.get(s.subjectId) ?? { week: 0, total: 0, last: null };
      const inWeek = localDateKey(s.startedAt) >= weekStart;
      m.set(s.subjectId, { week: cur.week + (inWeek ? s.focusedMs : 0), total: cur.total + s.focusedMs, last: Math.max(cur.last ?? 0, s.startedAt) });
    }
    return m;
  }, [sessions.data, weekStart]);

  const due = topics.data.filter((t) => t.nextReview && t.nextReview <= today);

  const addSubject = async () => {
    const n = cleanText(name, 80);
    if (!n) return;
    try {
      await save('subjects', { id: newId(), name: n, color: ACCENTS[subjects.data.length % ACCENTS.length]!.dark, weeklyGoalMin: Math.max(0, goal), archived: false });
      setAdding(false);
      setName('');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const addTopic = async (subjectId: string) => {
    const title = cleanText(newTopic[subjectId], 200);
    if (!title) return;
    await save('topics', { id: newId(), subjectId, title, status: 'not_started', reviewCount: 0 }).catch((e) => toast(errorMessage(e), 'error'));
    setNewTopic((s) => ({ ...s, [subjectId]: '' }));
  };

  const setStatus = (t: Topic, status: TopicStatus) =>
    save('topics', { id: t.id, status, ...(status === 'done' && !t.nextReview ? { lastReviewed: today, nextReview: addDays(today, REVIEW_INTERVALS[0]!) } : {}) }).catch((e) => toast(errorMessage(e), 'error'));

  const review = (t: Topic) => {
    const n = t.reviewCount + 1;
    const interval = REVIEW_INTERVALS[Math.min(n, REVIEW_INTERVALS.length - 1)]!;
    save('topics', { id: t.id, reviewCount: n, lastReviewed: today, nextReview: addDays(today, interval), status: 'done' }).catch((e) => toast(errorMessage(e), 'error'));
  };

  const active = subjects.data.filter((s) => !s.archived);

  return (
    <div className="space-y-5">
      {due.length > 0 && (
        <Card title={`Due for revision · ${due.length}`}>
          <ul className="divide-y divide-line">
            {due.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2">
                <span className="text-[13px] text-ink">
                  {t.title} <span className="text-ink-faint">· {subjects.data.find((s) => s.id === t.subjectId)?.name}</span>
                </span>
                <Button size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => review(t)}>
                  Mark reviewed
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex justify-end">
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
          Subject
        </Button>
      </div>

      {active.length === 0 && (
        <Card>
          <EmptyState icon={<GraduationCap className="h-5 w-5" />} title="No subjects yet" body="Add subjects with a weekly goal. Tag focus sessions with a subject to track time; break subjects into topics to track progress and revision." />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {active.map((s) => {
          const st = stats.get(s.id) ?? { week: 0, total: 0, last: null };
          const own = topics.data.filter((t) => t.subjectId === s.id);
          const learned = own.filter((t) => t.status === 'done').length;
          return (
            <Card
              key={s.id}
              title={<span className="flex items-center gap-2 normal-case tracking-normal"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} /><span className="text-[14px] font-semibold text-ink">{s.name}</span></span>}
              action={
                <span className="flex">
                  <IconButton label="Archive subject" onClick={() => save('subjects', { id: s.id, archived: true }).catch(() => undefined)}>
                    <Archive className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton label="Delete subject" onClick={async () => { if (await confirm({ title: `Delete ${s.name}?`, body: 'Topics are deleted. Focus sessions are kept but lose their subject.', danger: true, confirmLabel: 'Delete' })) remove('subjects', { id: s.id }).catch((e) => toast(errorMessage(e), 'error')); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </span>
              }
            >
              <div className="grid grid-cols-3 gap-3 text-[12px]">
                <div><div className="text-ink-faint">This week</div><div className="tabular text-[15px] font-semibold text-ink">{fmtMs(st.week)}</div></div>
                <div><div className="text-ink-faint">All time</div><div className="tabular text-[15px] font-semibold text-ink">{fmtMs(st.total)}</div></div>
                <div><div className="text-ink-faint">Topics learned</div><div className="tabular text-[15px] font-semibold text-ink">{own.length ? fmtPct(learned / own.length) : '—'}</div></div>
              </div>
              {s.weeklyGoalMin > 0 && (
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-[11px] text-ink-faint"><span>Weekly goal</span><span>{fmtMs(s.weeklyGoalMin * 60_000)}</span></div>
                  <Bar value={st.week / (s.weeklyGoalMin * 60_000)} />
                </div>
              )}
              <ul className="mt-4 space-y-1.5">
                {own.map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <Select aria-label={`Status of ${t.title}`} value={t.status} onChange={(e) => setStatus(t, e.target.value as TopicStatus)} className="h-7 w-[110px] text-[11px]">
                      {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </Select>
                    <span className={cx('flex-1 truncate text-[13px]', t.status === 'done' ? 'text-ink-muted' : 'text-ink')}>{t.title}</span>
                    {t.nextReview && <Badge tone={t.nextReview <= today ? 'warning' : 'neutral'}>review {t.nextReview <= today ? 'due' : t.nextReview.slice(5)}</Badge>}
                    <IconButton label="Delete topic" onClick={() => remove('topics', { id: t.id }).catch(() => undefined)}><Trash2 className="h-3 w-3" /></IconButton>
                  </li>
                ))}
              </ul>
              <form className="mt-2 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void addTopic(s.id); }}>
                <Plus className="h-3.5 w-3.5 text-ink-faint" />
                <input aria-label={`New topic for ${s.name}`} value={newTopic[s.id] ?? ''} onChange={(e) => setNewTopic((x) => ({ ...x, [s.id]: e.target.value }))} placeholder="Add topic" className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-faint focus:outline-none" />
              </form>
            </Card>
          );
        })}
      </div>

      {subjects.data.some((s) => s.archived) && (
        <p className="text-[12px] text-ink-faint">
          Archived: {subjects.data.filter((s) => s.archived).map((s) => (
            <button key={s.id} type="button" className="mr-2 underline hover:text-ink" onClick={() => save('subjects', { id: s.id, archived: false }).catch(() => undefined)}>{s.name}</button>
          ))}
        </p>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="New subject" footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" onClick={addSubject} disabled={!name.trim()}>Add</Button></>}>
        <div className="space-y-3">
          <Input aria-label="Subject name" placeholder="e.g. Organic Chemistry" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="flex items-center gap-2 text-[13px] text-ink-muted">
            Weekly goal <Input aria-label="Weekly goal minutes" type="number" min={0} value={goal} onChange={(e) => setGoal(Number(e.target.value))} className="w-24" /> minutes
          </label>
        </div>
      </Modal>
    </div>
  );
}

export type { Subject };
