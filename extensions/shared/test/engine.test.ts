import { describe, expect, it } from 'vitest';
import type { ActiveBlockSet } from '@monk/shared-types';
import { buildDnrRules, decide, domainOf, effectiveBlockSet, patternToUrlFilter, switchUsage, STALE_AFTER_MS, type CachedState } from '../src/engine';

const set = (over: Partial<ActiveBlockSet> = {}): ActiveBlockSet => ({ computedAt: 0, active: true, strict: false, triggers: ['focus'], apps: [], domains: ['reddit.com'], urlPatterns: ['youtube.com/shorts*', 'reddit.com/'], allowDomains: [], allowApps: [], sourceList: {}, ...over });

const monday10 = new Date(2026, 10, 9, 10, 0).getTime();
const cache = (syncedAt: number, over: Partial<CachedState['state']> = {}): CachedState => ({
  syncedAt,
  state: {
    now: syncedAt,
    blockSet: set(),
    focus: null,
    strict: null,
    config: {
      lists: [{ id: 'w', name: 'Work', kind: 'block', enabled: 1, block_during_focus: 1 }],
      rules: [{ id: 'r', list_id: 'w', type: 'domain', value: 'x.com', platform: 'all' }],
      schedules: [{ id: 's', name: 'Hours', list_id: 'w', days_mask: 31, start_minute: 540, end_minute: 1020, strict: 0, enabled: 1 }],
    },
    ...over,
  },
});

describe('extension engine', () => {
  it('converts URL patterns to DNR filters', () => {
    expect(patternToUrlFilter('youtube.com/shorts*')).toBe('||youtube.com/shorts');
    expect(patternToUrlFilter('reddit.com/')).toBe('||reddit.com/|');
  });

  it('builds allow rules with higher priority than redirects', () => {
    const rules = buildDnrRules(set({ allowDomains: ['old.reddit.com'] }));
    expect(rules[0]).toMatchObject({ priority: 3, action: { type: 'allow' } });
    expect(rules.filter((r) => r.action.type === 'redirect')).toHaveLength(3);
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
    expect(buildDnrRules(set({ active: false }))).toEqual([]);
  });

  it('decides with the shared matcher, including SPA routes', () => {
    expect(decide('https://www.youtube.com/shorts/abc', set()).blocked).toBe(true);
    expect(decide('https://www.youtube.com/watch?v=1', set()).blocked).toBe(false);
    expect(decide('https://www.reddit.com/', set()).blocked).toBe(true);
    expect(decide('https://www.reddit.com/', null).blocked).toBe(false);
  });

  it('uses fresh bridge state as-is', () => {
    expect(effectiveBlockSet(cache(monday10), monday10 + 1000, [])?.domains).toEqual(['reddit.com']);
  });

  it('falls back to locally evaluated schedules when the app is offline', () => {
    const offline = effectiveBlockSet(cache(monday10 - STALE_AFTER_MS * 2), monday10, []);
    expect(offline?.domains).toEqual(['x.com']);
    expect(offline?.triggers).toEqual(['schedule']);
    const evening = new Date(2026, 10, 9, 20, 0).getTime();
    expect(effectiveBlockSet(cache(evening - STALE_AFTER_MS * 2), evening, [])?.active).toBe(false);
  });

  it('keeps a strict session enforced offline until its end time', () => {
    const evening = new Date(2026, 10, 9, 20, 0).getTime();
    const c = cache(evening - STALE_AFTER_MS * 2, { strict: { level: 'strict', endsAt: evening + 60_000, listIds: ['w'] } });
    const s = effectiveBlockSet(c, evening, [{ domain: 'x.com', untilAt: evening + 60_000 }]);
    expect(s?.strict).toBe(true);
    expect(s?.allowDomains).toEqual([]);
  });

  it('applies local exceptions outside strict mode', () => {
    const s = effectiveBlockSet(cache(monday10), monday10, [{ domain: 'reddit.com', untilAt: monday10 + 60_000 }, { domain: 'old.com', untilAt: monday10 - 1 }]);
    expect(s?.allowDomains).toEqual(['reddit.com']);
    expect(decide('https://reddit.com/r/x', s).blocked).toBe(false);
  });

  it('measures active-tab intervals', () => {
    expect(domainOf('https://www.github.com/x')).toBe('github.com');
    expect(domainOf('chrome://newtab')).toBeNull();
    let r = switchUsage(null, 'a.com', 0);
    expect(r.record).toBeNull();
    r = switchUsage(r.open, 'a.com', 5000);
    expect(r.record).toBeNull();
    r = switchUsage(r.open, 'b.com', 9000);
    expect(r.record).toEqual({ domain: 'a.com', startedAt: 0, endedAt: 9000 });
    r = switchUsage(r.open, null, 9500);
    expect(r.record).toBeNull();
    expect(r.open).toBeNull();
  });
});
