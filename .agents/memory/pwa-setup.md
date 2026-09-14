---
name: PWA setup for シフト先生
description: How PWA / Add-to-Home-Screen is configured for the shift-sensei artifact.
---

# PWA setup — シフト先生

## Stack
- `vite-plugin-pwa` v1.3+ in `artifacts/shift-sensei/vite.config.ts`
- `@resvg/resvg-js` (workspace root devDep) for PNG generation from SVG

## Key config points
- `devOptions.enabled: false` — service worker disabled in dev intentionally. PWA features (manifest, SW) only active in production builds. This is correct: Add-to-Home-Screen only works from HTTPS anyway.
- `injectRegister: 'auto'` — `<link rel="manifest">` injected into built index.html automatically.
- `start_url: '.'`, `scope: '.'` — relative, correct because `BASE_PATH = "/"` (root-mounted artifact).
- `workbox.navigateFallbackDenylist: [/^\/api\//]` — API calls never fall through to the SW cache.

## Assets
- Icons: `artifacts/shift-sensei/public/icons/` — apple-touch-icon.png (180), icon-192.png, icon-512.png, icon-maskable-512.png. All blue (#2a459d) themed clock+calendar SVG rasterised via resvg.
- Splash screens: `artifacts/shift-sensei/public/splash/` — 11 PNG files covering all major iPhone resolutions. Linked in index.html via `<link rel="apple-touch-startup-image" media="...">`.
- Favicon: `public/favicon.svg` — same clock+calendar icon in #2a459d.

## Regeneration
Run `pnpm --filter @workspace/shift-sensei run gen:pwa` (calls `scripts/gen-splash.mjs`) to regenerate all icon PNGs and splash PNGs from the source SVG. Run this any time the icon design or brand colours change.

**Why:** @resvg/resvg-js is WebAssembly-based (no native binaries), so it works reliably in the Replit environment where sharp/canvas/PIL are not pre-installed.

## iOS-specific meta tags in index.html
All needed tags are in place:
- `apple-mobile-web-app-capable: yes`
- `apple-mobile-web-app-status-bar-style: black-translucent`
- `apple-mobile-web-app-title: シフト先生`
- `apple-touch-icon` → `/icons/apple-touch-icon.png`
- 11× `apple-touch-startup-image` → `/splash/splash-{W}x{H}.png`
