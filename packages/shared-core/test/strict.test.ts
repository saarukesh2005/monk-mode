import { describe, expect, it } from 'vitest';
import { MAXIMUM_EXIT_PHRASE, STRICT_IDLE, strictReduce, strictRemainingMs, StrictTransitionError, type StrictMachine } from '../src';

const MIN = 60_000;
const commit = (level: StrictMachine['level'], now = 0, durationMin = 60): StrictMachine =>
  strictReduce(strictReduce(STRICT_IDLE, { type: 'PREPARE', level }), { type: 'COMMIT', now, durationMin, confirmed: true });

describe('strict state machine', () => {
  it('walks IDLE → PREPARING → ACTIVE → COMPLETED → IDLE', () => {
    const active = commit('strict');
    expect(active.state).toBe('ACTIVE');
    expect(active.endsAt).toBe(60 * MIN);
    expect(strictReduce(active, { type: 'TICK', now: 30 * MIN }).state).toBe('ACTIVE');
    const done = strictReduce(active, { type: 'TICK', now: 60 * MIN });
    expect(done.state).toBe('COMPLETED');
    expect(strictReduce(done, { type: 'RESET' })).toEqual(STRICT_IDLE);
  });

  it('requires explicit confirmation to commit', () => {
    const prep = strictReduce(STRICT_IDLE, { type: 'PREPARE', level: 'strict' });
    expect(() => strictReduce(prep, { type: 'COMMIT', now: 0, durationMin: 30, confirmed: false })).toThrow(StrictTransitionError);
  });

  it('rejects out-of-range durations', () => {
    const prep = strictReduce(STRICT_IDLE, { type: 'PREPARE', level: 'normal' });
    expect(() => strictReduce(prep, { type: 'COMMIT', now: 0, durationMin: 1, confirmed: true })).toThrow(/Duration/);
    expect(() => strictReduce(prep, { type: 'COMMIT', now: 0, durationMin: 13 * 60, confirmed: true })).toThrow(/Duration/);
  });

  it('normal level can pause and pausing extends the end time', () => {
    const active = commit('normal');
    const paused = strictReduce(active, { type: 'PAUSE', now: 10 * MIN });
    expect(paused.state).toBe('PAUSED');
    expect(strictRemainingMs(paused, 20 * MIN)).toBe(50 * MIN);
    const resumed = strictReduce(paused, { type: 'RESUME', now: 20 * MIN });
    expect(resumed.endsAt).toBe(70 * MIN);
  });

  it('strict and maximum levels cannot pause', () => {
    expect(() => strictReduce(commit('strict'), { type: 'PAUSE', now: 1 })).toThrow(/not allowed/);
    expect(() => strictReduce(commit('maximum'), { type: 'PAUSE', now: 1 })).toThrow(/not allowed/);
  });

  it('normal level exits immediately', () => {
    const exited = strictReduce(commit('normal'), { type: 'REQUEST_EXIT', now: 5, reason: '' });
    expect(exited.state).toBe('EMERGENCY_EXIT');
  });

  it('strict level needs a reason and a 30 s cool-down', () => {
    const active = commit('strict');
    expect(() => strictReduce(active, { type: 'REQUEST_EXIT', now: 0, reason: 'short' })).toThrow(/reason/);
    const req = strictReduce(active, { type: 'REQUEST_EXIT', now: 1000, reason: 'Family emergency at home' });
    expect(req.state).toBe('ACTIVE');
    expect(() => strictReduce(req, { type: 'CONFIRM_EXIT', now: 20_000 })).toThrow(/cool-down/);
    expect(strictReduce(req, { type: 'CONFIRM_EXIT', now: 31_000 }).state).toBe('EMERGENCY_EXIT');
    expect(strictReduce(req, { type: 'TICK', now: 31_000 }).state).toBe('EMERGENCY_EXIT');
  });

  it('maximum level requires the typed phrase', () => {
    const active = commit('maximum');
    const reason = 'I need the laptop for an urgent work incident';
    expect(() => strictReduce(active, { type: 'REQUEST_EXIT', now: 0, reason, phrase: 'nope' })).toThrow(/phrase/);
    const req = strictReduce(active, { type: 'REQUEST_EXIT', now: 0, reason, phrase: MAXIMUM_EXIT_PHRASE });
    expect(req.exitRequestedAt).toBe(0);
    expect(strictReduce(req, { type: 'ABORT_EXIT' }).exitRequestedAt).toBeNull();
  });

  it('cannot reset a running session', () => {
    expect(() => strictReduce(commit('normal'), { type: 'RESET' })).toThrow();
  });

  it('never mutates its input', () => {
    const active = Object.freeze(commit('strict'));
    expect(() => strictReduce(active, { type: 'TICK', now: 99 * MIN })).not.toThrow();
    expect(active.state).toBe('ACTIVE');
  });
});
