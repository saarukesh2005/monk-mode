// Renders assets/brand/icon.svg to PNGs used by the desktop (tauri icon), the extensions and Android.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'assets/brand/icon.svg'), 'utf8');

function render(size, out) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
}

render(1024, join(root, 'assets/brand/icon-1024.png'));
for (const size of [16, 32, 48, 128]) {
  render(size, join(root, `extensions/shared/static/icons/icon-${size}.png`));
}
const android = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [density, size] of Object.entries(android)) {
  render(size, join(root, `apps/android/app/src/main/res/mipmap-${density}/ic_launcher.png`));
}
process.stdout.write('icons generated\n');
