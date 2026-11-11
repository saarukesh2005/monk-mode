import type { Capability, CapabilityStatus } from '@monk/shared-types';
import { Badge } from './ui';

const TONE: Record<CapabilityStatus, 'success' | 'warning' | 'accent' | 'neutral' | 'danger'> = {
  SUPPORTED: 'success',
  REQUIRES_PERMISSION: 'warning',
  REQUIRES_ENTITLEMENT: 'accent',
  EXPERIMENTAL: 'neutral',
  UNSUPPORTED: 'danger',
};

const LABEL: Record<CapabilityStatus, string> = {
  SUPPORTED: 'Supported',
  REQUIRES_PERMISSION: 'Needs permission',
  REQUIRES_ENTITLEMENT: 'Needs Apple entitlement',
  EXPERIMENTAL: 'Experimental',
  UNSUPPORTED: 'Not supported',
};

export function CapabilityList({ items }: { items: Capability[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((c) => (
        <li key={c.id} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 py-3">
          <div className="text-[13px] font-medium text-ink">{c.label}</div>
          <Badge tone={TONE[c.status]}>{LABEL[c.status]}</Badge>
          <div className="col-span-2 text-[12px] leading-relaxed text-ink-muted">
            <span className="text-ink-faint">{c.mechanism}.</span> {c.limitation}
          </div>
        </li>
      ))}
    </ul>
  );
}
