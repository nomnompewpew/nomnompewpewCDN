#!/usr/bin/env node
/**
 * validate.js
 *
 * Validates all JSON files in the repository:
 *   1. Ensures every *.json file is valid JSON.
 *   2. Validates data/cms/*.json files against their schemas in data/schemas/.
 *
 * Usage:
 *   node scripts/validate.js
 *
 * Exit codes:
 *   0 — all files are valid
 *   1 — one or more validation errors found
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ROOT = path.resolve(__dirname, '..');

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

let errors = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Recursively find all *.json files under `dir`, skipping node_modules/.git */
function findJsonFiles(dir) {
  const SKIP = new Set(['node_modules', '.git', 'scripts', '.github']);
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsonFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      results.push(full);
    }
  }
  return results;
}

/** Parse a JSON file; returns [data, null] or [null, errorMessage] */
function parseJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return [JSON.parse(raw), null];
  } catch (err) {
    return [null, err.message];
  }
}

/** Load a schema from data/schemas/<name>.schema.json if it exists */
function loadSchema(name) {
  const schemaPath = path.join(ROOT, 'data', 'schemas', `${name}.schema.json`);
  if (!fs.existsSync(schemaPath)) return null;
  const [schema, err] = parseJson(schemaPath);
  if (err) {
    console.error(`  ✗ could not parse schema ${schemaPath}: ${err}`);
    errors++;
    return null;
  }
  return schema;
}

// ─── Step 1: Syntax check every JSON file ─────────────────────────────────────

console.log('Step 1 — Checking JSON syntax…\n');

const jsonFiles = findJsonFiles(ROOT);
const validParsed = new Map(); // filePath → parsed data

for (const filePath of jsonFiles) {
  const rel = path.relative(ROOT, filePath);
  const [data, err] = parseJson(filePath);
  if (err) {
    console.error(`  ✗ ${rel}\n    ${err}`);
    errors++;
  } else {
    console.log(`  ✓ ${rel}`);
    validParsed.set(filePath, data);
  }
}

// ─── Step 2: Schema validation for data/cms files ─────────────────────────────

console.log('\nStep 2 — Validating CMS data files against schemas…\n');

const cmsDir = path.join(ROOT, 'data', 'cms');
if (fs.existsSync(cmsDir)) {
  const cmsFiles = fs
    .readdirSync(cmsDir)
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json');

  for (const filename of cmsFiles) {
    const filePath = path.join(cmsDir, filename);
    const rel = path.relative(ROOT, filePath);
    const schemaName = filename.replace('.json', '');
    const schema = loadSchema(schemaName);

    if (!schema) {
      console.log(`  ⚠ ${rel} — no schema found (data/${schemaName}.schema.json), skipping`);
      continue;
    }

    const data = validParsed.get(filePath);
    if (!data) continue; // already failed syntax check

    const validate = ajv.compile(schema);
    const valid = validate(data);
    if (!valid) {
      console.error(`  ✗ ${rel} — schema validation failed:`);
      for (const ve of validate.errors) {
        console.error(`    • ${ve.instancePath || '/'} ${ve.message}`);
      }
      errors++;
    } else {
      console.log(`  ✓ ${rel}`);
    }
  }
} else {
  console.log('  (no data/cms directory found, skipping)');
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log();
if (errors === 0) {
  console.log('All checks passed ✓');
  process.exit(0);
} else {
  console.error(`${errors} error(s) found ✗`);
  process.exit(1);
}
