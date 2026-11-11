import { useEffect, useState, type ComponentType } from 'react';
import { BarChart3, CalendarClock, CalendarDays, CheckSquare, History as HistoryIcon, LayoutGrid, Settings as SettingsIcon, Shield, Timer } from 'lucide-react';
import { ConfirmProvider, ToastProvider, cx } from './components/ui';
import { SettingsProvider, useSettings } from './lib/settings';
import { useApplyTheme } from './lib/theme';
import { useHotkeys, useTimer } from './lib/hooks';
import { on } from './lib/ipc';
import { playCue } from './lib/sound';
import { formatDuration } from '@monk/shared-core';
import { Logo } from './components/Logo';
import { Onboarding } from './components/Onboarding';
import Overview from './pages/Overview';
import Focus from './pages/Focus';
import Blocker from './pages/Blocker';
import Tasks from './pages/Tasks';
import Planner from './pages/Planner';
import Analytics from './pages/Analytics';
import Schedules from './pages/Schedules';
import History from './pages/History';
import Settings from './pages/Settings';

export type PageId = 'overview' | 'focus' | 'blocker' | 'tasks' | 'planner' | 'analytics' | 'schedules' | 'history' | 'settings';

export interface PageProps {
  navigate: (p: PageId) => void;
}

const NAV: { id: PageId; label: string; icon: ComponentType<{ className?: string }>; Page: ComponentType<PageProps> }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid, Page: Overview },
  { id: 'focus', label: 'Focus', icon: Timer, Page: Focus },
  { id: 'blocker', label: 'Blocker', icon: Shield, Page: Blocker },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare, Page: Tasks },
  { id: 'planner', label: 'Planner', icon: CalendarDays, Page: Planner },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, Page: Analytics },
  { id: 'schedules', label: 'Schedules', icon: CalendarClock, Page: Schedules },
  { id: 'history', label: 'History', icon: HistoryIcon, Page: History },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, Page: Settings },
];

const PAGE_KEY = 'monk.page';

function readPage(): PageId {
  try {
    const v = localStorage.getItem(PAGE_KEY);
    return NAV.some((n) => n.id === v) ? (v as PageId) : 'overview';
  } catch {
    return 'overview';
  }
}

function Shell() {
  const { settings, loaded } = useSettings();
  useApplyTheme(settings);
  const [page, setPage] = useState<PageId>(readPage);
  const timer = useTimer();
  const session = timer.snapshot?.session;

  const navigate = (p: PageId) => {
    setPage(p);
    try {
      localStorage.setItem(PAGE_KEY, p);
    } catch {
      // Preference only.
    }
  };

  useHotkeys(Object.fromEntries(NAV.map((n, i) => [`mod+${i + 1}`, () => navigate(n.id)])));

  useEffect(
    () =>
      on<{ type?: string; session?: { phase: string } } | null>('monk://timer', (ev) => {
        if (ev?.type === 'phaseCompleted' && settings.soundEnabled) playCue(settings.soundId, settings.soundVolume);
      }),
    [settings.soundEnabled, settings.soundId, settings.soundVolume],
  );

  const Active = NAV.find((n) => n.id === page)?.Page ?? Overview;
  const timerLabel = session ? (timer.remaining != null ? formatDuration(timer.remaining, { seconds: true }) : formatDuration(timer.elapsed, { seconds: true })) : null;

  return (
    <div className="flex h-full bg-bg">
      <aside className="flex w-[216px] shrink-0 flex-col border-r border-line bg-surface/60">
        <div className="drag h-10 shrink-0" />
        <div className="flex items-center gap-2.5 px-5 pb-6">
          <Logo className="h-6 w-6 text-accent" />
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-[0.16em] text-ink">MONK MODE</div>
            <div className="text-[10px] tracking-wide text-ink-faint">Discipline is a system.</div>
          </div>
        </div>
        <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {NAV.map((n, i) => (
            <button
              key={n.id}
              type="button"
              onClick={() => navigate(n.id)}
              aria-current={page === n.id ? 'page' : undefined}
              title={`${n.label} (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}${i + 1})`}
              className={cx(
                'group flex w-full items-center gap-3 rounded-lg px-2.5 py-[7px] text-[13px] transition-colors',
                page === n.id ? 'bg-surface-3 text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              <n.icon className={cx('h-[15px] w-[15px]', page === n.id ? 'text-accent' : 'text-ink-faint group-hover:text-ink-muted')} />
              {n.label}
            </button>
          ))}
        </nav>
        {session && (
          <button type="button" onClick={() => navigate('focus')} className="m-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-line-strong">
            <div className="flex items-center justify-between text-[11px] text-ink-faint">
              <span>{session.phase === 'focus' ? 'Focusing' : 'On break'}</span>
              <span className={cx('h-1.5 w-1.5 rounded-full', session.status === 'running' ? 'bg-accent' : 'bg-ink-faint')} />
            </div>
            <div className="tabular mt-0.5 text-[18px] font-semibold text-ink">{timerLabel}</div>
          </button>
        )}
      </aside>
      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="drag h-10 shrink-0" />
        <div className="flex-1 overflow-y-auto px-10 pb-12">
          <div key={page} className="mx-auto max-w-[1080px] animate-fade-in">
            <Active navigate={navigate} />
          </div>
        </div>
      </main>
      {loaded && !settings.onboardingComplete && <Onboarding />}
    </div>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <ConfirmProvider>
          <Shell />
        </ConfirmProvider>
      </ToastProvider>
    </SettingsProvider>
  );
}
