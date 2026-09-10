// ST-153. tsc emits the compiled sources into dist/src; Chrome loads an
// unpacked extension from a flat directory whose manifest paths must match
// the manifest.json the tests pin (background.js, content.js, options.js).
// This script flattens the emit into dist/ and copies the static assets.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const pkg = new URL('../', import.meta.url);
const dist = new URL('dist/', pkg);
const src = new URL('dist/src/', pkg);
mkdirSync(dist, { recursive: true });
for (const name of readdirSync(src.pathname)) {
  copyFileSync(join(src.pathname, name), join(dist.pathname, name));
}
for (const name of ['manifest.json', 'options.html']) {
  copyFileSync(new URL(name, pkg), join(dist.pathname, name));
}
