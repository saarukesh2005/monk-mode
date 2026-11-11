import { useEffect, useMemo, useState } from 'react';
import { Clock, Globe2, HardDrive, Plus, Shield, Timer, Trash2 } from 'lucide-react';
import type { ActiveBlockSet, QuickBlock, TemporaryException, UsageLimit } from '@monk/shared-types';
import { CAPABILITIES, formatDuration, newId } from '@monk/shared-core';
import { validateRule } from '@monk/validation';
import type { PageProps } from '../App';
import { Badge, Button, Card, EmptyState, ErrorState, IconButton, Input, Loading, Modal, Notice, PageHeader, Select, cx, useConfirm, useToast } from '../components/ui';
import { ListEditor, createList, startQuickBlock } from '../components/ListEditor';
import { StrictPanel } from '../components/StrictPanel';
import { CapabilityList } from '../components/CapabilityList';
import { useBlocklists, useRules } from '../lib/data';
import { useCommand, useNow, useTable } from '../lib/hooks';
import { remove, save, where } from '../lib/db';
import { call, errorMessage } from '../lib/ipc';
import { useSettings } from '../lib/settings';

interface AppInfo {
  platform: string;
}

export default function Blocker({ navigate }: PageProps) {
  const toast = useToast();
  const lists = useBlocklists();
  const rules = useRules();
  const now = useNow(1000);
  const blockSet = useCommand<ActiveBlockSet | null>('block_set_current', null, ['monk://blockset']);
  const strict = useCommand<{ session: { listIds: string[]; level: string } | null } | null>('strict_status', null, ['monk://strict']);
  const quick = useTable<QuickBlock>('quick_blocks', { filters: [where('ended_at', 'isnull'), where('ends_at', 'gt', Math.floor(now / 60_000) * 60_000)] }, [Math.floor(now / 60_000)]);
  const info = useCommand<AppInfo>('app_info', { platform: 'macos' });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<null | 'block' | 'allow'>(null);
  const [name, setName] = useState('');
  const [quickList, setQuickList] = useState('');
  const [quickMin, setQuickMin] = useState(60);

  const blockLists = lists.data.filter((l) => l.kind === 'block');
  const current = lists.data.find((l) => l.id === selected) ?? lists.data[0];
  useEffect(() => {
    if (!quickList && blockLists[0]) setQuickList(blockLists[0].id);
  }, [blockLists, quickList]);

  const lockedIds = useMemo(() => (strict.data?.session && strict.data.session.level !== 'normal' ? strict.data.session.listIds : []), [strict.data]);

  const create = async () => {
    if (!creating || !name.trim()) return;
    try {
      const l = await createList(creating, name.trim().slice(0, 80));
      setSelected(l.id);
      setCreating(null);
      setName('');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const quickStart = async () => {
    try {
      await startQuickBlock(quickList, quickMin);
      toast(`Blocking for ${formatDuration(quickMin * 60_000)}`, 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const status = blockSet.data;

  return (
    <>
      <PageHeader title="Blocker" subtitle="Monk Guard closes distracting apps and, with the browser extension, blocks websites." />

      <Card className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={cx('flex h-10 w-10 items-center justify-center rounded-xl', status?.active ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink-faint')}>
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[14px] font-medium text-ink">{status?.active ? 'Blocking now' : 'Idle'}</div>
              <div className="text-[12px] text-ink-muted">
                {status?.active ? `${status.apps.length} apps · ${status.domains.length} sites · ${status.urlPatterns.length} URL patterns — ${status.triggers.join(', ')}` : 'Blocks start with focus sessions, schedules, quick blocks or strict mode.'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select aria-label="List for quick block" value={quickList} onChange={(e) => setQuickList(e.target.value)} className="w-40">
              {blockLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Quick block length" value={quickMin} onChange={(e) => setQuickMin(Number(e.target.value))} className="w-28">
              {[15, 30, 60, 120, 240, 480].map((m) => (
                <option key={m} value={m}>
                  {formatDuration(m * 60_000)}
                </option>
              ))}
            </Select>
            <Button variant="primary" icon={<Timer className="h-4 w-4" />} onClick={quickStart} disabled={!quickList}>
              Block now
            </Button>
          </div>
        </div>
        {quick.data.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            {quick.data.map((q) => (
              <span key={q.id} className="flex items-center gap-2 rounded-lg bg-surface-2 py-1 pl-3 pr-1 text-[12px] text-ink">
                <Clock className="h-3.5 w-3.5 text-accent" />
                {lists.data.find((l) => l.id === q.listId)?.name} · {formatDuration(q.endsAt - now, { seconds: true })} left
                <Button size="sm" variant="ghost" disabled={lockedIds.includes(q.listId)} onClick={() => call('quick_block_stop', { id: q.id }).catch((e) => toast(errorMessage(e), 'error'))}>
                  Stop
                </Button>
              </span>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[230px_1fr]">
        <Card padded={false} className="h-fit">
          <div className="p-2">
            {lists.loading && <Loading />}
            {lists.data.map((l) => (
              <button key={l.id} type="button" onClick={() => setSelected(l.id)} className={cx('flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px]', current?.id === l.id ? 'bg-surface-3 text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink')}>
                <span className="truncate">{l.name}</span>
                <span className="flex items-center gap-1.5">
                  {!l.enabled && <span className="text-[10px] text-ink-faint">off</span>}
                  <span className={cx('h-1.5 w-1.5 rounded-full', l.kind === 'allow' ? 'bg-success' : 'bg-accent')} />
                </span>
              </button>
            ))}
          </div>
          <div className="flex gap-1 border-t border-line p-2">
            <Button size="sm" variant="ghost" className="flex-1" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating('block')}>
              Blocklist
            </Button>
            <Button size="sm" variant="ghost" className="flex-1" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating('allow')}>
              Allowlist
            </Button>
          </div>
        </Card>

        <Card title={current?.name ?? 'Lists'}>
          {lists.error && <ErrorState message={lists.error} onRetry={lists.reload} />}
          {current ? <ListEditor list={current} rules={rules.data.filter((r) => r.listId === current.id)} locked={lockedIds.includes(current.id)} /> : !lists.loading && <EmptyState title="No lists yet" body="Create a blocklist to start." />}
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <StrictPanel lists={lists.data} />
        <ExceptionsCard />
        <LimitsCard />
        <SystemWideCard lists={blockLists} />
      </div>

      <Card title="What this device can enforce" className="mt-5" action={<Button size="sm" variant="ghost" onClick={() => navigate('settings')}>Browser extension setup</Button>}>
        <CapabilityList items={CAPABILITIES[info.data.platform === 'windows' ? 'windows' : 'macos']} />
      </Card>
    </>
  );
}

function ExceptionsCard() {
  const toast = useToast();
  const now = useNow(15_000);
  const exceptions = useTable<TemporaryException>('exceptions', { filters: [where('until_at', 'gt', now)], orderBy: 'until_at' }, [Math.floor(now / 15_000)]);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'domain' | 'app'>('domain');
  const [value, setValue] = useState('');
  const [minutes, setMinutes] = useState(5);
  const [reason, setReason] = useState('');
  const grant = async () => {
    try {
      await call('exception_grant', { kind, value, minutes, reason });
      setOpen(false);
      setValue('');
      setReason('');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <Card title="Temporary exceptions" action={<Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>Allow briefly</Button>}>
      {exceptions.data.length === 0 ? (
        <p className="text-[12px] text-ink-muted">Need a blocked site for a minute? Grant a short exception (up to 60 minutes). Not available during strict sessions.</p>
      ) : (
        <ul className="space-y-2">
          {exceptions.data.map((e) => (
            <li key={e.id} className="flex justify-between text-[13px]">
              <span className="text-ink">{e.value}</span>
              <span className="tabular text-ink-muted">{formatDuration(e.untilAt - now)} left</span>
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Allow briefly" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={grant} disabled={!value.trim()}>Allow</Button></>}>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value as 'domain' | 'app')} className="w-32">
              <option value="domain">Website</option>
              <option value="app">App</option>
            </Select>
            <Input aria-label="What to allow" placeholder={kind === 'domain' ? 'youtube.com' : 'Discord'} value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <Select aria-label="Minutes" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {[1, 5, 10, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </Select>
          <Input aria-label="Reason" placeholder="Why? (optional, saved to history)" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </Modal>
    </Card>
  );
}

function LimitsCard() {
  const toast = useToast();
  const confirm = useConfirm();
  const limits = useTable<UsageLimit>('usage_limits', { orderBy: 'created_at' });
  const [type, setType] = useState<'app' | 'domain'>('app');
  const [value, setValue] = useState('');
  const [minutes, setMinutes] = useState(30);
  const add = async () => {
    const v = validateRule(type, value);
    if (!v.ok) return toast(v.errors[0] ?? 'Invalid', 'error');
    try {
      await save('usage_limits', { id: newId(), type, value: v.value, label: value.trim(), minutesPerDay: minutes, platform: 'all', enabled: true });
      setValue('');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <Card title="Daily limits">
      <p className="mb-3 text-[12px] text-ink-muted">Once you have used an app or site for this long today (measured on this device), it is blocked until midnight.</p>
      <div className="flex gap-2">
        <Select aria-label="Limit type" value={type} onChange={(e) => setType(e.target.value as 'app' | 'domain')} className="w-24">
          <option value="app">App</option>
          <option value="domain">Site</option>
        </Select>
        <Input aria-label="App or site" placeholder={type === 'app' ? 'Slack' : 'youtube.com'} value={value} onChange={(e) => setValue(e.target.value)} />
        <Input aria-label="Minutes per day" type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="w-20" />
        <Button onClick={add} disabled={!value.trim()}>
          Add
        </Button>
      </div>
      <ul className="mt-3 divide-y divide-line">
        {limits.data.map((l) => (
          <li key={l.id} className="flex items-center justify-between py-2 text-[13px]">
            <span className="text-ink">
              {l.label || l.value} <Badge>{l.type === 'app' ? 'app' : 'site'}</Badge>
            </span>
            <span className="flex items-center gap-2 text-ink-muted">
              {l.minutesPerDay} min/day
              <IconButton
                label="Remove limit"
                onClick={async () => {
                  if (await confirm({ title: 'Remove limit?', body: `${l.value} will no longer be limited.`, confirmLabel: 'Remove' })) remove('usage_limits', { id: l.id }).catch((e) => toast(errorMessage(e), 'error'));
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

interface HostsStatus {
  path: string;
  readable: boolean;
  managedSection: boolean;
  managedDomains: number;
  supported: boolean;
}

function SystemWideCard({ lists }: { lists: { id: string; name: string }[] }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { settings, update } = useSettings();
  const status = useCommand<HostsStatus | null>('hosts_status', null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string>('');
  const run = async (cmd: string, args?: Record<string, unknown>) => {
    setBusy(true);
    try {
      const changed = await call<boolean>(cmd, args);
      toast(changed ? 'Hosts file updated' : 'No changes were needed', 'success');
      status.reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  if (status.data && !status.data.supported) return null;
  return (
    <Card title="System-wide website blocking" action={<Badge tone="warning">Needs admin approval</Badge>}>
      <div className="space-y-3 text-[12px] leading-relaxed text-ink-muted">
        <p>
          Optionally block whole domains in every browser and app by adding a clearly marked section to <code className="text-ink">{status.data?.path ?? 'the hosts file'}</code>. Your computer asks for your administrator password each time. MONK MODE keeps a backup and only ever removes its own section.
        </p>
        <Notice icon={<Globe2 className="h-4 w-4" />}>Works per domain only (no URL paths). Browsers using secure DNS (DNS-over-HTTPS) may skip it.</Notice>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-ink">
            <HardDrive className="h-3.5 w-3.5 text-ink-faint" /> {status.data?.managedSection ? `${status.data.managedDomains} domains currently blocked` : 'Not active'}
          </span>
          <label className="flex items-center gap-2">
            Use automatically in strict sessions
            <input
              type="checkbox"
              className="accent-[var(--accent)]"
              checked={settings.hostsBlockingEnabled}
              onChange={async (e) => {
                const v = e.target.checked;
                if (v && !(await confirm({ title: 'Allow hosts-file changes?', body: 'When a Strict or Maximum session starts, MONK MODE will ask for your administrator password to add its blocking section, and remove it when the session ends. You can turn this off at any time outside a strict session.', confirmLabel: 'Allow' }))) return;
                update('hostsBlockingEnabled', v).catch((err) => toast(errorMessage(err), 'error'));
              }}
            />
          </label>
        </div>
        <div className="flex gap-2">
          <Select aria-label="List to apply" value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Choose a list…</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
          <Button loading={busy} disabled={!selected} onClick={() => run('hosts_apply', { listIds: [selected] })}>
            Apply
          </Button>
          <Button variant="ghost" disabled={busy || !status.data?.managedSection} onClick={() => run('hosts_remove')}>
            Remove
          </Button>
        </div>
      </div>
    </Card>
  );
}
