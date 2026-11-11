// Pure, testable extension logic: state resolution, DNR rule generation, usage intervals.
import type { ActiveBlockSet, Blocklist, BlockRule, BlockTrigger, Schedule } from '@monk/shared-types';
import { evaluateUrl, normalizeDomain, resolveActiveBlockSet, type UrlDecision } from '@monk/shared-core';

export const BRIDGE_TIMEOUT_MS = 2500;
export const STALE_AFTER_MS = 90_000;
export const MAX_LOCAL_EXCEPTION_MIN = 30;

/** Raw rows as served by the desktop bridge (snake_case SQLite rows). */
export interface BridgeConfig {
  lists: Record<string, unknown>[];
  rules: Record<string, unknown>[];
  schedules: Record<string, unknown>[];
}

export interface BridgeState {
  now: number;
  blockSet: ActiveBlockSet;
  focus: { phase: string; status: string; endsAt: number | null } | null;
  strict: { level: string; endsAt: number; listIds: string[] } | null;
  config: BridgeConfig;
}

export interface CachedState {
  syncedAt: number;
  state: BridgeState;
}

export interface LocalException {
  domain: string;
  untilAt: number;
}

const bool = (v: unknown): boolean => v === 1 || v === true;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

export function parseConfig(c: BridgeConfig): { lists: Blocklist[]; rules: BlockRule[]; schedules: Schedule[] } {
  return {
    lists: c.lists.map((l) => ({ id: str(l.id), name: str(l.name), kind: str(l.kind) === 'allow' ? 'allow' : 'block', enabled: bool(l.enabled), blockDuringFocus: bool(l.block_during_focus), createdAt: 0, updatedAt: 0 })),
    rules: c.rules.map((r) => ({ id: str(r.id), listId: str(r.list_id), type: str(r.type) as BlockRule['type'], value: str(r.value), label: str(r.label), platform: (str(r.platform) || 'all') as BlockRule['platform'], createdAt: 0 })),
    schedules: c.schedules.map((s) => ({ id: str(s.id), name: str(s.name), listId: str(s.list_id), daysMask: num(s.days_mask), startMinute: num(s.start_minute), endMinute: num(s.end_minute), strict: bool(s.strict), enabled: bool(s.enabled), createdAt: 0, updatedAt: 0 })),
  };
}

/**
 * The block set to enforce now. Fresh bridge data is used as-is; when the desktop app is
 * unreachable the extension recomputes from the last synced lists and schedules, keeping a
 * focus or strict session alive until its known end time.
 */
export function effectiveBlockSet(cache: CachedState | null, now: number, exceptions: LocalException[]): ActiveBlockSet | null {
  if (!cache) return null;
  const fresh = now - cache.syncedAt < STALE_AFTER_MS;
  const base: ActiveBlockSet = fresh
    ? cache.state.blockSet
    : (() => {
        const cfg = parseConfig(cache.state.config);
        const focusActive = !!cache.state.focus && cache.state.focus.phase === 'focus' && cache.state.focus.status === 'running' && (cache.state.focus.endsAt ?? 0) > now;
        const strictLists = cache.state.strict && cache.state.strict.endsAt > now ? cache.state.strict.listIds : [];
        return resolveActiveBlockSet({ now, platform: 'browser', ...cfg, quickBlocks: [], focusActive, strictListIds: strictLists, exceptions: [], limitExceeded: [] });
      })();
  const live = exceptions.filter((e) => e.untilAt > now).map((e) => e.domain);
  if (live.length === 0 || base.strict) return base;
  return { ...base, allowDomains: [...new Set([...base.allowDomains, ...live])] };
}

export function decide(url: string, set: ActiveBlockSet | null): UrlDecision {
  if (!set || !set.active) return { blocked: false, matched: null, reason: 'not_matched' };
  return evaluateUrl(url, { domains: set.domains, urlPatterns: set.urlPatterns, allowDomains: set.allowDomains });
}

export function triggerFor(set: ActiveBlockSet): BlockTrigger {
  if (set.strict) return 'strict';
  return (set.triggers[0] as BlockTrigger | undefined) ?? 'manual';
}

/** Converts "youtube.com/shorts*" to a declarativeNetRequest urlFilter. */
export function patternToUrlFilter(pattern: string): string {
  const trailingWildcard = pattern.endsWith('*');
  const body = trailingWildcard ? pattern.slice(0, -1) : pattern;
  return `||${body}${trailingWildcard ? '' : '|'}`;
}

export interface DnrRule {
  id: number;
  priority: number;
  action: { type: 'allow' | 'redirect'; redirect?: { extensionPath: string } };
  condition: { requestDomains?: string[]; urlFilter?: string; resourceTypes: ['main_frame'] };
}

/**
 * Network-level backstop rules (main frame only). Navigation listeners handle the rest, including
 * single-page-app route changes such as opening Shorts from the YouTube home page.
 */
export function buildDnrRules(set: ActiveBlockSet | null): DnrRule[] {
  if (!set || !set.active) return [];
  const rules: DnrRule[] = [];
  let id = 1;
  const domains = set.domains.filter((d) => d !== '*');
  if (set.allowDomains.length) rules.push({ id: id++, priority: 3, action: { type: 'allow' }, condition: { requestDomains: set.allowDomains, resourceTypes: ['main_frame'] } });
  if (domains.length) rules.push({ id: id++, priority: 1, action: { type: 'redirect', redirect: { extensionPath: '/blocked.html?src=network' } }, condition: { requestDomains: domains, resourceTypes: ['main_frame'] } });
  for (const p of set.urlPatterns.slice(0, 500)) rules.push({ id: id++, priority: 2, action: { type: 'redirect', redirect: { extensionPath: '/blocked.html?src=network' } }, condition: { urlFilter: patternToUrlFilter(p), resourceTypes: ['main_frame'] } });
  return rules;
}

// ---------- Usage measurement ----------

export interface OpenUsage {
  domain: string;
  startedAt: number;
}

export interface UsageRecord {
  domain: string;
  startedAt: number;
  endedAt: number;
}

export const MIN_USAGE_MS = 1000;
export const MAX_USAGE_MS = 60 * 60 * 1000;

export function domainOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return normalizeDomain(u.hostname);
  } catch {
    return null;
  }
}

/** Closes the open interval (if any) and opens one for `next`. Returns the finished record. */
export function switchUsage(open: OpenUsage | null, next: string | null, now: number): { open: OpenUsage | null; record: UsageRecord | null } {
  let record: UsageRecord | null = null;
  if (open && now - open.startedAt >= MIN_USAGE_MS) {
    record = { domain: open.domain, startedAt: open.startedAt, endedAt: Math.min(now, open.startedAt + MAX_USAGE_MS) };
  }
  if (open && next === open.domain && now - open.startedAt < MAX_USAGE_MS) return { open, record: null };
  return { open: next ? { domain: next, startedAt: now } : null, record };
}
