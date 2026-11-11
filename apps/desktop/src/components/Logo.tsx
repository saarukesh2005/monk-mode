export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden>
      <path d="M35 16.4A15.75 15.75 0 1 1 27.3 16.8" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="32" cy="32" r="3.5" fill="var(--text)" />
    </svg>
  );
}
