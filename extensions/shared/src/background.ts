import { bridge, browserName, ext, getLocal, getSettings, setLocal } from './api';
import { buildDnrRules, domainOf, effectiveBlockSet, switchUsage, triggerFor, verdict, type BridgeState, type CachedState, type LocalException, type OpenUsage, type UsageRecord } from './engine';

const SYNC_ALARM = 'monk-sync';
const MAX_QUEUE = 2000;

interface BlockReport {
  ts: number;
  domain: string;
  trigger: string;
}

interface PauseReport {
  ts: number;
  domain: string;
  outcome: 'turned_back' | 'continued';
  intention: string;
}

type Queue = { blocks: BlockReport[]; usage: UsageRecord[]; pauses: PauseReport[] };
const EMPTY_QUEUE: Queue = { blocks: [], usage: [], pauses: [] };

async function currentSet() {
  const cache = await getLocal<CachedState | null>('cache', null);
  const exceptions = await getLocal<LocalException[]>('exceptions', []);
  return effectiveBlockSet(cache, Date.now(), exceptions);
}

async function applyDnr(): Promise<void> {
  if (!ext.declarativeNetRequest) return;
  const rules = buildDnrRules(await currentSet());
  const existing = await ext.declarativeNetRequest.getDynamicRules();
  await ext.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: rules as chrome.declarativeNetRequest.Rule[],
  });
}

async function updateBadge(): Promise<void> {
  const set = await currentSet();
  const cache = await getLocal<CachedState | null>('cache', null);
  const offline = !cache || Date.now() - cache.syncedAt > 90_000;
  await ext.action.setBadgeBackgroundColor({ color: offline ? '#62646C' : '#E3A857' });
  await ext.action.setBadgeText({ text: set?.active ? (set.strict ? '🔒' : 'ON') : '' });
}

async function sync(): Promise<void> {
  const settings = await getSettings();
  if (settings.token) {
    try {
      const state = await bridge<BridgeState>(settings, '/v1/state');
      await setLocal({ cache: { syncedAt: Date.now(), state } satisfies CachedState, lastError: '' });
    } catch (e) {
      await setLocal({ lastError: e instanceof Error ? e.message : 'Desktop app not reachable' });
    }
    await flushQueue();
  }
  await applyDnr();
  await updateBadge();
}

async function enqueue<K extends keyof Queue>(kind: K, item: Queue[K][number]): Promise<void> {
  const q = { ...EMPTY_QUEUE, ...(await getLocal<Partial<Queue>>('queue', {})) };
  const next = { ...q, [kind]: [...q[kind], item].slice(-MAX_QUEUE) };
  await setLocal({ queue: next });
}

async function flushQueue(): Promise<void> {
  const settings = await getSettings();
  const q = { ...EMPTY_QUEUE, ...(await getLocal<Partial<Queue>>('queue', {})) };
  if (!settings.token || (q.blocks.length === 0 && q.usage.length === 0 && q.pauses.length === 0)) return;
  try {
    await bridge(settings, '/v1/events', { method: 'POST', body: JSON.stringify({ browser: browserName(), blocks: q.blocks, usage: q.usage, pauses: q.pauses }) });
    await setLocal({ queue: EMPTY_QUEUE });
  } catch {
    // Kept for the next sync; nothing leaves this computer.
  }
}

async function check(tabId: number, url: string | undefined): Promise<void> {
  if (!url || url.startsWith(ext.runtime.getURL(''))) return;
  const set = await currentSet();
  const v = verdict(url, set);
  if (v.kind === 'allow' || !set) return;
  const domain = domainOf(url) ?? 'unknown';
  const q = (k: string, val: string | number) => `${k}=${encodeURIComponent(String(val))}`;
  if (v.kind === 'pause') {
    // Mindful pause: outcome is recorded by the pause page (turned back / continued).
    const target = ext.runtime.getURL(`pause.html?${[q('u', url), q('s', v.seconds), q('a', v.allowMin)].join('&')}`);
    await ext.tabs.update(tabId, { url: target }).catch(() => undefined);
    return;
  }
  await enqueue('blocks', { ts: Date.now(), domain, trigger: triggerFor(set) });
  const target = ext.runtime.getURL(`blocked.html?${[q('u', url), q('m', v.matched ?? ''), q('s', set.strict ? 1 : 0)].join('&')}`);
  await ext.tabs.update(tabId, { url: target }).catch(() => undefined);
}

// ---------- Usage measurement (active tab in a focused window, not idle) ----------

async function trackActive(): Promise<void> {
  const settings = await getSettings();
  let domain: string | null = null;
  if (settings.trackUsage) {
    const idle = await ext.idle.queryState(120).catch(() => 'active' as const);
    if (idle === 'active') {
      const [tab] = await ext.tabs.query({ active: true, lastFocusedWindow: true });
      const win = tab ? await ext.windows.get(tab.windowId).catch(() => null) : null;
      if (tab && win?.focused) domain = domainOf(tab.url);
    }
  }
  const open = await getLocal<OpenUsage | null>('openUsage', null);
  const r = switchUsage(open, domain, Date.now());
  await setLocal({ openUsage: r.open });
  if (r.record) await enqueue('usage', r.record);
}

// ---------- Wiring ----------

ext.runtime.onInstalled.addListener(async (details) => {
  await ext.alarms.create(SYNC_ALARM, { periodInMinutes: 0.5 });
  if (details.reason === 'install') await ext.runtime.openOptionsPage();
  await sync();
});
ext.runtime.onStartup.addListener(async () => {
  await ext.alarms.create(SYNC_ALARM, { periodInMinutes: 0.5 });
  await sync();
});
ext.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== SYNC_ALARM) return;
  await sync();
  await trackActive();
});

ext.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.frameId === 0) void check(d.tabId, d.url);
});
ext.webNavigation.onHistoryStateUpdated.addListener((d) => {
  if (d.frameId === 0) void check(d.tabId, d.url);
});
ext.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId === 0) void check(d.tabId, d.url);
});

ext.tabs.onActivated.addListener(() => void trackActive());
ext.tabs.onUpdated.addListener((_id, info) => {
  if (info.url || info.status === 'complete') void trackActive();
});
ext.windows.onFocusChanged.addListener(() => void trackActive());
ext.idle.onStateChanged.addListener(() => void trackActive());

type Message =
  | { type: 'status' }
  | { type: 'sync' }
  | { type: 'exception'; domain: string; minutes: number; reason: string }
  | { type: 'pause-outcome'; domain: string; outcome: 'turned_back' | 'continued'; intention: string };

ext.runtime.onMessage.addListener((msg: Message, _sender, reply) => {
  (async () => {
    if (msg.type === 'sync') {
      await sync();
      return { ok: true };
    }
    if (msg.type === 'status') {
      return { set: await currentSet(), cache: await getLocal<CachedState | null>('cache', null), lastError: await getLocal('lastError', ''), settings: await getSettings() };
    }
    if (msg.type === 'pause-outcome') {
      const outcome = msg.outcome === 'continued' ? 'continued' : 'turned_back';
      await enqueue('pauses', { ts: Date.now(), domain: msg.domain, outcome, intention: String(msg.intention ?? '').slice(0, 200) });
      await flushQueue();
      return { ok: true };
    }
    if (msg.type === 'exception') {
      const set = await currentSet();
      if (set?.strict) return { ok: false, error: 'Emergency access is disabled during a strict session.' };
      const minutes = Math.max(1, Math.min(30, Math.round(msg.minutes)));
      const settings = await getSettings();
      try {
        if (settings.token) await bridge(settings, '/v1/exception', { method: 'POST', body: JSON.stringify({ domain: msg.domain, minutes, reason: msg.reason }) });
      } catch (e) {
        const message = e instanceof Error ? e.message : '';
        if (message.includes('strict')) return { ok: false, error: message };
      }
      const list = await getLocal<LocalException[]>('exceptions', []);
      await setLocal({ exceptions: [...list.filter((x) => x.untilAt > Date.now()), { domain: msg.domain, untilAt: Date.now() + minutes * 60_000 }] });
      await sync();
      return { ok: true };
    }
    return { ok: false };
  })()
    .then(reply)
    .catch((e) => reply({ ok: false, error: String(e) }));
  return true;
});
