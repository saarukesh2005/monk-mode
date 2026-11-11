import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppSettings } from '@monk/shared-types';
import { DEFAULT_POMODORO } from '@monk/shared-core';
import { call, on } from './ipc';

export const DEFAULT_SETTINGS: AppSettings = {
  themeMode: 'system',
  themeId: 'graphite',
  accent: 'saffron',
  fontScale: 1,
  fontFamily: 'system',
  language: 'en',
  pomodoro: DEFAULT_POMODORO,
  defaultMode: 'pomodoro',
  dailyTargetMin: 120,
  weeklyTargetMin: 600,
  notificationsEnabled: true,
  notifyOnPhaseEnd: true,
  notifyOnBlock: true,
  soundEnabled: true,
  soundId: 'bowl',
  soundVolume: 0.6,
  startOnLogin: false,
  startMinimized: false,
  closeToTray: true,
  dashboardWidgets: ['today', 'timer', 'streak', 'week', 'tasks', 'blocks'],
  showSecondsInTimer: true,
  usageTracking: true,
  hostsBlockingEnabled: false,
  strictDailyLimitMin: 480,
  emergencyCooldownSec: 300,
  extensionToken: '',
  onboardingComplete: false,
};

interface SettingsCtx {
  settings: AppSettings;
  loaded: boolean;
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
}

const Ctx = createContext<SettingsCtx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const stored = await call<Partial<AppSettings>>('settings_all');
    setSettings({ ...DEFAULT_SETTINGS, ...stored, pomodoro: { ...DEFAULT_POMODORO, ...(stored.pomodoro ?? {}) } });
    setLoaded(true);
  }, []);

  useEffect(() => {
    load().catch(() => setLoaded(true));
    return on<string>('monk://data', (what) => {
      if (what === 'settings' || what === '*') load().catch(() => undefined);
    });
  }, [load]);

  const update = useCallback(async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    await call('settings_set', { key, value });
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  const value = useMemo(() => ({ settings, loaded, update }), [settings, loaded, update]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSettings outside SettingsProvider');
  return ctx;
}
