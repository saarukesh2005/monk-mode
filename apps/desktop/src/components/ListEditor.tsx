import { useMemo, useState } from 'react';
import { AppWindow, Globe, Link2, Plus, Tag, Trash2 } from 'lucide-react';
import type { Blocklist, BlockRule, RuleType } from '@monk/shared-types';
import { DOMAIN_PRESETS, newId, presetById } from '@monk/shared-core';
import { validateRule } from '@monk/validation';
import { Badge, Button, IconButton, Input, Modal, Segmented, Select, Switch, cx, useConfirm, useToast } from './ui';
import { remove, save } from '../lib/db';
import { call, errorMessage } from '../lib/ipc';
import { useCommand } from '../lib/hooks';

interface AppInfo {
  id: string;
  name: string;
  path: string;
}

const TYPE_META: Record<RuleType, { label: string; icon: typeof Globe; placeholder: string }> = {
  domain: { label: 'Website', icon: Globe, placeholder: 'reddit.com' },
  url_pattern: { label: 'URL pattern', icon: Link2, placeholder: 'youtube.com/shorts*' },
  app: { label: 'App', icon: AppWindow, placeholder: 'Discord' },
  category: { label: 'Category', icon: Tag, placeholder: '' },
};

export function ListEditor({ list, rules, locked }: { list: Blocklist; rules: BlockRule[]; locked: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [type, setType] = useState<RuleType>('domain');
  const [value, setValue] = useState('');
  const [platform, setPlatform] = useState<BlockRule['platform']>('all');
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);

  const add = async (t: RuleType, raw: string, label = '', plat: BlockRule['platform'] = platform) => {
    const v = validateRule(t, raw, plat);
    if (!v.ok) return setError(v.errors[0] ?? 'Invalid value');
    if (rules.some((r) => r.type === t && r.value === v.value && r.platform === plat)) return setError('Already on this list');
    try {
      await save('block_rules', { id: newId(), listId: list.id, type: t, value: v.value, label, platform: plat });
      setValue('');
      setError(null);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const del = async (r: BlockRule) => {
    try {
      await remove('block_rules', { id: r.id });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const update = async (patch: Partial<Blocklist>) => {
    try {
      await save('blocklists', { id: list.id, ...patch });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const delList = async () => {
    if (await confirm({ title: `Delete “${list.name}”?`, body: 'Its rules and schedules are deleted too. Block history is kept.', confirmLabel: 'Delete', danger: true })) {
      try {
        await remove('blocklists', { id: list.id });
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    }
  };

  const isAllow = list.kind === 'allow';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge tone={isAllow ? 'success' : 'accent'}>{isAllow ? 'Allowlist' : 'Blocklist'}</Badge>
          {locked && <Badge tone="warning">Locked by strict session</Badge>}
        </div>
        <div className="flex items-center gap-4 text-[12px] text-ink-muted">
          {!isAllow && (
            <label className="flex items-center gap-2">
              Block during focus <Switch label="Block during focus sessions" checked={list.blockDuringFocus} onChange={(v) => update({ blockDuringFocus: v })} />
            </label>
          )}
          <label className="flex items-center gap-2">
            Enabled <Switch label="List enabled" checked={list.enabled} onChange={(v) => update({ enabled: v })} disabled={locked} />
          </label>
          <IconButton label="Delete list" onClick={delList} disabled={locked}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Rule type"
            size="sm"
            value={type}
            onChange={(t) => {
              setType(t);
              setError(null);
            }}
            options={(isAllow ? (['domain', 'app'] as RuleType[]) : (['domain', 'url_pattern', 'app', 'category'] as RuleType[])).map((t) => ({ value: t, label: TYPE_META[t].label }))}
          />
          {type === 'category' ? (
            <div className="flex flex-wrap gap-1.5">
              {DOMAIN_PRESETS.map((p) => {
                const on = rules.some((r) => r.type === 'category' && r.value === p.id);
                return (
                  <button key={p.id} type="button" title={p.description} disabled={on} onClick={() => add('category', p.id, p.label, 'all')} className={cx('rounded-full border px-2.5 py-1 text-[11px]', on ? 'border-accent/40 text-accent opacity-60' : 'border-line text-ink-muted hover:border-line-strong hover:text-ink')}>
                    {on ? '✓ ' : '+ '}
                    {p.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <form
              className="flex min-w-[280px] flex-1 items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void add(type, value);
              }}
            >
              <Input aria-label={`${TYPE_META[type].label} to add`} value={value} onChange={(e) => setValue(e.target.value)} placeholder={TYPE_META[type].placeholder} className="h-8" />
              {type === 'app' && (
                <>
                  <Select aria-label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value as BlockRule['platform'])} className="h-8 w-[120px]">
                    <option value="all">All desktops</option>
                    <option value="macos">macOS only</option>
                    <option value="windows">Windows only</option>
                    <option value="android">Android</option>
                  </Select>
                  <Button size="sm" onClick={() => setPicker(true)}>
                    Choose…
                  </Button>
                </>
              )}
              <Button size="sm" variant="primary" type="submit" icon={<Plus className="h-3.5 w-3.5" />}>
                Add
              </Button>
            </form>
          )}
        </div>
        {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
        {type === 'url_pattern' && <p className="mt-2 text-[11px] text-ink-faint">URL patterns only work in browsers with the MONK MODE extension. Use * as a wildcard, e.g. instagram.com/reels*</p>}
      </div>

      {rules.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-ink-faint">{isAllow ? 'Sites and apps here are never blocked.' : 'Add websites, URL patterns, apps or whole categories.'}</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {rules.map((r) => {
            const Icon = TYPE_META[r.type].icon;
            const preset = r.type === 'category' ? presetById(r.value) : undefined;
            return (
              <li key={r.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <Icon className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink">{preset?.label ?? r.label ?? r.value}{!preset && r.label && r.label !== r.value ? <span className="ml-2 text-ink-faint">{r.value}</span> : null}</div>
                  {preset && <div className="truncate text-[11px] text-ink-faint">{[...preset.domains, ...preset.urlPatterns].slice(0, 6).join(', ')}{preset.domains.length + preset.urlPatterns.length > 6 ? '…' : ''}</div>}
                </div>
                {r.platform !== 'all' && <Badge>{r.platform}</Badge>}
                <IconButton label="Remove" onClick={() => del(r)} disabled={locked}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
      <AppPicker open={picker} onClose={() => setPicker(false)} onPick={(a) => add('app', a.id, a.name)} />
    </div>
  );
}

function AppPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (a: AppInfo) => void }) {
  const running = useCommand<AppInfo[]>('apps_running', []);
  const installed = useCommand<AppInfo[]>('apps_installed', []);
  const [q, setQ] = useState('');
  const apps = useMemo(() => {
    const map = new Map<string, AppInfo & { running: boolean }>();
    for (const a of installed.data) map.set(a.id.toLowerCase(), { ...a, running: false });
    for (const a of running.data) map.set(a.id.toLowerCase(), { ...a, running: true });
    return [...map.values()].filter((a) => a.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => Number(b.running) - Number(a.running) || a.name.localeCompare(b.name));
  }, [running.data, installed.data, q]);
  return (
    <Modal open={open} onClose={onClose} title="Choose an app" width="max-w-lg">
      <Input autoFocus placeholder="Search apps" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search apps" />
      <div className="mt-3 max-h-[360px] overflow-y-auto">
        {apps.length === 0 && <p className="py-8 text-center text-[12px] text-ink-faint">{running.loading ? 'Looking for apps…' : 'No apps found. Open the app you want to block, or type its name.'}</p>}
        {apps.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => {
              onPick(a);
              onClose();
            }}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-surface-2"
          >
            <span className="text-[13px] text-ink">{a.name}</span>
            {a.running && <Badge tone="success">running</Badge>}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-ink-faint">On Windows, apps are matched by their .exe name, e.g. steam.exe. Running apps are listed first.</p>
    </Modal>
  );
}

export async function createList(kind: Blocklist['kind'], name: string): Promise<Blocklist> {
  return save<Blocklist>('blocklists', { id: newId(), name, kind, enabled: true, blockDuringFocus: kind === 'block' });
}

export async function startQuickBlock(listId: string, minutes: number): Promise<void> {
  await call('quick_block_start', { listId, minutes });
}
