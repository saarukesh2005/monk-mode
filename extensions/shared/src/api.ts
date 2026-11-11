// Minimal promise-based wrapper over chrome.* (Firefox MV3 provides the same API under `chrome`).
export const ext = chrome;

/** Browser family name reported to the desktop app (used for strict-mode extension checks). */
export const browserName = (): string => (navigator.userAgent.includes('Firefox') ? 'Firefox' : navigator.userAgent.includes('Edg/') ? 'Edge' : 'Chromium');

export async function getLocal<T>(key: string, fallback: T): Promise<T> {
  try {
    const r = await ext.storage.local.get(key);
    return (r[key] as T | undefined) ?? fallback;
  } catch {
    return fallback;
  }
}

export async function setLocal(values: Record<string, unknown>): Promise<void> {
  await ext.storage.local.set(values);
}

export interface Settings {
  token: string;
  port: number;
  trackUsage: boolean;
}

export const DEFAULT_SETTINGS: Settings = { token: '', port: 47613, trackUsage: true };

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await getLocal<Partial<Settings>>('settings', {})) };
}

export async function bridge<T>(settings: Settings, path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`http://127.0.0.1:${settings.port}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Monk-Token': settings.token, 'X-Monk-Browser': browserName(), ...(init.headers ?? {}) },
    });
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `Bridge error ${res.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}
