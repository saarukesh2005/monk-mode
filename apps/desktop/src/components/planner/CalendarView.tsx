import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { CalendarEvent, EventOccurrence, Recurrence, Task } from '@monk/shared-types';
import { RECURRENCES } from '@monk/shared-types';
import { addDays, addMonths, expandEvents, localDateKey, newId, parseLocalDate, startOfMonth, startOfWeek } from '@monk/shared-core';
import { cleanText } from '@monk/validation';
import { Button, Card, Checkbox, ErrorState, Field, IconButton, Input, Modal, Segmented, Select, Textarea, cx, useToast } from '../ui';
import { remove, save } from '../../lib/db';
import { errorMessage } from '../../lib/ipc';
import { useEvents, useSessionsSince, useSubjects, useTasks } from '../../lib/data';
import { fmtDate, fmtMs, fmtTime } from '../../lib/format';

type Range = 'day' | 'week' | 'month';
const KIND_COLOR: Record<CalendarEvent['kind'], string> = { event: 'var(--muted)', focus_block: 'var(--accent)', study: 'var(--success)' };
const KIND_LABEL: Record<CalendarEvent['kind'], string> = { event: 'Event', focus_block: 'Focus block', study: 'Study' };

interface DayItems {
  events: EventOccurrence[];
  tasks: Task[];
  focusMs: number;
}

export function CalendarView() {
  const [range, setRange] = useState<Range>('week');
  const [anchor, setAnchor] = useState(() => localDateKey(Date.now()));
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const events = useEvents();
  const tasks = useTasks();
  const sessions = useSessionsSince(100);
  const today = localDateKey(Date.now());

  const days = useMemo(() => {
    if (range === 'day') return [anchor];
    if (range === 'week') return Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i));
    const first = startOfWeek(startOfMonth(anchor));
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
  }, [range, anchor]);

  const items = useMemo(() => {
    const from = parseLocalDate(days[0]!).getTime();
    const to = parseLocalDate(addDays(days[days.length - 1]!, 1)).getTime();
    const occ = expandEvents(events.data, from, to);
    const map = new Map<string, DayItems>(days.map((d) => [d, { events: [], tasks: [], focusMs: 0 }]));
    for (const o of occ) map.get(localDateKey(o.startAt))?.events.push(o);
    for (const t of tasks.data) if (t.dueDate && !t.parentId) map.get(t.dueDate)?.tasks.push(t);
    for (const s of sessions.data) if (s.phase === 'focus') { const d = map.get(localDateKey(s.startedAt)); if (d) d.focusMs += s.focusedMs; }
    return map;
  }, [days, events.data, tasks.data, sessions.data]);

  const step = (dir: 1 | -1) => setAnchor(range === 'day' ? addDays(anchor, dir) : range === 'week' ? addDays(anchor, 7 * dir) : addMonths(anchor, dir));
  const title = range === 'month' ? fmtDate(anchor, { month: 'long', year: 'numeric' }) : range === 'week' ? `${fmtDate(days[0]!)} – ${fmtDate(days[6]!, { month: 'short', day: 'numeric', year: 'numeric' })}` : fmtDate(anchor, { weekday: 'long', month: 'long', day: 'numeric' });

  const newEvent = (date: string, kind: CalendarEvent['kind'] = 'event') => {
    const d = parseLocalDate(date);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0).getTime();
    setEditing({ id: '', title: '', kind, startAt: start, endAt: start + 3_600_000, allDay: false, recurrence: 'none', subjectId: null, notes: '', createdAt: 0, updatedAt: 0 });
  };

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="flex items-center gap-1">
          <IconButton label="Previous" onClick={() => step(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </IconButton>
          <IconButton label="Next" onClick={() => step(1)}>
            <ChevronRight className="h-4 w-4" />
          </IconButton>
          <span className="ml-2 text-[14px] font-medium text-ink">{title}</span>
          <Button size="sm" variant="ghost" onClick={() => setAnchor(today)}>
            Today
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Segmented label="Calendar range" size="sm" value={range} onChange={setRange} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
          <Button size="sm" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => newEvent(anchor)}>
            Event
          </Button>
        </div>
      </div>
      {events.error && <div className="p-4"><ErrorState message={events.error} /></div>}

      {range === 'month' ? (
        <div className="grid grid-cols-7">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="border-b border-line px-2 py-1.5 text-[11px] text-ink-faint">{d}</div>
          ))}
          {days.map((d) => {
            const it = items.get(d)!;
            const inMonth = d.slice(0, 7) === anchor.slice(0, 7);
            return (
              <button key={d} type="button" onClick={() => { setAnchor(d); setRange('day'); }} className={cx('min-h-[92px] border-b border-r border-line p-1.5 text-left align-top hover:bg-surface-2', !inMonth && 'opacity-40')}>
                <div className={cx('tabular mb-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px]', d === today ? 'bg-accent text-accent-contrast' : 'text-ink-muted')}>{Number(d.slice(8))}</div>
                {it.events.slice(0, 2).map((e, i) => (
                  <div key={i} className="truncate rounded px-1 text-[10px] text-ink" style={{ borderLeft: `2px solid ${KIND_COLOR[e.kind]}` }}>{e.title}</div>
                ))}
                {it.tasks.length > 0 && <div className="truncate px-1 text-[10px] text-warning">{it.tasks.length} due</div>}
                {it.focusMs > 0 && <div className="px-1 text-[10px] text-accent">{fmtMs(it.focusMs)}</div>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className={cx('grid', range === 'week' ? 'grid-cols-7' : 'grid-cols-1')}>
          {days.map((d) => {
            const it = items.get(d)!;
            return (
              <div key={d} className="min-h-[360px] border-r border-line p-2 last:border-r-0">
                <button type="button" onClick={() => newEvent(d)} className="mb-2 flex w-full items-baseline justify-between rounded-md px-1 py-0.5 hover:bg-surface-2" title="Add event">
                  <span className={cx('text-[12px]', d === today ? 'font-semibold text-accent' : 'text-ink-muted')}>{fmtDate(d, { weekday: 'short', day: 'numeric' })}</span>
                  {it.focusMs > 0 && <span className="tabular text-[10px] text-accent">{fmtMs(it.focusMs)}</span>}
                </button>
                <div className="space-y-1.5">
                  {it.events.map((e, i) => {
                    const src = events.data.find((x) => x.id === e.eventId);
                    return (
                      <button key={i} type="button" onClick={() => src && setEditing(src)} className="w-full rounded-md bg-surface-2 px-2 py-1.5 text-left hover:bg-surface-3" style={{ borderLeft: `3px solid ${KIND_COLOR[e.kind]}` }}>
                        <div className="truncate text-[12px] text-ink">{e.title}</div>
                        <div className="tabular text-[10px] text-ink-faint">{e.allDay ? 'All day' : `${fmtTime(e.startAt)}–${fmtTime(e.endAt)}`}</div>
                      </button>
                    );
                  })}
                  {it.tasks.map((t) => (
                    <div key={t.id} className={cx('truncate rounded-md border border-dashed border-line px-2 py-1 text-[11px]', t.status === 'done' ? 'text-ink-faint line-through' : 'text-warning')}>☐ {t.title}</div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editing && <EventEditor event={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

const toLocalInput = (ts: number) => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return { date: localDateKey(ts), time: `${p(d.getHours())}:${p(d.getMinutes())}` };
};

function EventEditor({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const toast = useToast();
  const subjects = useSubjects();
  const start = toLocalInput(event.startAt);
  const end = toLocalInput(event.endAt);
  const [f, setF] = useState({ title: event.title, kind: event.kind, date: start.date, start: start.time, end: end.time, allDay: event.allDay, recurrence: event.recurrence, subjectId: event.subjectId ?? '', notes: event.notes });
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const title = cleanText(f.title, 200);
    if (!title) return setErr('Give the event a title');
    const s = new Date(`${f.date}T${f.allDay ? '00:00' : f.start}`).getTime();
    let e = new Date(`${f.date}T${f.allDay ? '23:59' : f.end}`).getTime();
    if (Number.isNaN(s) || Number.isNaN(e)) return setErr('Check the date and times');
    if (e <= s) e += 86_400_000; // ends after midnight
    try {
      await save('events', { id: event.id || newId(), title, kind: f.kind, startAt: s, endAt: e, allDay: f.allDay, recurrence: f.recurrence, subjectId: f.subjectId || null, notes: cleanText(f.notes, 5000) });
      onClose();
    } catch (x) {
      toast(errorMessage(x), 'error');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={event.id ? 'Edit event' : 'New event'}
      footer={
        <div className="flex w-full justify-between">
          {event.id ? (
            <Button variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => remove('events', { id: event.id }).then(onClose).catch((x) => toast(errorMessage(x), 'error'))}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={submit}>Save</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {err && <ErrorState message={err} />}
        <Field label="Title">{(id) => <Input id={id} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            {(id) => (
              <Select id={id} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as CalendarEvent['kind'] })}>
                {Object.entries(KIND_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Date">{(id) => <Input id={id} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          {!f.allDay && <Field label="Starts">{(id) => <Input id={id} type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />}</Field>}
          {!f.allDay && <Field label="Ends">{(id) => <Input id={id} type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />}</Field>}
          <Field label="Repeats">
            {(id) => (
              <Select id={id} value={f.recurrence} onChange={(e) => setF({ ...f, recurrence: e.target.value as Recurrence })}>
                {RECURRENCES.map((r) => (
                  <option key={r} value={r}>{r === 'none' ? 'Does not repeat' : r[0]!.toUpperCase() + r.slice(1)}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Subject">
            {(id) => (
              <Select id={id} value={f.subjectId} onChange={(e) => setF({ ...f, subjectId: e.target.value })}>
                <option value="">None</option>
                {subjects.data.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ink-muted">
          <Checkbox label="All day" checked={f.allDay} onChange={(v) => setF({ ...f, allDay: v })} /> All day
        </label>
        <Field label="Notes">{(id) => <Textarea id={id} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
      </div>
    </Modal>
  );
}
