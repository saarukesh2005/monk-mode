import { ext } from './api';
import { domainOf } from './engine';

const params = new URLSearchParams(location.search);
const url = params.get('u') ?? '';
const matched = params.get('m') ?? '';
const strict = params.get('s') === '1';
const domain = domainOf(url);

const QUOTES = [
  'The work is the reward.',
  'Attention is the rarest form of generosity — give it to your own work.',
  'What you do now is what you become.',
  'Small steps, every day.',
  'Return to the breath. Return to the task.',
];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

$('quote').textContent = QUOTES[Math.floor(Math.random() * QUOTES.length)] ?? '';
$('site').textContent = domain ?? (params.get('src') === 'network' ? 'This site' : 'This page');
$('rule').textContent = matched ? `Matched rule: ${matched}` : '';
$('back').addEventListener('click', () => (history.length > 2 ? history.go(-2) : window.close()));

const access = $('access');
if (strict || !domain) {
  access.hidden = true;
  $('strict').hidden = !strict;
} else {
  for (const btn of access.querySelectorAll<HTMLButtonElement>('button[data-min]')) {
    btn.addEventListener('click', async () => {
      const reason = ($('reason') as HTMLInputElement).value.slice(0, 200);
      const res = (await ext.runtime.sendMessage({ type: 'exception', domain, minutes: Number(btn.dataset.min), reason })) as { ok: boolean; error?: string };
      if (res.ok) location.replace(url);
      else $('error').textContent = res.error ?? 'Not allowed right now.';
    });
  }
}
