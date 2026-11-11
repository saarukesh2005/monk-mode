import { useState, type ReactNode } from 'react';
import { Copy, Database, Download, KeyRound, RefreshCw, Upload } from 'lucide-react';
import type { AppSettings, FocusMode } from '@monk/shared-types';
import { CAPABILITIES, MODE_LABELS, passphraseStrength } from '@monk/shared-core';
import { ACCENTS, THEMES } from '@monk/design-system';
import type { PageProps } from '../App';
import { Badge, Button, Card, Field, Input, Modal, Notice, PageHeader, Segmented, Select, SettingRow, Switch, cx, useConfirm, useToast } from '../components/ui';
import { CapabilityList } from '../components/CapabilityList';
import { useSettings } from '../lib/settings';
import { useCommand } from '../lib/hooks';
import { call, errorMessage } from '../lib/ipc';
import { playCue, SOUNDS } from '../lib/sound';

type Section = 'general' | 'appearance' | 'focus' | 'blocker' | 'privacy' | 'about';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'focus', label: 'Focus' },
  { id: 'blocker', label: 'Blocker' },
  { id: 'privacy', label: 'Privacy & data' },
  { id: 'about', label: 'About' },
];

const WIDGETS = [
  { id: 'today', label: 'Today summary' },
  { id: 'week', label: 'Week chart' },
  { id: 'streak', label: "Today's intention" },
  { id: 'tasks', label: 'Up next' },
  { id: 'blocks', label: 'Monk Guard' },
];

export default function Settings(_: PageProps) {
  const [section, setSection] = useState<Section>('general');
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[180px_1fr]">
        <nav aria-label="Settings sections" className="space-y-0.5">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" onClick={() => setSection(s.id)} aria-current={section === s.id ? 'page' : undefined} className={cx('block w-full rounded-lg px-3 py-1.5 text-left text-[13px]', section === s.id ? 'bg-surface-3 text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink')}>
              {s.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 space-y-5">
          {section === 'general' && <General />}
          {section === 'appearance' && <Appearance />}
          {section === 'focus' && <FocusSettings />}
          {section === 'blocker' && <BlockerSettings />}
          {section === 'privacy' && <Privacy />}
          {section === 'about' && <About />}
        </div>
      </div>
    </>
  );
}

function useUpdate() {
  const { settings, update } = useSettings();
  const toast = useToast();
  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => update(k, v).catch((e) => toast(errorMessage(e), 'error'));
  return { s: settings, set };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title}>
      <div className="-my-1 divide-y divide-line">{children}</div>
    </Card>
  );
}

function NumberInput({ value, onCommit, min, max, label, suffix }: { value: number; onCommit: (v: number) => void; min: number; max: number; label: string; suffix?: string }) {
  const [v, setV] = useState(String(value));
  const commit = () => {
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n >= min && n <= max) onCommit(n);
    else setV(String(value));
  };
  return (
    <span className="flex items-center gap-2 text-[12px] text-ink-muted">
      <Input aria-label={label} type="number" min={min} max={max} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} className="w-20" />
      {suffix}
    </span>
  );
}

function General() {
  const { s, set } = useUpdate();
  return (
    <>
      <Section title="Startup">
        <SettingRow title="Open at login" description="Starts quietly in the menu bar / system tray so schedules and blocks keep working.">
          <Switch label="Open at login" checked={s.startOnLogin} onChange={(v) => set('startOnLogin', v)} />
        </SettingRow>
        <SettingRow title="Keep running when the window is closed" description="Closing the window hides MONK MODE to the tray instead of quitting.">
          <Switch label="Close to tray" checked={s.closeToTray} onChange={(v) => set('closeToTray', v)} />
        </SettingRow>
      </Section>
      <Section title="Goals">
        <SettingRow title="Daily focus target">
          <NumberInput label="Daily target" value={s.dailyTargetMin} min={0} max={1440} onCommit={(v) => set('dailyTargetMin', v)} suffix="min" />
        </SettingRow>
        <SettingRow title="Weekly focus target">
          <NumberInput label="Weekly target" value={s.weeklyTargetMin} min={0} max={10080} onCommit={(v) => set('weeklyTargetMin', v)} suffix="min" />
        </SettingRow>
      </Section>
      <Section title="Notifications">
        <SettingRow title="System notifications">
          <Switch label="Notifications" checked={s.notificationsEnabled} onChange={(v) => set('notificationsEnabled', v)} />
        </SettingRow>
        <SettingRow title="When a focus session or break ends">
          <Switch label="Phase end notifications" checked={s.notifyOnPhaseEnd} onChange={(v) => set('notifyOnPhaseEnd', v)} />
        </SettingRow>
        <SettingRow title="When an app is closed by Monk Guard">
          <Switch label="Block notifications" checked={s.notifyOnBlock} onChange={(v) => set('notifyOnBlock', v)} />
        </SettingRow>
      </Section>
      <Section title="Language">
        <SettingRow title="Language" description="Interface text is English for now; the app is structured so translations can be added.">
          <Select aria-label="Language" value={s.language} onChange={(e) => set('language', e.target.value)} className="w-40">
            <option value="en">English</option>
          </Select>
        </SettingRow>
      </Section>
    </>
  );
}

function Appearance() {
  const { s, set } = useUpdate();
  return (
    <>
      <Section title="Theme">
        <SettingRow title="Mode">
          <Segmented label="Theme mode" value={s.themeMode} onChange={(v) => set('themeMode', v)} options={[{ value: 'system', label: 'System' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
        </SettingRow>
        <div className="py-4">
          <div className="mb-3 text-[13px] font-medium text-ink">Palette</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {THEMES.map((t) => (
              <button key={t.id} type="button" aria-pressed={s.themeId === t.id} onClick={() => { set('themeId', t.id); if (s.themeMode !== 'system') set('themeMode', t.scheme); }} className={cx('overflow-hidden rounded-xl border text-left transition-colors', s.themeId === t.id ? 'border-accent' : 'border-line hover:border-line-strong')}>
                <div className="flex h-14 items-end gap-1 p-2" style={{ background: t.bg }}>
                  <span className="h-6 flex-1 rounded" style={{ background: t.surface2, border: `1px solid ${t.border}` }} />
                  <span className="h-8 w-3 rounded" style={{ background: t.text, opacity: 0.85 }} />
                </div>
                <div className="px-2.5 py-1.5 text-[12px] text-ink">{t.name}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="py-4">
          <div className="mb-3 text-[13px] font-medium text-ink">Accent</div>
          <div className="flex gap-2.5">
            {ACCENTS.map((a) => (
              <button key={a.id} type="button" title={a.name} aria-label={a.name} aria-pressed={s.accent === a.id} onClick={() => set('accent', a.id)} className={cx('h-7 w-7 rounded-full border-2 transition-transform hover:scale-110', s.accent === a.id ? 'border-ink' : 'border-transparent')} style={{ background: `linear-gradient(135deg, ${a.dark}, ${a.light})` }} />
            ))}
          </div>
        </div>
      </Section>
      <Section title="Typography">
        <SettingRow title="Typeface">
          <Segmented label="Typeface" value={s.fontFamily} onChange={(v) => set('fontFamily', v)} options={[{ value: 'system', label: 'System' }, { value: 'serif', label: 'Serif' }, { value: 'mono', label: 'Mono' }]} />
        </SettingRow>
        <SettingRow title="Text size">
          <Segmented label="Text size" value={String(s.fontScale)} onChange={(v) => set('fontScale', Number(v))} options={[{ value: '0.9', label: 'S' }, { value: '1', label: 'M' }, { value: '1.1', label: 'L' }, { value: '1.2', label: 'XL' }]} />
        </SettingRow>
      </Section>
      <Section title="Overview widgets">
        {WIDGETS.map((w) => (
          <SettingRow key={w.id} title={w.label}>
            <Switch label={w.label} checked={s.dashboardWidgets.includes(w.id)} onChange={(v) => set('dashboardWidgets', v ? [...s.dashboardWidgets, w.id] : s.dashboardWidgets.filter((x) => x !== w.id))} />
          </SettingRow>
        ))}
      </Section>
    </>
  );
}

function FocusSettings() {
  const { s, set } = useUpdate();
  const p = s.pomodoro;
  const setP = (patch: Partial<typeof p>) => set('pomodoro', { ...p, ...patch });
  return (
    <>
      <Section title="Pomodoro">
        <SettingRow title="Focus length"><NumberInput label="Focus minutes" value={p.focusMin} min={1} max={600} onCommit={(v) => setP({ focusMin: v })} suffix="min" /></SettingRow>
        <SettingRow title="Short break"><NumberInput label="Short break minutes" value={p.shortBreakMin} min={1} max={120} onCommit={(v) => setP({ shortBreakMin: v })} suffix="min" /></SettingRow>
        <SettingRow title="Long break"><NumberInput label="Long break minutes" value={p.longBreakMin} min={1} max={180} onCommit={(v) => setP({ longBreakMin: v })} suffix="min" /></SettingRow>
        <SettingRow title="Long break after"><NumberInput label="Rounds before long break" value={p.longBreakEvery} min={1} max={12} onCommit={(v) => setP({ longBreakEvery: v })} suffix="rounds" /></SettingRow>
        <SettingRow title="Start breaks automatically"><Switch label="Auto-start breaks" checked={p.autoStartBreaks} onChange={(v) => setP({ autoStartBreaks: v })} /></SettingRow>
        <SettingRow title="Start the next focus automatically" description="Only when you are at the computer as the break ends — never while you are away."><Switch label="Auto-start focus" checked={p.autoStartFocus} onChange={(v) => setP({ autoStartFocus: v })} /></SettingRow>
      </Section>
      <Section title="Timer">
        <SettingRow title="Default mode">
          <Select aria-label="Default mode" value={s.defaultMode} onChange={(e) => set('defaultMode', e.target.value as FocusMode)} className="w-40">
            {Object.entries(MODE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </SettingRow>
        <SettingRow title="Show seconds for long timers"><Switch label="Show seconds" checked={s.showSecondsInTimer} onChange={(v) => set('showSecondsInTimer', v)} /></SettingRow>
      </Section>
      <Section title="Sound">
        <SettingRow title="Play a sound when a phase ends"><Switch label="Sound" checked={s.soundEnabled} onChange={(v) => set('soundEnabled', v)} /></SettingRow>
        <SettingRow title="Sound">
          <span className="flex gap-2">
            <Select aria-label="Sound" value={s.soundId} onChange={(e) => set('soundId', e.target.value)} className="w-40">
              {SOUNDS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </Select>
            <Button onClick={() => playCue(s.soundId, s.soundVolume)}>Test</Button>
          </span>
        </SettingRow>
        <SettingRow title="Volume">
          <input aria-label="Volume" type="range" min={0} max={1} step={0.05} value={s.soundVolume} onChange={(e) => set('soundVolume', Number(e.target.value))} className="w-40 accent-[var(--accent)]" />
        </SettingRow>
      </Section>
    </>
  );
}

function BlockerSettings() {
  const { s, set } = useUpdate();
  const toast = useToast();
  const confirm = useConfirm();
  const info = useCommand<{ bridgePort: number }>('app_info', { bridgePort: 47613 });
  const [token, setToken] = useState<string | null>(null);
  const current = token ?? s.extensionToken;
  return (
    <>
      <Section title="Browser extension">
        <div className="space-y-3 py-3 text-[12px] leading-relaxed text-ink-muted">
          <p>The MONK MODE extension for Chrome, Edge, Brave and Firefox blocks websites and URL patterns (such as YouTube Shorts) and measures website time. It talks only to this app, on this computer (127.0.0.1:{info.data.bridgePort}).</p>
          <p>Open the extension’s options page and paste this pairing code:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-[12px] text-ink">{current || '…'}</code>
            <Button icon={<Copy className="h-3.5 w-3.5" />} onClick={() => navigator.clipboard.writeText(current).then(() => toast('Copied', 'success')).catch(() => toast('Copy failed', 'error'))}>Copy</Button>
            <Button
              variant="ghost"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={async () => {
                if (await confirm({ title: 'Create a new pairing code?', body: 'Paired browsers stop syncing until you paste the new code.', confirmLabel: 'Regenerate' })) call<string>('extension_token_regenerate').then(setToken).catch((e) => toast(errorMessage(e), 'error'));
              }}
            >
              New code
            </Button>
          </div>
          <p>Installation steps are in docs/BLOCKING_GUIDE.md. Without the app running, the extension keeps enforcing your last synced schedules on its own.</p>
        </div>
      </Section>
      <Section title="Strict mode">
        <SettingRow title="Daily strict-mode limit" description="Protects you from over-committing. 0 means no limit.">
          <NumberInput label="Strict daily limit" value={s.strictDailyLimitMin} min={0} max={1440} onCommit={(v) => set('strictDailyLimitMin', v)} suffix="min" />
        </SettingRow>
        <SettingRow title="Maximum-level exit cool-down" description="How long an emergency exit takes at the Maximum level (60–1800 seconds).">
          <NumberInput label="Cool-down seconds" value={s.emergencyCooldownSec} min={60} max={1800} onCommit={(v) => set('emergencyCooldownSec', v)} suffix="sec" />
        </SettingRow>
      </Section>
      <Section title="Usage tracking">
        <SettingRow title="Measure app usage on this device" description="Records which app is in front while MONK MODE runs (idle time excluded). Needed for screen-time statistics and daily limits. Stays on this device.">
          <Switch label="Usage tracking" checked={s.usageTracking} onChange={(v) => set('usageTracking', v)} />
        </SettingRow>
      </Section>
    </>
  );
}

function Privacy() {
  const toast = useToast();
  const confirm = useConfirm();
  const info = useCommand<{ dataDir: string; schemaVersion: number } | null>('app_info', null);
  const [mode, setMode] = useState<null | 'export' | 'import'>(null);
  const [wipe, setWipe] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      const problems = await call<string[]>('db_integrity');
      toast(problems.length ? `Problems found: ${problems.join('; ')}` : 'Database is healthy', problems.length ? 'error' : 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <Card title="Your data">
        <div className="space-y-3 text-[12px] leading-relaxed text-ink-muted">
          <p>MONK MODE has no accounts, no servers and no analytics. Everything — sessions, tasks, lists, usage — is stored in one SQLite database on this device:</p>
          <code className="block truncate rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-[11px] text-ink">{info.data?.dataDir ?? '…'}</code>
          <p>The app never connects to the internet. The only network listener is a local bridge for the browser extension on 127.0.0.1, which nothing outside this computer can reach.</p>
          <Button size="sm" icon={<Database className="h-3.5 w-3.5" />} loading={checking} onClick={check}>Check database integrity</Button>
        </div>
      </Card>
      <Card title="Backup & transfer">
        <p className="mb-4 text-[12px] leading-relaxed text-ink-muted">Encrypted backups (AES-256-GCM) let you move everything to another Mac, Windows PC or Android phone. The passphrase is never saved: if you lose it, the backup cannot be opened by anyone, including you.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<Download className="h-3.5 w-3.5" />} onClick={() => setMode('export')}>Create encrypted backup</Button>
          <Button icon={<Upload className="h-3.5 w-3.5" />} onClick={() => setMode('import')}>Restore from backup</Button>
        </div>
      </Card>
      <Card title="Delete local data">
        <p className="mb-4 text-[12px] leading-relaxed text-ink-muted">Removes all sessions, tasks, lists, schedules and history from this device. A safety snapshot is kept in the app folder in case you change your mind.</p>
        <Button variant="danger" onClick={() => setWipe(true)}>Delete all data…</Button>
      </Card>
      {mode && <BackupDialog mode={mode} onClose={() => setMode(null)} />}
      <Modal
        open={wipe}
        onClose={() => setWipe(false)}
        title="Delete all local data?"
        footer={
          <>
            <Button onClick={() => setWipe(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={confirmText !== 'DELETE'}
              onClick={async () => {
                if (!(await confirm({ title: 'Last chance', body: 'This cannot be undone from inside the app.', danger: true, confirmLabel: 'Delete everything' }))) return;
                try {
                  await call('data_wipe', { confirm: confirmText });
                  toast('Local data deleted', 'success');
                  setWipe(false);
                } catch (e) {
                  toast(errorMessage(e), 'error');
                }
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <Field label='Type DELETE to confirm'>{(id) => <Input id={id} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />}</Field>
      </Modal>
    </>
  );
}

function BackupDialog({ mode, onClose }: { mode: 'export' | 'import'; onClose: () => void }) {
  const toast = useToast();
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const strength = passphraseStrength(pass);
  const valid = mode === 'import' ? pass.length >= 8 : strength !== 'too-short' && pass === pass2;
  const run = async () => {
    setBusy(true);
    try {
      if (mode === 'export') {
        const path = await call<string | null>('backup_export', { passphrase: pass });
        if (path) toast(`Backup saved to ${path}`, 'success');
      } else {
        const report = await call<{ rows: number; sourcePlatform: string } | null>('backup_import', { passphrase: pass });
        if (report) toast(`Restored ${report.rows} records from ${report.sourcePlatform}`, 'success');
      }
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={mode === 'export' ? 'Create encrypted backup' : 'Restore from backup'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={run}>{mode === 'export' ? 'Choose where to save…' : 'Choose backup file…'}</Button></>}>
      <div className="space-y-3">
        {mode === 'import' && <Notice tone="warning" icon={<KeyRound className="h-4 w-4 text-warning" />}>Restoring replaces all data on this device. A safety snapshot of the current data is saved first.</Notice>}
        <Field label="Passphrase" hint={mode === 'export' ? `Strength: ${strength.replace('-', ' ')}. Use 12+ characters; store it in a password manager.` : undefined}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />}
        </Field>
        {mode === 'export' && <Field label="Repeat passphrase" error={pass2 && pass !== pass2 ? 'Passphrases do not match' : null}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} />}</Field>}
      </div>
    </Modal>
  );
}

function About() {
  const info = useCommand<{ version: string; build: string; platform: string; schemaVersion: number } | null>('app_info', null);
  const platform = info.data?.platform === 'windows' ? 'windows' : 'macos';
  return (
    <>
      <Card title="MONK MODE">
        <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-[13px]">
          <dt className="text-ink-muted">Version</dt><dd className="tabular text-ink">{info.data?.version ?? '…'}</dd>
          <dt className="text-ink-muted">Build</dt><dd className="tabular text-ink">{info.data?.build ?? '…'}</dd>
          <dt className="text-ink-muted">Platform</dt><dd className="text-ink">{info.data?.platform ?? '…'}</dd>
          <dt className="text-ink-muted">Database schema</dt><dd className="tabular text-ink">v{info.data?.schemaVersion ?? '…'}</dd>
          <dt className="text-ink-muted">Licence</dt><dd className="text-ink">MIT. Built with Tauri, React, Rust, SQLite (rusqlite), lucide icons and other open-source libraries under MIT/Apache-2.0/ISC licences.</dd>
          <dt className="text-ink-muted">Documentation</dt><dd className="text-ink">See the docs/ folder: USER_GUIDE.md, BLOCKING_GUIDE.md, STRICT_MODE.md, PRIVACY.md, PLATFORM_LIMITATIONS.md.</dd>
        </dl>
      </Card>
      <Card title="Platform capability report" action={<Badge>{platform}</Badge>}>
        <CapabilityList items={CAPABILITIES[platform]} />
      </Card>
    </>
  );
}
