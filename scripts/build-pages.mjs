import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { assets } from './vision-assets.mjs';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
await rm(dist, { recursive: true, force: true });
await mkdir(new URL('vision/wasm/', dist), { recursive: true });
for (const file of ['index.html', 'style.css', 'app.js', 'tracker.js', 'motion-detector.js', 'camera-zoom.js', 'analysis-client.js', 'video-reader.js', 'video-export.js', 'frame-sampling.js', 'frame-encoding.js', 'training-context.js', 'model-catalog.js', 'icon.svg', 'manifest.webmanifest']) {
  await copyFile(new URL('src/' + file, root), new URL(file, dist));
}
await mkdir(new URL('licenses/', dist), { recursive: true });
await copyFile(new URL('licenses/mediapipe-LICENSE.txt', root), new URL('licenses/mediapipe-LICENSE.txt', dist));
await copyFile(new URL('THIRD_PARTY_NOTICES.md', root), new URL('THIRD_PARTY_NOTICES.md', dist));
await writeFile(new URL('.nojekyll', dist), '');
await mkdir(new URL('work/asset-cache/', root), { recursive: true });
for (const asset of assets) {
  const cached = new URL('work/asset-cache/' + asset.path.split('/').pop(), root);
  let body;
  try { body = await readFile(cached); } catch {}
  const hash = value => createHash('sha256').update(value).digest('hex');
  if (!body || hash(body) !== asset.sha256) {
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(120_000), redirect: 'error' });
    if (!response.ok) throw new Error('Cannot download ' + asset.path + ': HTTP ' + response.status);
    body = Buffer.from(await response.arrayBuffer());
    if (hash(body) !== asset.sha256) throw new Error('Integrity mismatch: ' + asset.path);
    await writeFile(cached, body);
  }
  await writeFile(new URL(asset.path, dist), body);
}
console.log('Built static GitHub Pages site: dist/');
