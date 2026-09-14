/**
 * Generates iOS apple-touch-startup-image (splash screen) PNGs
 * for every major iPhone screen size, and also regenerates the
 * app icons (favicon.svg + PNG set) so everything stays in sync.
 *
 * Run once:  node artifacts/shift-sensei/scripts/gen-splash.mjs
 */

import { Resvg } from '@resvg/resvg-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
const iconsDir = path.join(publicDir, 'icons');
const splashDir = path.join(publicDir, 'splash');

fs.mkdirSync(splashDir, { recursive: true });
fs.mkdirSync(iconsDir, { recursive: true });

// ─── Brand colours ────────────────────────────────────────────────────────────
const BG = '#2a459d';       // app primary blue (theme_color in manifest)
const BG_LIGHT = '#faf9f6'; // app background (background_color in manifest)

// ─── Icon SVG (512×512) ───────────────────────────────────────────────────────
// Clock-face + calendar grid on app-blue rounded square.
function iconSvg(size = 512) {
  const r = size * 0.22; // corner radius
  const cx = size / 2;
  const cy = size / 2;
  const ic = size * 0.38; // icon radius (white circle)
  const sw = size * 0.04; // stroke width inside icon
  // calendar grid offset
  const gc = size * 0.21; // calendar badge inset from center
  const gs = size * 0.28; // calendar badge box size

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="${size}" height="${size}" rx="${r}" fill="${BG}"/>

  <!-- Clock circle -->
  <circle cx="${cx - size * 0.04}" cy="${cy - size * 0.04}" r="${ic}" fill="white"/>

  <!-- Clock hands -->
  <line x1="${cx - size * 0.04}" y1="${cy - size * 0.04}"
        x2="${cx - size * 0.04}" y2="${cy - size * 0.04 - ic * 0.55}"
        stroke="${BG}" stroke-width="${sw}" stroke-linecap="round"/>
  <line x1="${cx - size * 0.04}" y1="${cy - size * 0.04}"
        x2="${cx - size * 0.04 + ic * 0.4}" y2="${cy - size * 0.04 + ic * 0.1}"
        stroke="${BG}" stroke-width="${sw}" stroke-linecap="round"/>
  <!-- Hour dots -->
  <circle cx="${cx - size * 0.04}" cy="${cy - size * 0.04 - ic * 0.82}" r="${sw * 0.7}" fill="${BG}"/>
  <circle cx="${cx - size * 0.04 + ic * 0.82}" cy="${cy - size * 0.04}" r="${sw * 0.7}" fill="${BG}"/>
  <circle cx="${cx - size * 0.04}" cy="${cy - size * 0.04 + ic * 0.82}" r="${sw * 0.7}" fill="${BG}"/>
  <circle cx="${cx - size * 0.04 - ic * 0.82}" cy="${cy - size * 0.04}" r="${sw * 0.7}" fill="${BG}"/>

  <!-- Calendar badge -->
  <rect x="${cx + gc - gs * 0.1}" y="${cy + gc - gs * 0.1}"
        width="${gs}" height="${gs}" rx="${gs * 0.15}" fill="${BG}"/>
  <rect x="${cx + gc - gs * 0.1 + sw}" y="${cy + gc - gs * 0.1 + gs * 0.28}"
        width="${gs - sw * 2}" height="${gs - gs * 0.28 - sw}"
        rx="${gs * 0.08}" fill="white"/>
  <!-- Calendar header -->
  <rect x="${cx + gc - gs * 0.1}" y="${cy + gc - gs * 0.1}"
        width="${gs}" height="${gs * 0.28}" rx="${gs * 0.15}" fill="white" opacity="0.25"/>
  <!-- Grid dots 3×2 -->
  ${[0,1,2].map(col => [0,1].map(row => {
    const gx = cx + gc - gs * 0.1 + sw * 2 + col * (gs - sw * 4) / 2.5;
    const gy = cy + gc - gs * 0.1 + gs * 0.28 + sw + row * (gs * 0.26);
    const dr = gs * 0.07;
    return `<rect x="${gx}" y="${gy}" width="${dr * 1.6}" height="${dr * 1.6}" rx="${dr * 0.4}" fill="${BG}"/>`;
  }).join('')).join('')}
</svg>`;
}

// ─── Splash SVG ───────────────────────────────────────────────────────────────
// Background fills the entire viewport; icon is centred; app name below.
function splashSvg(w, h) {
  const iconSize = Math.round(Math.min(w, h) * 0.28);
  const ix = (w - iconSize) / 2;
  const iy = (h - iconSize) / 2 - h * 0.06;
  const fontSize = Math.round(iconSize * 0.26);
  const labelY = iy + iconSize + fontSize * 1.5;

  // Embed the icon SVG as a <image> via data-URI base64
  const svgIcon = iconSvg(iconSize);
  const b64 = Buffer.from(svgIcon).toString('base64');

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <rect width="${w}" height="${h}" fill="${BG}"/>
  <image x="${ix}" y="${iy}" width="${iconSize}" height="${iconSize}"
         href="data:image/svg+xml;base64,${b64}"/>
  <text x="${w / 2}" y="${labelY}"
        font-family="'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif"
        font-size="${fontSize}" font-weight="700" fill="white"
        text-anchor="middle" dominant-baseline="middle">シフト先生</text>
</svg>`;
}

// ─── Render helper ─────────────────────────────────────────────────────────────
function render(svg, outPath, w, h) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: w },
    font: { loadSystemFonts: false },
  });
  const pngData = resvg.render();
  fs.writeFileSync(outPath, pngData.asPng());
  console.log(`  ✓  ${path.relative(process.cwd(), outPath)}  (${w}×${h})`);
}

// ─── 1. Favicon SVG (replace the plain orange block) ──────────────────────────
const faviconPath = path.join(publicDir, 'favicon.svg');
fs.writeFileSync(faviconPath, iconSvg(180));
console.log('\n🎨  Icons');
console.log(`  ✓  ${path.relative(process.cwd(), faviconPath)}`);

// ─── 2. App icons ─────────────────────────────────────────────────────────────
for (const [name, size] of [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],  // same design works for maskable safe zone
]) {
  render(iconSvg(size), path.join(iconsDir, name), size, size);
}

// ─── 3. Splash screens ────────────────────────────────────────────────────────
// [filename, width, height, media-query]
const splashSizes = [
  // iPhone SE 1st gen
  ['splash-640x1136.png',  640,  1136, '(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)'],
  // iPhone 6s / 7 / 8 / SE 3rd
  ['splash-750x1334.png',  750,  1334, '(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)'],
  // iPhone 6+/7+/8+
  ['splash-1242x2208.png', 1242, 2208, '(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
  // iPhone X / XS / 11 Pro
  ['splash-1125x2436.png', 1125, 2436, '(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
  // iPhone XR / 11
  ['splash-828x1792.png',  828,  1792, '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)'],
  // iPhone XS Max / 11 Pro Max
  ['splash-1242x2688.png', 1242, 2688, '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
  // iPhone 12 mini / 13 mini
  ['splash-1080x2340.png', 1080, 2340, '(device-width: 360px) and (device-height: 780px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
  // iPhone 12 / 12 Pro / 13 / 13 Pro / 14
  ['splash-1170x2532.png', 1170, 2532, '(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
  // iPhone 12 Pro Max / 13 Pro Max / 14 Plus
  ['splash-1284x2778.png', 1284, 2778, '(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
  // iPhone 14 Pro / 15 / 15 Pro
  ['splash-1179x2556.png', 1179, 2556, '(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
  // iPhone 14 Pro Max / 15 Plus / 15 Pro Max
  ['splash-1290x2796.png', 1290, 2796, '(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)'],
];

console.log('\n🖼   Splash screens');
for (const [name, w, h] of splashSizes) {
  render(splashSvg(w, h), path.join(splashDir, name), w, h);
}

// ─── 4. Emit the <link> tags to copy into index.html ─────────────────────────
console.log('\n📋  Paste these <link> tags into index.html (inside <head>):');
console.log('<!-- iOS splash screens -->');
for (const [name,, , media] of splashSizes) {
  console.log(`<link rel="apple-touch-startup-image" href="/splash/${name}" media="${media}" />`);
}
console.log('\nDone! ✅');
