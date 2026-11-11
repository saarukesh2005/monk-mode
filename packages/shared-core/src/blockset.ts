import type {
  ActiveBlockSet,
  Blocklist,
  BlockRule,
  BlockTrigger,
  QuickBlock,
  RulePlatform,
  Schedule,
  TemporaryException,
} from '@monk/shared-types';
import { presetById } from './presets';
import { isScheduleActive } from './schedule';

export interface BlockInputs {
  now: number;
  platform: Exclude<RulePlatform, 'all'> | 'browser';
  lists: Blocklist[];
  rules: BlockRule[];
  schedules: Schedule[];
  quickBlocks: QuickBlock[];
  focusActive: boolean;
  strictListIds: string[];
  exceptions: TemporaryException[];
  /** Targets whose daily usage limit is exhausted today. */
  limitExceeded: { type: 'app' | 'domain'; value: string }[];
}

const appliesTo = (rule: BlockRule, platform: BlockInputs['platform']): boolean =>
  rule.platform === 'all' || platform === 'browser' || rule.platform === platform;

/**
 * Resolves which apps/domains must be blocked right now.
 * Precedence: allowlists and temporary exceptions remove targets, except that exceptions
 * never apply to lists enforced by an active strict session.
 */
export function resolveActiveBlockSet(input: BlockInputs): ActiveBlockSet {
  const at = new Date(input.now);
  const triggersByList = new Map<string, Set<BlockTrigger>>();
  const add = (listId: string, t: BlockTrigger): void => {
    const set = triggersByList.get(listId) ?? new Set<BlockTrigger>();
    set.add(t);
    triggersByList.set(listId, set);
  };
  const enabledBlockLists = input.lists.filter((l) => l.enabled && l.kind === 'block');
  const enabledIds = new Set(enabledBlockLists.map((l) => l.id));

  for (const l of enabledBlockLists) if (input.focusActive && l.blockDuringFocus) add(l.id, 'focus');
  for (const s of input.schedules) if (enabledIds.has(s.listId) && isScheduleActive(s, at)) add(s.listId, s.strict ? 'strict' : 'schedule');
  for (const q of input.quickBlocks) if (q.endedAt == null && q.startedAt <= input.now && input.now < q.endsAt && enabledIds.has(q.listId)) add(q.listId, 'manual');
  for (const id of input.strictListIds) if (input.lists.some((l) => l.id === id)) add(id, 'strict');

  const apps = new Set<string>();
  const domains = new Set<string>();
  const patterns = new Set<string>();
  const sourceList: Record<string, string> = {};
  const strictTargets = new Set<string>();

  for (const [listId, triggers] of triggersByList) {
    const isStrict = triggers.has('strict');
    for (const rule of input.rules) {
      if (rule.listId !== listId || !appliesTo(rule, input.platform)) continue;
      const push = (set: Set<string>, value: string): void => {
        set.add(value);
        sourceList[value] ??= listId;
        if (isStrict) strictTargets.add(value);
      };
      if (rule.type === 'app') push(apps, rule.value);
      else if (rule.type === 'domain') push(domains, rule.value);
      else if (rule.type === 'url_pattern') push(patterns, rule.value);
      else if (rule.type === 'category') {
        const preset = presetById(rule.value);
        preset?.domains.forEach((d) => push(domains, d));
        preset?.urlPatterns.forEach((p) => push(patterns, p));
      }
    }
  }

  for (const lim of input.limitExceeded) {
    (lim.type === 'app' ? apps : domains).add(lim.value);
  }

  const allowDomains = new Set<string>();
  const allowApps = new Set<string>();
  for (const l of input.lists.filter((x) => x.enabled && x.kind === 'allow')) {
    for (const r of input.rules) {
      if (r.listId !== l.id || !appliesTo(r, input.platform)) continue;
      if (r.type === 'domain') allowDomains.add(r.value);
      if (r.type === 'app') allowApps.add(r.value);
    }
  }
  for (const e of input.exceptions) {
    if (e.untilAt <= input.now || strictTargets.has(e.value)) continue;
    (e.type === 'app' ? allowApps : allowDomains).add(e.value);
  }
  for (const a of allowApps) apps.delete(a);

  const triggers = new Set<BlockTrigger>();
  triggersByList.forEach((t) => t.forEach((x) => triggers.add(x)));
  if (input.limitExceeded.length > 0) triggers.add('limit');

  return {
    computedAt: input.now,
    active: apps.size + domains.size + patterns.size > 0,
    strict: strictTargets.size > 0,
    triggers: [...triggers].sort(),
    apps: [...apps].sort(),
    domains: [...domains].sort(),
    urlPatterns: [...patterns].sort(),
    allowDomains: [...allowDomains].sort(),
    allowApps: [...allowApps].sort(),
    sourceList,
  };
}
