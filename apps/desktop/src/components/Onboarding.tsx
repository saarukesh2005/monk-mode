import { useState } from 'react';
import { BellRing, Shield, Sparkles, Timer } from 'lucide-react';
import { Button, Switch, cx, useToast } from './ui';
import { Logo } from './Logo';
import { useSettings } from '../lib/settings';
import { errorMessage } from '../lib/ipc';

const STEPS = ['welcome', 'how', 'permissions'] as const;

/** First-run introduction. Explains, in plain language, what the app does and what it needs. */
export function Onboarding() {
  const { settings, update } = useSettings();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const finish = () => update('onboardingComplete', true).catch((e) => toast(errorMessage(e), 'error'));
  const isMac = navigator.platform.includes('Mac');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/95 p-6 backdrop-blur" role="dialog" aria-modal="true" aria-label="Welcome to MONK MODE">
      <div className="w-full max-w-lg animate-fade-in">
        {STEPS[step] === 'welcome' && (
          <div className="text-center">
            <Logo className="mx-auto h-16 w-16 text-accent" />
            <h1 className="mt-6 text-[30px] font-semibold tracking-[0.12em] text-ink">MONK MODE</h1>
            <p className="mt-2 text-[14px] text-ink-muted">Discipline is a system.</p>
            <p className="mx-auto mt-6 max-w-sm text-[13px] leading-relaxed text-ink-muted">A focus timer, distraction blocker and planner that lives entirely on this device. No account. No cloud. No tracking.</p>
          </div>
        )}
        {STEPS[step] === 'how' && (
          <div className="space-y-4">
            <h2 className="text-[20px] font-semibold text-ink">How it works</h2>
            {[
              { icon: Timer, title: 'Focus', body: 'Start a session. The timer is saved continuously, so it stays correct through restarts and sleep.' },
              { icon: Shield, title: 'Monk Guard', body: 'Blocklists switch on during focus, on schedules or on demand. Blocked apps are closed; the browser extension blocks websites.' },
              { icon: Sparkles, title: 'Strict mode', body: 'Commit to a block for a fixed time. There is always an emergency exit — stricter levels just make you pause and think.' },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-3 rounded-xl border border-line bg-surface p-4">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <div>
                  <div className="text-[13px] font-medium text-ink">{title}</div>
                  <div className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">{body}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        {STEPS[step] === 'permissions' && (
          <div className="space-y-4">
            <h2 className="text-[20px] font-semibold text-ink">What MONK MODE needs</h2>
            <div className="space-y-3 rounded-xl border border-line bg-surface p-4 text-[12px] leading-relaxed text-ink-muted">
              <p><span className="font-medium text-ink">Notifications</span> — to tell you when a session ends or an app is blocked. {isMac ? 'macOS will ask the first time.' : 'Windows shows them in the Action Center.'}</p>
              <p><span className="font-medium text-ink">Closing apps</span> — Monk Guard asks blocked apps you own to quit. No special permission is needed and it never touches system processes.</p>
              <p><span className="font-medium text-ink">Hosts file (optional, off)</span> — system-wide website blocking needs your administrator password each time. You can enable it later in Blocker.</p>
              <p><span className="font-medium text-ink">Usage measurement</span> — which app is in front while MONK MODE runs, for your own statistics. Stored only here.</p>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line bg-surface p-4">
              <div className="flex items-center gap-2 text-[13px] text-ink"><BellRing className="h-4 w-4 text-accent" /> Measure app usage</div>
              <Switch label="Measure app usage" checked={settings.usageTracking} onChange={(v) => update('usageTracking', v).catch(() => undefined)} />
            </div>
          </div>
        )}
        <div className="mt-8 flex items-center justify-between">
          <div className="flex gap-1.5">
            {STEPS.map((s, i) => (
              <span key={s} className={cx('h-1.5 rounded-full transition-all', i === step ? 'w-5 bg-accent' : 'w-1.5 bg-surface-3')} />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}>Back</Button>}
            {step < STEPS.length - 1 ? <Button variant="primary" onClick={() => setStep(step + 1)}>Continue</Button> : <Button variant="primary" onClick={finish}>Begin</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}
