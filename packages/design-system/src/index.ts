// MONK MODE design tokens. Single source for desktop + extension; Android mirrors these
// values in apps/android/app/src/main/java/app/monkmode/ui/theme/Theme.kt.

export interface ThemeTokens {
  id: string;
  name: string;
  scheme: 'dark' | 'light';
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  border: string;
  borderStrong: string;
  text: string;
  muted: string;
  faint: string;
  danger: string;
  success: string;
  warning: string;
}

export const THEMES: ThemeTokens[] = [
  { id: 'graphite', name: 'Graphite', scheme: 'dark', bg: '#0E0F11', surface: '#151619', surface2: '#1B1C20', surface3: '#232429', border: 'rgba(255,255,255,0.06)', borderStrong: 'rgba(255,255,255,0.12)', text: '#ECECEE', muted: '#9A9CA3', faint: '#62646C', danger: '#E5484D', success: '#46A758', warning: '#E2A336' },
  { id: 'obsidian', name: 'Obsidian', scheme: 'dark', bg: '#000000', surface: '#0A0A0B', surface2: '#111113', surface3: '#18181B', border: 'rgba(255,255,255,0.07)', borderStrong: 'rgba(255,255,255,0.14)', text: '#F2F2F3', muted: '#9C9DA3', faint: '#5E5F66', danger: '#E5484D', success: '#46A758', warning: '#E2A336' },
  { id: 'midnight', name: 'Midnight', scheme: 'dark', bg: '#0B0E14', surface: '#11151D', surface2: '#161B25', surface3: '#1D2330', border: 'rgba(160,180,220,0.08)', borderStrong: 'rgba(160,180,220,0.16)', text: '#E6EAF2', muted: '#8E98AD', faint: '#5A6377', danger: '#E5484D', success: '#46A758', warning: '#E2A336' },
  { id: 'paper', name: 'Paper', scheme: 'light', bg: '#F6F5F2', surface: '#FFFFFF', surface2: '#F0EFEB', surface3: '#E7E5E0', border: 'rgba(20,20,20,0.08)', borderStrong: 'rgba(20,20,20,0.16)', text: '#1A1B1E', muted: '#62646B', faint: '#9C9EA4', danger: '#CE2C31', success: '#2A7E3B', warning: '#A35C00' },
  { id: 'sandstone', name: 'Sandstone', scheme: 'light', bg: '#F2EDE4', surface: '#FBF8F3', surface2: '#EBE4D8', surface3: '#E1D8C9', border: 'rgba(60,40,20,0.10)', borderStrong: 'rgba(60,40,20,0.18)', text: '#2A241C', muted: '#6E6457', faint: '#A39886', danger: '#C2362F', success: '#3F7A3A', warning: '#9A5B0B' },
];

export interface Accent {
  id: string;
  name: string;
  dark: string;
  light: string;
}

export const ACCENTS: Accent[] = [
  { id: 'saffron', name: 'Saffron', dark: '#E3A857', light: '#B06E12' },
  { id: 'sage', name: 'Sage', dark: '#8DBF98', light: '#3F7A4C' },
  { id: 'ice', name: 'Ice', dark: '#86B7E0', light: '#2F6EA3' },
  { id: 'iris', name: 'Iris', dark: '#A595F5', light: '#5B47C9' },
  { id: 'rose', name: 'Rose', dark: '#E895AA', light: '#B23A5B' },
  { id: 'mono', name: 'Mono', dark: '#E8E8EA', light: '#1A1B1E' },
];

export const DEFAULT_DARK_THEME = 'graphite';
export const DEFAULT_LIGHT_THEME = 'paper';
export const DEFAULT_ACCENT = 'saffron';

export function themeById(id: string): ThemeTokens {
  return THEMES.find((t) => t.id === id) ?? (THEMES[0] as ThemeTokens);
}

export function accentById(id: string): Accent {
  return ACCENTS.find((a) => a.id === id) ?? (ACCENTS[0] as Accent);
}

/** Resolves the theme to use given the user's mode preference and the OS preference. */
export function resolveTheme(mode: 'dark' | 'light' | 'system', themeId: string, systemDark: boolean): ThemeTokens {
  const chosen = themeById(themeId);
  const wantDark = mode === 'system' ? systemDark : mode === 'dark';
  if ((chosen.scheme === 'dark') === wantDark) return chosen;
  return themeById(wantDark ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME);
}

/** CSS custom properties for a theme + accent; applied on :root by the apps. */
export function cssVariables(theme: ThemeTokens, accent: Accent): Record<string, string> {
  const a = theme.scheme === 'dark' ? accent.dark : accent.light;
  return {
    '--bg': theme.bg,
    '--surface': theme.surface,
    '--surface-2': theme.surface2,
    '--surface-3': theme.surface3,
    '--border': theme.border,
    '--border-strong': theme.borderStrong,
    '--text': theme.text,
    '--muted': theme.muted,
    '--faint': theme.faint,
    '--danger': theme.danger,
    '--success': theme.success,
    '--warning': theme.warning,
    '--accent': a,
    '--accent-soft': `color-mix(in srgb, ${a} 14%, transparent)`,
    '--accent-contrast': theme.scheme === 'dark' ? '#111111' : '#FFFFFF',
  };
}

/** Relative luminance contrast ratio (WCAG 2.x) for #RRGGBB colors. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string): number => {
    const n = hex.replace('#', '');
    const [r, g, bl] = [0, 2, 4].map((i) => {
      const c = parseInt(n.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
