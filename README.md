# nomnompewpewCDN

> Public CDN for hosting images, videos, JSON data, fonts, and CMS-loadable assets.

## CDN URLs

All assets are served through two endpoints:

| Endpoint | Pattern | Notes |
|----------|---------|-------|
| **jsDelivr** (cached) | `https://cdn.jsdelivr.net/gh/nomnompewpew/nomnompewpewCDN@main/{path}` | Best for production — globally cached |
| **GitHub Raw** (live) | `https://raw.githubusercontent.com/nomnompewpew/nomnompewpewCDN/main/{path}` | Always up-to-date, no CDN cache |

**Example:**
```
https://cdn.jsdelivr.net/gh/nomnompewpew/nomnompewpewCDN@main/images/avatars/photo.png
```

---

## Asset Manager (CMS)

A lightweight browser-based CMS lives at [`cms/index.html`](./cms/index.html).  
It is automatically deployed to **GitHub Pages** on every push to `main`:

> **Live URL:** https://nomnompewpew.github.io/nomnompewpewCDN/

**Features:**
- 📂 Browse folders in a sidebar tree — click any folder to open it
- ⊞ Grid view with image thumbnails / ☰ List view
- ☁ Drag-and-drop or click-to-browse file upload (commits directly via GitHub API)
- 📁 Create new folders from the toolbar
- 📋 **One-click copy** — CDN URL, Raw URL, relative path, or just the filename
- ☐ **Multi-select** — select any files, then bulk-copy all paths in any format  
  (CDN URLs · Raw URLs · Relative Paths · Filenames — newline-separated block)
- ⎘ **Copy entire folder** — sidebar copy button OR right-click → "Copy All CDN URLs" / "Copy All Paths"
- 🔍 Filter files by name within the current folder
- Right-click context menu on any file or folder

**Setup:**
1. Visit the live CMS at https://nomnompewpew.github.io/nomnompewpewCDN/ (or open `cms/index.html` locally)
2. Click **Settings** (top-right)
3. Paste a GitHub PAT with **Contents: Read & Write** permission
4. Owner / repo / branch are pre-filled — adjust if needed
5. Click **Save Settings** — you're ready

> The token is stored in your browser's `localStorage` only and never sent anywhere except the GitHub API.

---

## Repository Layout

```
nomnompewpewCDN/
│
├── images/
│   ├── avatars/        ← profile pictures
│   ├── banners/        ← hero / cover images
│   ├── icons/          ← UI icons & favicons
│   ├── og/             ← Open Graph / social share images
│   └── thumbnails/     ← small preview images
│
├── videos/
│   ├── clips/          ← short video clips
│   └── backgrounds/    ← looping background videos
│
├── data/
│   ├── cms/            ← CMS configuration (config.json, navigation.json, pages.json)
│   └── schemas/        ← JSON Schema files for validating CMS data
│
├── fonts/              ← Web fonts (.woff2, .woff, .ttf)
├── css/
│   └── themes/         ← CSS theme files
├── js/
│   └── components/     ← Loadable JS components / widgets
│
├── cms/                ← Browser-based Asset Manager
│   ├── index.html
│   ├── style.css
│   └── app.js
│
├── scripts/
│   ├── generate-manifest.js   ← scans all asset dirs → writes manifest.json files
│   └── validate.js            ← validates all JSON + schemas
│
├── manifest.json              ← auto-generated root asset manifest
├── package.json
└── .github/workflows/
    ├── validate.yml            ← CI: validates JSON on every push/PR
    └── generate-manifest.yml  ← CI: regenerates manifests on push to main
```

---

## Manifests

Every top-level asset directory gets a `manifest.json` plus a root `manifest.json` is generated at the repo root. These are consumed by the CMS app to list available assets.

Regenerate manually:

```bash
npm install
npm run manifest
```

---

## Tooling

```bash
npm install          # install dev tools (ajv for JSON schema validation)
npm run validate     # validate all JSON files + schema checks
npm run manifest     # (re)generate all manifest.json files
npm run check        # validate + manifest in one step
```

---

## CI / GitHub Actions

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `validate.yml` | Push / PR touching `data/**` | Validates every `.json` against its schema |
| `generate-manifest.yml` | Push to `main` (asset files) | Regenerates `manifest.json` files and auto-commits |
| `deploy-pages.yml` | Push to `main` touching `cms/**` (or manual) | Deploys the CMS to GitHub Pages |
