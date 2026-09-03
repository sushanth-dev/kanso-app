/*
 * Regenerates the favicon raster derivatives from public/favicon.svg
 * (ST-113): the 32 px PNG fallback and the 180 px opaque apple-touch icon.
 * Run from the repository root:
 *
 *   node apps/web/scripts/favicon-rasters.mjs
 *
 * Playwright is already in the toolchain for the e2e suite, so rasterising
 * borrows its Chromium instead of adding an image toolchain.
 */
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const publicDir = path.resolve(import.meta.dirname, '../public');
const svg = await readFile(path.join(publicDir, 'favicon.svg'), 'utf8');
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const browser = await chromium.launch();
const page = await browser.newPage();

async function raster(size, file, { background, opaque }) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;background:${background}">` +
      `<img src="${dataUrl}" width="${size}" height="${size}" style="display:block">`,
  );
  const buffer = await page.screenshot({ omitBackground: !opaque });
  await writeFile(path.join(publicDir, file), buffer);
  console.log(`${file}: ${buffer.length} bytes`);
}

await raster(32, 'favicon-32.png', { background: 'transparent', opaque: false });
await raster(180, 'apple-touch-icon.png', { background: '#f7f2ea', opaque: true });
await browser.close();
