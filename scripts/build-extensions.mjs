// Builds the Chromium and Firefox extensions from extensions/shared into
// extensions/browser-*/dist and zips them into artifacts/.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shared = join(root, 'extensions/shared');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const base = JSON.parse(readFileSync(join(shared, 'manifest.base.json'), 'utf8'));
const pkg = (name) => join(root, `packages/${name}/src/index.ts`);

const targets = {
  chromium: { ...base, version, background: { service_worker: 'background.js', type: 'module' }, minimum_chrome_version: '116' },
  firefox: {
    ...base,
    version,
    background: { scripts: ['background.js'], type: 'module' },
    browser_specific_settings: { gecko: { id: 'monk-mode@monkmode.app', strict_min_version: '128.0' } },
  },
};

for (const [name, manifest] of Object.entries(targets)) {
  const out = join(root, `extensions/browser-${name}/dist`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: ['background', 'blocked', 'popup', 'options'].map((e) => join(shared, `src/${e}.ts`)),
    outdir: out,
    bundle: true,
    format: 'esm',
    target: name === 'firefox' ? 'firefox128' : 'chrome116',
    minify: false,
    legalComments: 'none',
    alias: {
      '@monk/shared-core': pkg('shared-core'),
      '@monk/shared-types': pkg('shared-types'),
    },
    logLevel: 'warning',
  });
  cpSync(join(shared, 'static'), out, { recursive: true });
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const artifacts = join(root, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  const zip = join(artifacts, `monk-mode-${name}-${version}.zip`);
  rmSync(zip, { force: true });
  try {
    execFileSync('zip', ['-qr', zip, '.'], { cwd: out });
  } catch {
    process.stdout.write(`(zip not available; unpacked build is in ${out})\n`);
  }
  process.stdout.write(`built ${name} → ${out}\n`);
}
