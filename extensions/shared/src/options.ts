import { bridge, ext, getSettings, setLocal } from './api';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function load(): Promise<void> {
  const s = await getSettings();
  $<HTMLInputElement>('token').value = s.token;
  $<HTMLInputElement>('port').value = String(s.port);
  $<HTMLInputElement>('track').checked = s.trackUsage;
  const granted = await ext.permissions.contains({ origins: ['<all_urls>'] });
  $('perm').hidden = granted;
}

$('save').addEventListener('click', async () => {
  const token = $<HTMLInputElement>('token').value.trim();
  const port = Number($<HTMLInputElement>('port').value) || 47613;
  if (!/^[a-f0-9]{32,128}$/i.test(token)) {
    $('result').textContent = 'That does not look like a pairing code. Copy it from MONK MODE → Settings → Blocker.';
    return;
  }
  if (port < 1024 || port > 65535) {
    $('result').textContent = 'Port must be between 1024 and 65535.';
    return;
  }
  const settings = { token, port, trackUsage: $<HTMLInputElement>('track').checked };
  await setLocal({ settings });
  try {
    await bridge(settings, '/v1/state');
    $('result').textContent = 'Paired. This browser now follows MONK MODE.';
  } catch (e) {
    $('result').textContent = `Saved, but MONK MODE did not respond: ${e instanceof Error ? e.message : e}. Is the desktop app running?`;
  }
  await ext.runtime.sendMessage({ type: 'sync' });
});

$('grant').addEventListener('click', async () => {
  // Firefox requires an explicit grant to see and redirect sites.
  const ok = await ext.permissions.request({ origins: ['<all_urls>'] });
  $('perm').hidden = ok;
});

void load();
