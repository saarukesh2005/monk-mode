import { useEffect, useState } from 'react';
import { accentById, cssVariables, resolveTheme } from '@monk/design-system';
import type { AppSettings } from '@monk/shared-types';

const FONT_STACKS: Record<AppSettings['fontFamily'], string> = {
  system: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', Inter, system-ui, sans-serif",
  serif: "'New York', 'Iowan Old Style', Charter, Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

function useSystemDark(): boolean {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return dark;
}

export function useApplyTheme(s: AppSettings): void {
  const systemDark = useSystemDark();
  useEffect(() => {
    const theme = resolveTheme(s.themeMode, s.themeId, systemDark);
    const root = document.documentElement;
    for (const [k, v] of Object.entries(cssVariables(theme, accentById(s.accent)))) root.style.setProperty(k, v);
    root.style.setProperty('--font-sans', FONT_STACKS[s.fontFamily] ?? FONT_STACKS.system);
    root.style.setProperty('--font-scale', String(Math.min(1.3, Math.max(0.85, s.fontScale))));
    root.style.colorScheme = theme.scheme;
    root.classList.toggle('dark', theme.scheme === 'dark');
  }, [s.themeMode, s.themeId, s.accent, s.fontFamily, s.fontScale, systemDark]);
}
