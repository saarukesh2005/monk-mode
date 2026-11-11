// MONK MODE shared feature contracts.
// Field names are camelCase here; the SQLite columns are the snake_case equivalents
// (see packages/database/migrations). Instants are epoch milliseconds, dates are 'YYYY-MM-DD'.

export type Id = string;
export type EpochMs = number;
export type LocalDate = string;

export type Platform = 'macos' | 'windows' | 'android' | 'browser';
export type RulePlatform = 'all' | 'macos' | 'windows' | 'android';

// ---------- Focus engine ----------

export const FOCUS_MODES = ['pomodoro', 'stopwatch', 'custom', 'deep_work', 'study', 'reading', 'break'] as const;
export type FocusMode = (typeof FOCUS_MODES)[number];

export const FOCUS_PHASES = ['focus', 'short_break', 'long_break'] as const;
export type FocusPhase = (typeof FOCUS_PHASES)[number];

export const SESSION_STATUSES = ['running', 'paused', 'completed', 'interrupted', 'skipped'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export interface FocusSession {
  id: Id;
  mode: FocusMode;
  phase: FocusPhase;
  status: SessionStatus;
  plannedMs: number | null;
  startedAt: EpochMs;
  pausedAt: EpochMs | null;
  pausedTotalMs: number;
  endedAt: EpochMs | null;
  focusedMs: number;
  cycleIndex: number;
  categoryId: Id | null;
  subjectId: Id | null;
  taskId: Id | null;
  note: string;
  strict: boolean;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

export interface PomodoroConfig {
  focusMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  longBreakEvery: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
}

export interface TimerSnapshot {
  session: FocusSession | null;
  now: EpochMs;
  elapsedMs: number;
  remainingMs: number | null;
}

export interface StartFocusRequest {
  mode: FocusMode;
  durationMin?: number;
  categoryId?: Id | null;
  subjectId?: Id | null;
  taskId?: Id | null;
  note?: string;
}

// ---------- Tasks & planning ----------

export const RECURRENCES = ['none', 'daily', 'weekdays', 'weekly', 'monthly'] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export interface Task {
  id: Id;
  parentId: Id | null;
  title: string;
  notes: string;
  priority: 0 | 1 | 2 | 3;
  status: 'todo' | 'done';
  dueDate: LocalDate | null;
  recurrence: Recurrence;
  categoryId: Id | null;
  subjectId: Id | null;
  sortOrder: number;
  completedAt: EpochMs | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
  tags?: string[];
}

export interface Category {
  id: Id;
  name: string;
  color: string;
  kind: 'session' | 'task' | 'block';
  createdAt: EpochMs;
}

export interface Subject {
  id: Id;
  name: string;
  color: string;
  weeklyGoalMin: number;
  archived: boolean;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

export type TopicStatus = 'not_started' | 'learning' | 'done';

export interface Topic {
  id: Id;
  subjectId: Id;
  title: string;
  status: TopicStatus;
  lastReviewed: LocalDate | null;
  nextReview: LocalDate | null;
  reviewCount: number;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

export interface CalendarEvent {
  id: Id;
  title: string;
  kind: 'event' | 'focus_block' | 'study';
  startAt: EpochMs;
  endAt: EpochMs;
  allDay: boolean;
  recurrence: Recurrence;
  subjectId: Id | null;
  notes: string;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

export interface EventOccurrence {
  eventId: Id;
  title: string;
  kind: CalendarEvent['kind'];
  startAt: EpochMs;
  endAt: EpochMs;
  allDay: boolean;
}

export interface DailyPlan {
  date: LocalDate;
  intention: string;
  priorities: string[];
  focusTargetMin: number;
  review: string;
  mood: number | null;
  reviewedAt: EpochMs | null;
  updatedAt: EpochMs;
}

// ---------- Blocking ----------

export type RuleType = 'app' | 'domain' | 'url_pattern' | 'category';

export type BlockMode = 'block' | 'pause';

export interface Blocklist {
  id: Id;
  name: string;
  kind: 'block' | 'allow';
  enabled: boolean;
  blockDuringFocus: boolean;
  /** 'pause' = Mindful pause (breathing countdown + intention) instead of a hard block. */
  mode?: BlockMode;
  pauseSeconds?: number;
  pauseAllowMin?: number;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

export interface BlockRule {
  id: Id;
  listId: Id;
  type: RuleType;
  value: string;
  label: string;
  platform: RulePlatform;
  createdAt: EpochMs;
}

export interface Schedule {
  id: Id;
  name: string;
  listId: Id;
  daysMask: number;
  startMinute: number;
  endMinute: number;
  strict: boolean;
  enabled: boolean;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

export interface QuickBlock {
  id: Id;
  listId: Id;
  startedAt: EpochMs;
  endsAt: EpochMs;
  endedAt: EpochMs | null;
}

export interface UsageLimit {
  id: Id;
  type: 'app' | 'domain';
  value: string;
  label: string;
  minutesPerDay: number;
  platform: RulePlatform;
  enabled: boolean;
  createdAt: EpochMs;
}

export interface TemporaryException {
  id: Id;
  type: 'app' | 'domain';
  value: string;
  reason: string;
  untilAt: EpochMs;
  createdAt: EpochMs;
}

export type BlockTrigger = 'focus' | 'schedule' | 'strict' | 'manual' | 'limit';

export interface BlockEvent {
  id: Id;
  ts: EpochMs;
  platform: Platform;
  source: 'app' | 'web' | 'hosts';
  target: string;
  listId: Id | null;
  action: string;
  trigger: BlockTrigger;
}

/** The effective, resolved rule set the enforcement engines act on right now. */
export interface ActiveBlockSet {
  computedAt: EpochMs;
  active: boolean;
  strict: boolean;
  triggers: BlockTrigger[];
  apps: string[];
  domains: string[];
  urlPatterns: string[];
  allowDomains: string[];
  allowApps: string[];
  /** Domain → list id, for event attribution. */
  sourceList: Record<string, Id>;
  /**
   * Lists in Mindful-pause mode that are active now and NOT strict-enforced:
   * list id → { seconds of pause, minutes allowed after continuing }.
   */
  pauseLists: Record<Id, { seconds: number; allowMin: number }>;
}

export type PauseOutcome = 'turned_back' | 'continued';

export interface PauseEvent {
  id: Id;
  ts: EpochMs;
  platform: Platform;
  target: string;
  listId: Id | null;
  outcome: PauseOutcome;
  intention: string;
}

// ---------- Strict mode ----------

export const STRICT_STATES = ['IDLE', 'PREPARING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'EMERGENCY_EXIT'] as const;
export type StrictState = (typeof STRICT_STATES)[number];
export type StrictLevel = 'normal' | 'strict' | 'maximum';

export interface StrictSession {
  id: Id;
  level: StrictLevel;
  state: Exclude<StrictState, 'IDLE'>;
  startedAt: EpochMs;
  endsAt: EpochMs;
  pausedAt: EpochMs | null;
  endedAt: EpochMs | null;
  exitReason: string;
  exitRequestedAt: EpochMs | null;
  listIds: Id[];
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

export interface StrictEvent {
  id: Id;
  sessionId: Id | null;
  ts: EpochMs;
  kind: string;
  detail: string;
}

// ---------- Usage & analytics ----------

export interface AppUsage {
  id: Id;
  appId: string;
  appName: string;
  startedAt: EpochMs;
  endedAt: EpochMs;
  durationMs: number;
  platform: Platform;
  source: string;
}

export interface WebUsage {
  id: Id;
  domain: string;
  startedAt: EpochMs;
  endedAt: EpochMs;
  durationMs: number;
  browser: string;
}

/** Every metric shown to users carries its provenance so estimates are never presented as measurements. */
export type MetricProvenance = 'measured' | 'recorded' | 'estimated' | 'unavailable';

// ---------- Capabilities ----------

export type CapabilityStatus =
  | 'SUPPORTED'
  | 'REQUIRES_PERMISSION'
  | 'REQUIRES_ENTITLEMENT'
  | 'EXPERIMENTAL'
  | 'UNSUPPORTED';

export interface Capability {
  id: string;
  label: string;
  status: CapabilityStatus;
  mechanism: string;
  limitation: string;
}

// ---------- Settings ----------

export type ThemeMode = 'dark' | 'light' | 'system';

export interface AppSettings {
  themeMode: ThemeMode;
  themeId: string;
  accent: string;
  fontScale: number;
  fontFamily: 'system' | 'serif' | 'mono';
  language: string;
  pomodoro: PomodoroConfig;
  defaultMode: FocusMode;
  dailyTargetMin: number;
  weeklyTargetMin: number;
  notificationsEnabled: boolean;
  notifyOnPhaseEnd: boolean;
  notifyOnBlock: boolean;
  soundEnabled: boolean;
  soundId: string;
  soundVolume: number;
  startOnLogin: boolean;
  startMinimized: boolean;
  closeToTray: boolean;
  dashboardWidgets: string[];
  showSecondsInTimer: boolean;
  usageTracking: boolean;
  hostsBlockingEnabled: boolean;
  requireExtensionInStrict: boolean;
  strictDailyLimitMin: number;
  emergencyCooldownSec: number;
  extensionToken: string;
  onboardingComplete: boolean;
}

// ---------- Backup ----------

export const BACKUP_FORMAT_VERSION = 1;

export interface BackupPayload {
  format: 'monk-mode-backup';
  formatVersion: number;
  schemaVersion: number;
  exportedAt: EpochMs;
  platform: Platform;
  appVersion: string;
  /** Table name → array of rows using snake_case column names exactly as stored. */
  tables: Record<string, Record<string, unknown>[]>;
}

export interface EncryptedBackupHeader {
  magic: 'MONKBAK1';
  kdf: 'PBKDF2-HMAC-SHA256';
  iterations: number;
  salt: string;
  nonce: string;
  cipher: 'AES-256-GCM';
}
