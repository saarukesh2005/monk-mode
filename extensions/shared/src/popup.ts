import type { ActiveBlockSet } from '@monk/shared-types';
import { ext } from './api';
import type { CachedState } from './engine';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

async function render(): Promise<void> {
  const s = (await ext.runtime.sendMessage({ type: 'status' })) as { set: ActiveBlockSet | null; cache: CachedState | null; lastError: string; settings: { token: string } };
  const connected = !!s.cache && Date.now() - s.cache.syncedAt < 90_000;
  $('conn').textContent = !s.settings.token ? 'Not paired' : connected ? 'Connected to MONK MODE' : 'Desktop app offline — using last sync';
  $('conn').className = connected ? 'ok' : 'warn';
  $('state').textContent = s.set?.active ? (s.set.strict ? 'Strict blocking active' : 'Blocking active') : 'Not blocking';
  $('detail').textContent = s.set?.active ? `${s.set.domains.length} sites · ${s.set.urlPatterns.length} URL patterns · ${s.set.triggers.join(', ')}` : 'Starts with focus sessions and schedules.';
  const f = s.cache?.state.focus;
  $('focus').textContent = f && f.endsAt ? `Focus ends ${new Date(f.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  $('error').textContent = s.settings.token && !connected ? s.lastError : '';
}

$('sync').addEventListener('click', async () => {
  await ext.runtime.sendMessage({ type: 'sync' });
  await render();
});
$('options').addEventListener('click', () => ext.runtime.openOptionsPage());
void render();
