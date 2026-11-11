import type { StrictLevel, StrictState } from '@monk/shared-types';
import { MINUTE_MS } from './time';

export const STRICT_MIN_DURATION_MIN = 5;
export const STRICT_MAX_DURATION_MIN = 12 * 60;
export const MAXIMUM_EXIT_PHRASE = 'I choose to end this commitment early';

export interface ExitPolicy {
  minReasonLength: number;
  cooldownMs: number;
  phrase: string | null;
  canPause: boolean;
  canRemoveRules: boolean;
}

/** Every level has an exit; stricter levels only add friction (reason, delay, typed phrase). */
export function exitPolicy(level: StrictLevel, maximumCooldownSec = 300): ExitPolicy {
  switch (level) {
    case 'normal':
      return { minReasonLength: 0, cooldownMs: 0, phrase: null, canPause: true, canRemoveRules: true };
    case 'strict':
      return { minReasonLength: 10, cooldownMs: 30_000, phrase: null, canPause: false, canRemoveRules: false };
    case 'maximum':
      return {
        minReasonLength: 25,
        cooldownMs: Math.max(60, Math.min(1800, maximumCooldownSec)) * 1000,
        phrase: MAXIMUM_EXIT_PHRASE,
        canPause: false,
        canRemoveRules: false,
      };
  }
}

export interface StrictMachine {
  state: StrictState;
  level: StrictLevel;
  startedAt: number | null;
  endsAt: number | null;
  pausedAt: number | null;
  exitRequestedAt: number | null;
  exitReason: string;
}

export type StrictAction =
  | { type: 'PREPARE'; level: StrictLevel }
  | { type: 'CANCEL' }
  | { type: 'COMMIT'; now: number; durationMin: number; confirmed: boolean }
  | { type: 'PAUSE'; now: number }
  | { type: 'RESUME'; now: number }
  | { type: 'TICK'; now: number }
  | { type: 'REQUEST_EXIT'; now: number; reason: string; phrase?: string }
  | { type: 'CONFIRM_EXIT'; now: number }
  | { type: 'ABORT_EXIT' }
  | { type: 'RESET' };

export const STRICT_IDLE: StrictMachine = {
  state: 'IDLE',
  level: 'normal',
  startedAt: null,
  endsAt: null,
  pausedAt: null,
  exitRequestedAt: null,
  exitReason: '',
};

export class StrictTransitionError extends Error {}

const fail = (msg: string): never => {
  throw new StrictTransitionError(msg);
};

/** Pure reducer. Throws StrictTransitionError for disallowed transitions; never mutates input. */
export function strictReduce(m: StrictMachine, a: StrictAction, maximumCooldownSec = 300): StrictMachine {
  const policy = exitPolicy(m.level, maximumCooldownSec);
  switch (a.type) {
    case 'PREPARE':
      if (m.state !== 'IDLE') fail(`Cannot prepare from ${m.state}`);
      return { ...STRICT_IDLE, state: 'PREPARING', level: a.level };
    case 'CANCEL':
      if (m.state !== 'PREPARING') fail('Only a session being prepared can be cancelled');
      return STRICT_IDLE;
    case 'COMMIT': {
      if (m.state !== 'PREPARING') fail('Prepare a session before committing');
      if (!a.confirmed) fail('Commitment must be confirmed');
      if (a.durationMin < STRICT_MIN_DURATION_MIN || a.durationMin > STRICT_MAX_DURATION_MIN) {
        fail(`Duration must be ${STRICT_MIN_DURATION_MIN}–${STRICT_MAX_DURATION_MIN} minutes`);
      }
      return { ...m, state: 'ACTIVE', startedAt: a.now, endsAt: a.now + a.durationMin * MINUTE_MS };
    }
    case 'PAUSE':
      if (m.state !== 'ACTIVE') fail('Only an active session can be paused');
      if (!policy.canPause) fail(`Pausing is not allowed at the ${m.level} level`);
      return { ...m, state: 'PAUSED', pausedAt: a.now };
    case 'RESUME': {
      if (m.state !== 'PAUSED' || m.pausedAt == null || m.endsAt == null) return fail('Session is not paused');
      return { ...m, state: 'ACTIVE', endsAt: m.endsAt + (a.now - m.pausedAt), pausedAt: null };
    }
    case 'TICK':
      if (m.state === 'ACTIVE' && m.endsAt != null && a.now >= m.endsAt) return { ...m, state: 'COMPLETED' };
      if (m.state === 'ACTIVE' && m.exitRequestedAt != null && a.now - m.exitRequestedAt >= policy.cooldownMs && policy.cooldownMs > 0) {
        return { ...m, state: 'EMERGENCY_EXIT' };
      }
      return m;
    case 'REQUEST_EXIT': {
      if (m.state !== 'ACTIVE' && m.state !== 'PAUSED') fail('No active session to exit');
      const reason = a.reason.trim();
      if (reason.length < policy.minReasonLength) fail(`Please describe the reason (at least ${policy.minReasonLength} characters)`);
      if (policy.phrase && (a.phrase ?? '').trim() !== policy.phrase) fail('The confirmation phrase does not match');
      if (policy.cooldownMs === 0) return { ...m, state: 'EMERGENCY_EXIT', exitReason: reason, exitRequestedAt: a.now };
      return { ...m, exitReason: reason, exitRequestedAt: a.now };
    }
    case 'CONFIRM_EXIT':
      if (m.exitRequestedAt == null) fail('No exit has been requested');
      if (a.now - (m.exitRequestedAt ?? 0) < policy.cooldownMs) fail('The cool-down period has not finished yet');
      return { ...m, state: 'EMERGENCY_EXIT' };
    case 'ABORT_EXIT':
      return { ...m, exitRequestedAt: null, exitReason: '' };
    case 'RESET':
      if (m.state !== 'COMPLETED' && m.state !== 'EMERGENCY_EXIT') fail('Session is still running');
      return STRICT_IDLE;
  }
}

export function strictRemainingMs(m: StrictMachine, now: number): number {
  if (m.endsAt == null) return 0;
  const end = m.state === 'PAUSED' && m.pausedAt != null ? m.endsAt + (now - m.pausedAt) : m.endsAt;
  return Math.max(0, end - now);
}
