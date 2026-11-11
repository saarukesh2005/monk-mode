import { ext } from './api';
import { domainOf } from './engine';

// Mindful pause: a breathing countdown and an intention, then a free choice.
// The friction design follows Grüning, Riedel & Lorenz-Spreen (PNAS 2023).

const params = new URLSearchParams(location.search);
const url = params.get('u') ?? '';
const seconds = Math.min(60, Math.max(3, Number(params.get('s')) || 10));
const allowMin = Math.min(30, Math.max(1, Number(params.get('a')) || 5));
const domain = domainOf(url);

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const intention = $<HTMLInputElement>('intention');
const cont = $<HTMLButtonElement>('continue');

$('site').textContent = domain ?? 'this site';
cont.textContent = `Continue for ${allowMin} min`;
document.documentElement.style.setProperty('--breath', `${Math.min(8, seconds)}s`);

let remaining = seconds;
const tick = (): void => {
  $('count').textContent = remaining > 0 ? String(remaining) : '';
  $('phase').textContent = remaining > 0 ? (Math.floor((seconds - remaining) / 4) % 2 === 0 ? 'Breathe in…' : 'Breathe out…') : 'Your choice.';
  cont.disabled = remaining > 0;
  if (remaining-- > 0) window.setTimeout(tick, 1000);
};
tick();

async function report(outcome: 'turned_back' | 'continued'): Promise<void> {
  if (!domain) return;
  await ext.runtime.sendMessage({ type: 'pause-outcome', domain, outcome, intention: intention.value.slice(0, 200) }).catch(() => undefined);
}

$('back').addEventListener('click', async () => {
  await report('turned_back');
  if (history.length > 2) history.go(-2);
  else window.close();
});

cont.addEventListener('click', async () => {
  if (!domain || cont.disabled) return;
  await report('continued');
  const res = (await ext.runtime.sendMessage({ type: 'exception', domain, minutes: allowMin, reason: intention.value.slice(0, 200) })) as { ok: boolean; error?: string };
  if (res.ok) location.replace(url);
  else $('error').textContent = res.error ?? 'Not available right now.';
});
