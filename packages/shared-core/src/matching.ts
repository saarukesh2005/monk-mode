// Website rule matching shared by the desktop bridge, the browser extensions and the tests.
// Rule formats:
//   domain:      "youtube.com"           → matches youtube.com and any subdomain; "*" matches every site
//   url_pattern: "youtube.com/shorts/*"  → host rule + path glob ("*" = any characters)

const MAX_DOMAIN_LENGTH = 253;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** Turns user input like "https://www.Reddit.com/r/x" into "reddit.com". Returns null if invalid. */
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (s === '*') return '*';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[/?#]/)[0] ?? '';
  s = s.replace(/^.*@/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (s.startsWith('*.')) s = s.slice(2);
  if (s.startsWith('www.')) s = s.slice(4);
  if (s.length === 0 || s.length > MAX_DOMAIN_LENGTH || !DOMAIN_RE.test(s)) return null;
  return s;
}

/** Normalizes "https://www.youtube.com/shorts/*" → "youtube.com/shorts/*". */
export function normalizeUrlPattern(input: string): string | null {
  const s = input.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const slash = s.indexOf('/');
  if (slash <= 0) return null;
  const host = normalizeDomain(s.slice(0, slash));
  if (!host || host === '*') return null;
  const path = s.slice(slash);
  if (path.length > 400 || /\s/.test(path)) return null;
  return `${host}${path}`;
}

export function hostMatches(host: string, ruleDomain: string): boolean {
  if (ruleDomain === '*') return true;
  const h = host.toLowerCase().replace(/\.$/, '');
  return h === ruleDomain || h.endsWith(`.${ruleDomain}`);
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

export function urlPatternMatches(url: URL, pattern: string): boolean {
  const slash = pattern.indexOf('/');
  if (slash <= 0) return false;
  const host = pattern.slice(0, slash);
  if (!hostMatches(url.hostname, host)) return false;
  return globToRegExp(pattern.slice(slash)).test(url.pathname + url.search);
}

export interface WebRuleSet {
  domains: string[];
  urlPatterns: string[];
  allowDomains: string[];
}

export interface UrlDecision {
  blocked: boolean;
  matched: string | null;
  reason: 'allowlisted' | 'domain' | 'url_pattern' | 'not_matched' | 'not_web';
}

/** Allowlist entries always win over block rules. Only http(s) URLs are evaluated. */
export function evaluateUrl(rawUrl: string, rules: WebRuleSet): UrlDecision {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { blocked: false, matched: null, reason: 'not_web' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { blocked: false, matched: null, reason: 'not_web' };
  const allow = rules.allowDomains.find((d) => hostMatches(url.hostname, d));
  if (allow) return { blocked: false, matched: allow, reason: 'allowlisted' };
  const domain = rules.domains.find((d) => hostMatches(url.hostname, d));
  if (domain) return { blocked: true, matched: domain, reason: 'domain' };
  const pattern = rules.urlPatterns.find((p) => urlPatternMatches(url, p));
  if (pattern) return { blocked: true, matched: pattern, reason: 'url_pattern' };
  return { blocked: false, matched: null, reason: 'not_matched' };
}

/** Matches an application rule against a running app identifier (bundle id, exe name, path or package). */
export function appMatches(rule: string, candidates: string[]): boolean {
  const r = rule.trim().toLowerCase();
  if (!r) return false;
  return candidates.some((c) => {
    const v = c.trim().toLowerCase();
    if (!v) return false;
    if (v === r) return true;
    const base = v.split(/[\\/]/).pop() ?? v;
    return base === r || base === `${r}.exe` || base === `${r}.app` || base.replace(/\.(exe|app)$/, '') === r;
  });
}
