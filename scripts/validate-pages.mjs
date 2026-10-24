import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { assets } from './vision-assets.mjs';
const dist = new URL('../dist/', import.meta.url);
const html = await readFile(new URL('index.html', dist), 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const ref = match[1];
  if (/^https:|^#/.test(ref)) continue;
  assert.ok(ref.startsWith('./'), 'Asset must be project-relative: ' + ref);
  const resolved = new URL(ref, 'https://song-forever.github.io/airbag/');
  assert.ok(resolved.pathname.startsWith('/airbag/'));
  if (ref !== './') await readFile(new URL(ref, dist));
}
const app = await readFile(new URL('app.js', dist), 'utf8');
assert.ok(!app.includes('/api/analyze'), 'Static app must call Qwen directly');
assert.ok(!/from\s+['"]\//.test(app), 'Module imports must be relative');
assert.ok(app.includes('analyzeFrames('));
for (const ref of ['vision/vision_bundle.mjs', 'vision/wasm', 'vision/model.tflite']) assert.ok(app.includes("new URL('./" + ref));
const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', dist), 'utf8'));
assert.equal(manifest.start_url, './');
assert.equal(manifest.scope, './');
for (const icon of manifest.icons) await readFile(new URL(icon.src, dist));
for (const asset of assets) {
  const body = await readFile(new URL(asset.path, dist));
  assert.equal(createHash('sha256').update(body).digest('hex'), asset.sha256, asset.path);
}
const entries = await readdir(dist);
for (const name of entries.filter(name => name.endsWith('.js'))) {
  const module = await readFile(new URL(name, dist), 'utf8');
  for (const match of module.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) await readFile(new URL(match[1], dist));
}
for (const unwanted of ['recognition-consensus.js', 'frame-groups-client.js']) assert.ok(!entries.includes(unwanted), 'Superseded multi-group experiment must not be published: ' + unwanted);
for (const unwanted of ['server', 'worker', '.env', '.openai', 'work', 'tests']) assert.ok(!entries.includes(unwanted), 'Unexpected published file: ' + unwanted);
console.log('Validated project-relative assets, manifest, direct client and all detection asset hashes.');
