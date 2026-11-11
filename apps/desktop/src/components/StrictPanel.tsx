import { useState } from 'react';
import { Lock, LockOpen, ShieldAlert } from 'lucide-react';
import type { Blocklist, StrictLevel } from '@monk/shared-types';
import { MAXIMUM_EXIT_PHRASE, formatDuration } from '@monk/shared-core';
import { Badge, Button, Card, Checkbox, Field, Input, Modal, Notice, Segmented, Textarea, cx, useToast } from './ui';
import { call, errorMessage } from '../lib/ipc';
import { useCommand, useNow } from '../lib/hooks';

interface StrictStatus {
  session: { id: string; level: StrictLevel; state: string; endsAt: number; listIds: string[]; exitRequestedAt: number | null } | null;
  policy: { minReasonLength: number; cooldownMs: number; phrase: string | null; canPause: boolean } | null;
  remainingMs: number;
  exitAvailableAt: number | null;
  usedTodayMin: number;
  dailyLimitMin: number;
}

const LEVELS: { value: StrictLevel; label: string; body: string }[] = [
  { value: 'normal', label: 'Normal', body: 'Blocks apply. You can pause, edit lists and leave instantly.' },
  { value: 'strict', label: 'Strict', body: 'No pausing, no removing rules, no exceptions. Leaving early needs a reason and a 30-second wait.' },
  { value: 'maximum', label: 'Maximum', body: 'Everything in Strict, plus a longer cool-down and a typed commitment phrase. Hosts-file blocking applies if enabled.' },
];

export function StrictPanel({ lists }: { lists: Blocklist[] }) {
  const toast = useToast();
  const status = useCommand<StrictStatus | null>('strict_status', null, ['monk://strict', 'monk://data']);
  const now = useNow(1000);
  const [prep, setPrep] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const s = status.data?.session;

  if (s) {
    const remaining = Math.max(0, s.endsAt - now);
    const exitAt = status.data?.exitAvailableAt;
    return (
      <Card title="Strict session" action={<Badge tone="accent">{s.level}</Badge>}>
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <div className="tabular text-[24px] font-semibold text-ink">{formatDuration(s.state === 'PAUSED' ? status.data?.remainingMs ?? 0 : remaining, { seconds: true })}</div>
            <div className="text-[12px] text-ink-muted">
              {s.state === 'PAUSED' ? 'Paused' : `Ends at ${new Date(s.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`} · {lists.filter((l) => s.listIds.includes(l.id)).map((l) => l.name).join(', ')}
            </div>
          </div>
        </div>
        {exitAt && (
          <Notice tone="warning" icon={<ShieldAlert className="h-4 w-4 text-warning" />}>
            Emergency exit requested. {exitAt > now ? `Restrictions lift in ${formatDuration(exitAt - now, { seconds: true })} unless you change your mind.` : 'Finishing…'}
          </Notice>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {status.data?.policy?.canPause && s.state === 'ACTIVE' && <Button size="sm" onClick={() => call('strict_pause').then(status.reload).catch((e) => toast(errorMessage(e), 'error'))}>Pause</Button>}
          {s.state === 'PAUSED' && <Button size="sm" variant="primary" onClick={() => call('strict_resume').then(status.reload).catch((e) => toast(errorMessage(e), 'error'))}>Resume</Button>}
          {exitAt ? (
            <Button size="sm" variant="primary" onClick={() => call('strict_abort_exit').then(status.reload).catch((e) => toast(errorMessage(e), 'error'))}>Stay committed</Button>
          ) : (
            <Button size="sm" variant="ghost" icon={<LockOpen className="h-3.5 w-3.5" />} onClick={() => setExitOpen(true)}>
              Emergency exit
            </Button>
          )}
        </div>
        <ExitDialog open={exitOpen} onClose={() => setExitOpen(false)} level={s.level} policy={status.data?.policy ?? null} onDone={status.reload} />
      </Card>
    );
  }

  return (
    <Card title="Strict mode">
      <p className="text-[13px] leading-relaxed text-ink-muted">Commit to a block for a fixed time. You can always leave in an emergency — stricter levels just add deliberate friction.</p>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-[12px] text-ink-faint">
          Used today: {status.data?.usedTodayMin ?? 0} of {status.data?.dailyLimitMin || '∞'} min
        </span>
        <Button variant="primary" size="sm" icon={<Lock className="h-3.5 w-3.5" />} onClick={() => setPrep(true)} disabled={lists.filter((l) => l.kind === 'block').length === 0}>
          Start commitment
        </Button>
      </div>
      <PrepareDialog open={prep} onClose={() => setPrep(false)} lists={lists.filter((l) => l.kind === 'block')} onDone={status.reload} />
    </Card>
  );
}

function PrepareDialog({ open, onClose, lists, onDone }: { open: boolean; onClose: () => void; lists: Blocklist[]; onDone: () => void }) {
  const toast = useToast();
  const [level, setLevel] = useState<StrictLevel>('strict');
  const [minutes, setMinutes] = useState(60);
  const [selected, setSelected] = useState<string[]>(() => lists.slice(0, 1).map((l) => l.id));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      await call('strict_start', { req: { level, durationMin: minutes, listIds: selected, confirmed } });
      toast('Commitment started. You have got this.', 'success');
      onDone();
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Prepare a commitment"
      width="max-w-lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={start} loading={busy} disabled={!confirmed || selected.length === 0}>
            Commit for {formatDuration(minutes * 60_000)}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-2">
          {LEVELS.map((l) => (
            <button key={l.value} type="button" onClick={() => setLevel(l.value)} className={cx('w-full rounded-xl border p-3 text-left transition-colors', level === l.value ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong')}>
              <div className="text-[13px] font-medium text-ink">{l.label}</div>
              <div className="mt-0.5 text-[12px] text-ink-muted">{l.body}</div>
            </button>
          ))}
        </div>
        <Field label="Duration">
          {(id) => (
            <div className="flex items-center gap-2">
              <Segmented label="Duration presets" size="sm" value={String(minutes)} onChange={(v) => setMinutes(Number(v))} options={[30, 60, 90, 120, 240].map((m) => ({ value: String(m), label: formatDuration(m * 60_000) }))} />
              <Input id={id} type="number" min={5} max={720} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="w-24" />
            </div>
          )}
        </Field>
        <div>
          <div className="mb-2 text-[12px] font-medium text-ink-muted">Lists to enforce</div>
          <div className="space-y-1.5">
            {lists.map((l) => (
              <label key={l.id} className="flex items-center gap-2.5 text-[13px] text-ink">
                <Checkbox label={l.name} checked={selected.includes(l.id)} onChange={(v) => setSelected((s) => (v ? [...s, l.id] : s.filter((x) => x !== l.id)))} />
                {l.name}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-start gap-2.5 rounded-xl border border-line p-3 text-[12px] leading-relaxed text-ink-muted">
          <Checkbox label="I commit" checked={confirmed} onChange={setConfirmed} className="mt-0.5" />
          I am choosing to commit. I understand MONK MODE is a commitment device, not an unbreakable lock: closing the app or restarting the computer stops enforcement, and attempts are recorded in my history.
        </label>
      </div>
    </Modal>
  );
}

function ExitDialog({ open, onClose, level, policy, onDone }: { open: boolean; onClose: () => void; level: StrictLevel; policy: StrictStatus['policy']; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [phrase, setPhrase] = useState('');
  const min = policy?.minReasonLength ?? 0;
  const submit = async () => {
    try {
      const ended = await call<boolean>('strict_request_exit', { reason, phrase: phrase || null });
      toast(ended ? 'Strict session ended.' : `Exit will complete in ${formatDuration(policy?.cooldownMs ?? 0)}. You can still change your mind.`);
      onDone();
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Emergency exit"
      footer={
        <>
          <Button variant="primary" onClick={onClose}>
            Keep going
          </Button>
          <Button variant="danger" onClick={submit} disabled={reason.trim().length < min || (!!policy?.phrase && phrase.trim() !== policy.phrase)}>
            Request exit
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-[13px] text-ink-muted">
        <p>{level === 'normal' ? 'The session ends immediately.' : `Your exit will be recorded and completes after a ${formatDuration(policy?.cooldownMs ?? 0, { seconds: (policy?.cooldownMs ?? 0) < 60_000 })} cool-down.`}</p>
        <Field label={min ? `Why do you need to stop? (at least ${min} characters)` : 'Reason (optional)'}>{(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        {policy?.phrase && (
          <Field label="Type the commitment phrase" hint={`“${MAXIMUM_EXIT_PHRASE}”`}>
            {(id) => <Input id={id} value={phrase} onChange={(e) => setPhrase(e.target.value)} onPaste={(e) => e.preventDefault()} autoComplete="off" />}
          </Field>
        )}
      </div>
    </Modal>
  );
}
