#!/usr/bin/env node
/**
 * generate-manifest.js
 *
 * Scans the CDN asset directories and writes a manifest.json file to each
 * top-level directory as well as a root-level manifest that indexes every
 * tracked asset.
 *
 * Usage:
 *   node scripts/generate-manifest.js
 *
 * Output:
 *   manifest.json                  — root manifest (all assets)
 *   images/manifest.json           — images only
 *   videos/manifest.json           — videos only
 *   data/manifest.json             — data/JSON files only
 *   fonts/manifest.json            — fonts only
 *   css/manifest.json              — stylesheets only
 *   js/manifest.json               — scripts only
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// CDN base URL (jsDelivr for cache-busted delivery; swap branch/tag as needed)
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/nomnompewpew/nomnompewpewCDN@main';

// Raw GitHub base (always up-to-date, not cached)
const RAW_BASE = 'https://raw.githubusercontent.com/nomnompewpew/nomnompewpewCDN/main';

/** Asset categories, their root directory, and the extensions they own */
const CATEGORIES = {
  images: { dir: 'images', exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.ico', '.bmp'] },
  videos: { dir: 'videos', exts: ['.mp4', '.webm', '.mov', '.ogg', '.m4v'] },
  data:   { dir: 'data',   exts: ['.json', '.yaml', '.yml', '.xml', '.csv'] },
  fonts:  { dir: 'fonts',  exts: ['.woff', '.woff2', '.ttf', '.otf', '.eot'] },
  css:    { dir: 'css',    exts: ['.css', '.scss', '.sass'] },
  js:     { dir: 'js',     exts: ['.js', '.mjs'] },
};

/** Files to always skip */
const SKIP_FILES = new Set([
  'manifest.json',
  '.gitkeep',
  '.DS_Store',
]);

/** Directories to always skip */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'scripts',
  '.github',
  'schemas', // inside data/, schemas are tooling not CDN assets
]);

/** Recursively collect files under `dir`, returning paths relative to ROOT */
function collectFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    if (entry.isFile()      && SKIP_FILES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full));
    } else if (entry.isFile()) {
      results.push(path.relative(ROOT, full));
    }
  }
  return results;
}

/** Build a manifest entry for a relative file path */
function buildEntry(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  const stat = fs.statSync(path.join(ROOT, relPath));
  return {
    path: relPath.replace(/\\/g, '/'),
    url: `${CDN_BASE}/${relPath.replace(/\\/g, '/')}`,
    rawUrl: `${RAW_BASE}/${relPath.replace(/\\/g, '/')}`,
    ext,
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
  };
}

/** Determine which category a relative path belongs to (null = skip) */
function categoryOf(relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  const ext = path.extname(normalized).toLowerCase();
  for (const [cat, { dir, exts }] of Object.entries(CATEGORIES)) {
    if (normalized.startsWith(dir + '/') && exts.includes(ext)) return cat;
  }
  return null;
}

/** Write a manifest JSON file, pretty-printed */
function writeManifest(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`  ✓ wrote ${path.relative(ROOT, filePath)}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log('Generating CDN manifests…\n');

const allFiles = collectFiles(ROOT);
const byCategory = Object.fromEntries(Object.keys(CATEGORIES).map((c) => [c, []]));

for (const relPath of allFiles) {
  const cat = categoryOf(relPath);
  if (!cat) continue;
  byCategory[cat].push(buildEntry(relPath));
}

const generatedAt = new Date().toISOString();

// Per-category manifests
for (const [cat, entries] of Object.entries(byCategory)) {
  const { dir } = CATEGORIES[cat];
  const manifest = {
    category: cat,
    generatedAt,
    cdnBase: CDN_BASE,
    rawBase: RAW_BASE,
    count: entries.length,
    assets: entries,
  };
  writeManifest(path.join(ROOT, dir, 'manifest.json'), manifest);
}

// Root manifest
const allEntries = Object.values(byCategory).flat();
const rootManifest = {
  generatedAt,
  cdnBase: CDN_BASE,
  rawBase: RAW_BASE,
  count: allEntries.length,
  categories: Object.fromEntries(
    Object.entries(byCategory).map(([cat, entries]) => [cat, entries.length])
  ),
  assets: allEntries,
};
writeManifest(path.join(ROOT, 'manifest.json'), rootManifest);

console.log(`\nDone — ${allEntries.length} asset(s) indexed.`);
