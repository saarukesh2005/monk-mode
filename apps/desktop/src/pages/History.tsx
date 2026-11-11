import { useMemo, useState } from 'react';
import { Bell, Shield, ShieldAlert, Timer, Trash2 } from 'lucide-react';
import type { BlockEvent, FocusSession, StrictEvent } from '@monk/shared-types';
import { MODE_LABELS, localDateKey } from '@monk/shared-core';
import type { PageProps } from '../App';
import { Badge, Button, Card, EmptyState, ErrorState, IconButton, Loading, PageHeader, Segmented, Select, useConfirm, useToast } from '../components/ui';
import { useTable } from '../lib/hooks';
import { save, where } from '../lib/db';
import { call, errorMessage } from '../lib/ipc';
import { fmtDate, fmtDateTime, fmtMs, fmtTime } from '../lib/format';
import { useCategories } from '../lib/data';

type Tab = 'sessions' | 'blocks' | 'strict' | 'notifications';
const PAGE = 300;

interface Notification {
  id: string;
  ts: number;
  kind: string;
  title: string;
  body: string;
  read: boolean;
}

const STATUS_TONE = { completed: 'success', interrupted: 'warning', skipped: 'neutral', running: 'accent', paused: 'accent' } as const;
const STRICT_LABELS: Record<string, string> = {
  started: 'Commitment started',
  completed: 'Commitment completed',
  paused: 'Paused',
  resumed: 'Resumed',
  exit_requested: 'Emergency exit requested',
  exit_cancelled: 'Stayed committed',
  emergency_exit: 'Emergency exit',
  blocked_edit: 'Locked change refused',
  pause_refused: 'Pause refused',
  exception_refused: 'Exception refused',
  monitor_gap: 'App was not running',
  clock_changed: 'System clock changed',
};

export default function History(_: PageProps) {
  const [tab, setTab] = useState<Tab>('sessions');
  return (
    <>
      <PageHeader
        title="History"
        subtitle="A private record, stored only on this device."
        actions={
          <Segmented
            label="History type"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'sessions', label: 'Sessions' },
              { value: 'blocks', label: 'Blocks' },
              { value: 'strict', label: 'Strict mode' },
              { value: 'notifications', label: 'Notifications' },
            ]}
          />
        }
      />
      {tab === 'sessions' && <Sessions />}
      {tab === 'blocks' && <Blocks />}
      {tab === 'strict' && <Strict />}
      {tab === 'notifications' && <Notifications />}
    </>
  );
}

function groupByDay<T>(rows: T[], ts: (r: T) => number): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = localDateKey(ts(r));
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return [...m.entries()];
}

function DayHeader({ date, right }: { date: string; right?: string }) {
  return (
    <div className="sticky top-0 z-10 flex justify-between bg-surface px-5 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
      <span>{fmtDate(date, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}</span>
      {right && <span className="tabular normal-case tracking-normal">{right}</span>}
    </div>
  );
}

function Sessions() {
  const toast = useToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const categories = useCategories();
  const sessions = useTable<FocusSession>('focus_sessions', { filters: mode ? [where('mode', 'eq', mode)] : [], orderBy: 'started_at', desc: true, limit }, [mode, limit]);
  const groups = useMemo(() => groupByDay(sessions.data, (s) => s.startedAt), [sessions.data]);
  const del = async (s: FocusSession) => {
    if (await confirm({ title: 'Delete this session?', body: 'It will no longer count toward your statistics.', danger: true, confirmLabel: 'Delete' })) call('session_delete', { id: s.id }).catch((e) => toast(errorMessage(e), 'error'));
  };
  return (
    <Card padded={false}>
      <div className="flex justify-end border-b border-line px-5 py-3">
        <Select aria-label="Filter by mode" value={mode} onChange={(e) => setMode(e.target.value)} className="w-44">
          <option value="">All modes</option>
          {Object.entries(MODE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </div>
      {sessions.loading && <Loading />}
      {sessions.error && <div className="p-4"><ErrorState message={sessions.error} onRetry={sessions.reload} /></div>}
      {!sessions.loading && sessions.data.length === 0 && <EmptyState icon={<Timer className="h-5 w-5" />} title="No sessions yet" body="Your completed focus sessions and breaks will appear here." />}
      {groups.map(([date, rows]) => (
        <div key={date}>
          <DayHeader date={date} right={fmtMs(rows.filter((r) => r.phase === 'focus').reduce((a, r) => a + r.focusedMs, 0)) + ' focused'} />
          <ul className="divide-y divide-line">
            {rows.map((s) => {
              const cat = categories.data.find((c) => c.id === s.categoryId);
              return (
                <li key={s.id} className="group flex items-center gap-4 px-5 py-2.5">
                  <span className="tabular w-[92px] shrink-0 text-[12px] text-ink-muted">{fmtTime(s.startedAt)}{s.endedAt ? `–${fmtTime(s.endedAt)}` : ''}</span>
                  <span className="w-24 shrink-0 text-[13px] text-ink">{s.phase === 'focus' ? MODE_LABELS[s.mode] : s.phase === 'long_break' ? 'Long break' : 'Break'}</span>
                  <span className="tabular w-16 shrink-0 text-[13px] text-ink">{fmtMs(s.focusedMs)}</span>
                  <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                  {cat && <span className="flex items-center gap-1.5 text-[12px] text-ink-muted"><span className="h-2 w-2 rounded-full" style={{ background: cat.color }} />{cat.name}</span>}
                  {s.strict && <Badge tone="warning">strict</Badge>}
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink-faint">{s.note}</span>
                  {s.status !== 'running' && s.status !== 'paused' && (
                    <IconButton label="Delete session" onClick={() => del(s)} className="opacity-0 group-hover:opacity-100 focus:opacity-100">
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {sessions.data.length >= limit && (
        <div className="p-4 text-center">
          <Button size="sm" onClick={() => setLimit((l) => l + PAGE)}>Load more</Button>
        </div>
      )}
    </Card>
  );
}

function Blocks() {
  const events = useTable<BlockEvent>('block_events', { orderBy: 'ts', desc: true, limit: 1000 });
  const groups = useMemo(() => groupByDay(events.data, (e) => e.ts), [events.data]);
  return (
    <Card padded={false}>
      {events.loading && <Loading />}
      {!events.loading && events.data.length === 0 && <EmptyState icon={<Shield className="h-5 w-5" />} title="Nothing blocked yet" body="When Monk Guard closes an app or the extension redirects a site, it is logged here." />}
      {groups.map(([date, rows]) => (
        <div key={date}>
          <DayHeader date={date} right={`${rows.length} blocked`} />
          <ul className="divide-y divide-line">
            {rows.map((e) => (
              <li key={e.id} className="flex items-center gap-4 px-5 py-2.5 text-[13px]">
                <span className="tabular w-14 text-[12px] text-ink-muted">{fmtTime(e.ts)}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{e.target}</span>
                <Badge>{e.source === 'app' ? 'app closed' : 'site redirected'}</Badge>
                <Badge tone={e.trigger === 'strict' ? 'warning' : 'neutral'}>{e.trigger}</Badge>
                <span className="w-16 text-right text-[11px] text-ink-faint">{e.platform}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  );
}

function Strict() {
  const events = useTable<StrictEvent>('strict_events', { orderBy: 'ts', desc: true, limit: 1000 });
  return (
    <Card padded={false}>
      {events.loading && <Loading />}
      {!events.loading && events.data.length === 0 && <EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="No strict-mode activity" body="Commitments, emergency exits and refused changes are recorded here." />}
      <ul className="divide-y divide-line">
        {events.data.map((e) => (
          <li key={e.id} className="flex items-center gap-4 px-5 py-2.5 text-[13px]">
            <span className="tabular w-40 shrink-0 text-[12px] text-ink-muted">{fmtDateTime(e.ts)}</span>
            <span className={['blocked_edit', 'monitor_gap', 'clock_changed', 'emergency_exit', 'pause_refused', 'exception_refused'].includes(e.kind) ? 'text-warning' : 'text-ink'}>{STRICT_LABELS[e.kind] ?? e.kind}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-faint">{e.detail}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Notifications() {
  const toast = useToast();
  const items = useTable<Notification>('notifications', { orderBy: 'ts', desc: true, limit: 500 });
  const unread = items.data.filter((n) => !n.read);
  const markAll = async () => {
    try {
      for (const n of unread) await save('notifications', { id: n.id, read: true });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <Card padded={false}>
      {unread.length > 0 && (
        <div className="flex justify-end border-b border-line px-5 py-2.5">
          <Button size="sm" variant="ghost" onClick={markAll}>Mark {unread.length} as read</Button>
        </div>
      )}
      {!items.loading && items.data.length === 0 && <EmptyState icon={<Bell className="h-5 w-5" />} title="No notifications" />}
      <ul className="divide-y divide-line">
        {items.data.map((n) => (
          <li key={n.id} className="flex items-start gap-3 px-5 py-3">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-accent'}`} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-ink">{n.title}</div>
              <div className="text-[12px] text-ink-muted">{n.body}</div>
            </div>
            <span className="tabular shrink-0 text-[11px] text-ink-faint">{fmtDateTime(n.ts)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
