import { describe, expect, it } from 'vitest';
import schedules from '../vectors/schedules.json';
import urls from '../vectors/urls.json';
import focus from '../vectors/focus.json';
import strict from '../vectors/strict.json';
import { breakAfter, DEFAULT_POMODORO, dueAt, elapsedMs, evaluateUrl, exitPolicy, isWindowActive, MAXIMUM_EXIT_PHRASE, normalizeDomain, remainingMs } from '../src';
import type { StrictLevel } from '@monk/shared-types';

describe('schedule vectors', () => {
  for (const c of schedules.cases) {
    it(c.name, () => {
      expect(isWindowActive(c, new Date(c.at))).toBe(c.expected);
    });
  }
});

describe('url vectors', () => {
  for (const c of urls.cases) {
    it(`${c.url} → ${c.reason}`, () => {
      const d = evaluateUrl(c.url, urls.rules);
      expect(d.blocked).toBe(c.blocked);
      expect(d.reason).toBe(c.reason);
    });
  }
  for (const n of urls.normalize) {
    it(`normalizes ${JSON.stringify(n.input)}`, () => {
      expect(normalizeDomain(n.input)).toBe(n.expected);
    });
  }
});

describe('focus timing vectors', () => {
  for (const c of focus.cases) {
    it(c.name, () => {
      const s = { ...c, endedAt: null, status: c.pausedAt == null ? ('running' as const) : ('paused' as const) };
      expect(elapsedMs(s, c.now)).toBe(c.elapsed);
      expect(remainingMs(s, c.now)).toBe(c.remaining);
      expect(dueAt(s)).toBe(c.due);
    });
  }
  for (const b of focus.breaks) {
    it(`break after ${b.completed} of every ${b.every}`, () => {
      expect(breakAfter(b.completed, { ...DEFAULT_POMODORO, longBreakEvery: b.every }).phase).toBe(b.phase);
    });
  }
});

describe('strict policy vectors', () => {
  it('phrase matches', () => expect(MAXIMUM_EXIT_PHRASE).toBe(strict.phrase));
  for (const p of strict.policies) {
    it(p.level, () => {
      const pol = exitPolicy(p.level as StrictLevel);
      expect(pol.minReasonLength).toBe(p.minReasonLength);
      expect(pol.cooldownMs).toBe(p.cooldownMs);
      expect(pol.phrase !== null).toBe(p.requiresPhrase);
      expect(pol.canPause).toBe(p.canPause);
      expect(pol.canRemoveRules).toBe(p.canRemoveRules);
    });
  }
});
