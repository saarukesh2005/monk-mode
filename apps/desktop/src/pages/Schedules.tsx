import { useState } from 'react';
import { CalendarClock, Lock, Plus, Trash2 } from 'lucide-react';
import type { Schedule } from '@monk/shared-types';
import { ALL_DAYS_MASK, DAY_LABELS, WEEKDAYS_MASK, WEEKEND_MASK, describeDays, formatClock, isScheduleActive, newId, toggleDay } from '@monk/shared-core';
import { parseTimeOfDay, validateSchedule } from '@monk/validation';
import type { PageProps } from '../App';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorState, Field, IconButton, Input, Loading, Modal, PageHeader, Select, Switch, cx, useConfirm, useToast } from '../components/ui';
import { useBlocklists, useSchedules } from '../lib/data';
import { useNow } from '../lib/hooks';
import { remove, save } from '../lib/db';
import { errorMessage } from '../lib/ipc';

export default function Schedules({ navigate }: PageProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const schedules = useSchedules();
  const lists = useBlocklists();
  const now = useNow(30_000);
  const [editing, setEditing] = useState<Partial<Schedule> | null>(null);
  const blockLists = lists.data.filter((l) => l.kind === 'block');

  const toggle = (s: Schedule, enabled: boolean) => save('schedules', { id: s.id, enabled }).catch((e) => toast(errorMessage(e), 'error'));
  const del = async (s: Schedule) => {
    if (await confirm({ title: `Delete “${s.name}”?`, body: 'The schedule stops immediately.', danger: true, confirmLabel: 'Delete' })) remove('schedules', { id: s.id }).catch((e) => toast(errorMessage(e), 'error'));
  };

  return (
    <>
      <PageHeader
        title="Schedules"
        subtitle="Recurring windows when a blocklist switches on by itself."
        actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} disabled={blockLists.length === 0} onClick={() => setEditing({ name: '', listId: blockLists[0]?.id, daysMask: WEEKDAYS_MASK, startMinute: 540, endMinute: 1020, strict: false, enabled: true })}>New schedule</Button>}
      />
      {schedules.loading && <Loading />}
      {schedules.error && <ErrorState message={schedules.error} onRetry={schedules.reload} />}
      {!schedules.loading && schedules.data.length === 0 && (
        <Card>
          <EmptyState icon={<CalendarClock className="h-5 w-5" />} title="No schedules yet" body={blockLists.length ? 'Example: block Social media on weekdays from 09:00 to 17:00, or every night from 22:30 to 06:30.' : 'Create a blocklist first.'} action={!blockLists.length ? <Button onClick={() => navigate('blocker')}>Go to Blocker</Button> : undefined} />
        </Card>
      )}
      <div className="space-y-3">
        {schedules.data.map((s) => {
          const active = isScheduleActive(s, new Date(now));
          const list = lists.data.find((l) => l.id === s.listId);
          return (
            <Card key={s.id} padded={false}>
              <div className="flex items-center gap-4 px-5 py-4">
                <div className={cx('flex h-10 w-10 items-center justify-center rounded-xl', active ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink-faint')}>
                  {s.strict ? <Lock className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
                </div>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(s)}>
                  <div className="flex items-center gap-2 text-[14px] font-medium text-ink">
                    {s.name}
                    {active && s.enabled && <Badge tone="accent">Active now</Badge>}
                    {s.strict && <Badge tone="warning">Strict</Badge>}
                  </div>
                  <div className="tabular mt-0.5 text-[12px] text-ink-muted">
                    {describeDays(s.daysMask)} · {s.startMinute === s.endMinute ? 'all day' : `${formatClock(s.startMinute)}–${formatClock(s.endMinute)}${s.endMinute < s.startMinute ? ' (next day)' : ''}`} · {list?.name ?? 'missing list'}
                  </div>
                </button>
                <Switch label={`Enable ${s.name}`} checked={s.enabled} onChange={(v) => toggle(s, v)} />
                <IconButton label="Delete schedule" onClick={() => del(s)}>
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </div>
            </Card>
          );
        })}
      </div>
      {editing && <ScheduleEditor initial={editing} lists={blockLists} onClose={() => setEditing(null)} />}
    </>
  );
}

function ScheduleEditor({ initial, lists, onClose }: { initial: Partial<Schedule>; lists: { id: string; name: string }[]; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(initial.name ?? '');
  const [listId, setListId] = useState(initial.listId ?? '');
  const [mask, setMask] = useState(initial.daysMask ?? WEEKDAYS_MASK);
  const [start, setStart] = useState(formatClock(initial.startMinute ?? 540));
  const [end, setEnd] = useState(formatClock(initial.endMinute ?? 1020));
  const [strict, setStrict] = useState(initial.strict ?? false);
  const [errors, setErrors] = useState<string[]>([]);

  const submit = async () => {
    const startMinute = parseTimeOfDay(start);
    const endMinute = parseTimeOfDay(end);
    if (startMinute == null || endMinute == null) return setErrors(['Times must look like 09:00']);
    const v = validateSchedule({ name, listId, daysMask: mask, startMinute, endMinute });
    if (!v.ok) return setErrors(v.errors);
    try {
      await save('schedules', { id: initial.id ?? newId(), ...v.value, strict, enabled: initial.enabled ?? true });
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  return (
    <Modal open onClose={onClose} title={initial.id ? 'Edit schedule' : 'New schedule'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Save</Button></>}>
      <div className="space-y-4">
        {errors.length > 0 && <ErrorState message={errors.join(' · ')} />}
        <Field label="Name">{(id) => <Input id={id} placeholder="Work hours" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Blocklist">
          {(id) => (
            <Select id={id} value={listId} onChange={(e) => setListId(e.target.value)}>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
        </Field>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-ink-muted">
            Days
            <span className="flex gap-1">
              {[['Weekdays', WEEKDAYS_MASK], ['Weekends', WEEKEND_MASK], ['Every day', ALL_DAYS_MASK]].map(([l, m]) => (
                <button key={l} type="button" onClick={() => setMask(m as number)} className="rounded px-1.5 text-[11px] text-ink-faint hover:text-ink">{l}</button>
              ))}
            </span>
          </div>
          <div className="flex gap-1.5">
            {DAY_LABELS.map((d, i) => (
              <button key={d} type="button" aria-pressed={(mask & (1 << i)) !== 0} onClick={() => setMask(toggleDay(mask, i))} className={cx('h-9 flex-1 rounded-lg border text-[12px] font-medium', (mask & (1 << i)) !== 0 ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-muted hover:text-ink')}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">{(id) => <Input id={id} type="time" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
          <Field label="Until" hint="Earlier than start = overnight. Same as start = all day.">{(id) => <Input id={id} type="time" value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
        </div>
        <label className="flex items-start gap-2.5 text-[12px] leading-relaxed text-ink-muted">
          <Checkbox label="Strict schedule" checked={strict} onChange={setStrict} className="mt-0.5" />
          <span><span className="font-medium text-ink">Strict schedule.</span> While active, temporary exceptions are refused and the schedule cannot be edited or deleted.</span>
        </label>
      </div>
    </Modal>
  );
}
