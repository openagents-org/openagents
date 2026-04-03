#!/usr/bin/env node
'use strict';

/**
 * Converts YAML plugin definitions from src/openagents/registry/*.yaml
 * into a bundled registry.json for the agent-connector package.
 *
 * Usage: node scripts/build-registry.js
 */

const fs = require('fs');
const path = require('path');

const REGISTRY_DIR = path.resolve(__dirname, '..', '..', '..', 'src', 'openagents', 'registry');
const OUTPUT_FILE = path.resolve(__dirname, '..', 'registry.json');

function parseSimpleYaml(text) {
  const lines = text.split('\n');
  const root = {};
  const stack = [{ obj: root, indent: -1 }];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const stripped = raw.replace(/\r$/, '');
    const trimmed = stripped.trimStart();
    i++;

    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = stripped.length - trimmed.length;

    // Pop stack to find parent at correct indent level
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    // List item
    if (trimmed.startsWith('- ')) {
      const rest = trimmed.slice(2).trim();
      // Ensure parent key holds an array
      const parentKey = stack[stack.length - 1].key;
      if (parentKey && !Array.isArray(parent[parentKey])) {
        // This shouldn't happen if YAML is well-formed, but handle gracefully
      }

      if (rest.includes(':')) {
        // List of objects: - key: value
        const item = {};
        const colonIdx = rest.indexOf(':');
        const key = rest.slice(0, colonIdx).trim();
        const val = rest.slice(colonIdx + 1).trim();
        item[key] = parseValue(val);

        // Read indented continuation lines for this list item
        while (i < lines.length) {
          const nextRaw = lines[i].replace(/\r$/, '');
          const nextTrimmed = nextRaw.trimStart();
          const nextIndent = nextRaw.length - nextTrimmed.length;
          if (!nextTrimmed || nextTrimmed.startsWith('#')) { i++; continue; }
          if (nextIndent <= indent) break;
          if (nextTrimmed.startsWith('- ')) break;
          if (nextTrimmed.includes(':')) {
            const ci = nextTrimmed.indexOf(':');
            const k = nextTrimmed.slice(0, ci).trim();
            const v = nextTrimmed.slice(ci + 1).trim();
            item[k] = parseValue(v);
          }
          i++;
        }

        // Find the array to push into
        if (Array.isArray(parent)) {
          parent.push(item);
        } else if (parentKey && Array.isArray(parent[parentKey])) {
          parent[parentKey].push(item);
        }
      } else {
        // Simple list item: - value
        const val = parseValue(rest);
        if (Array.isArray(parent)) {
          parent.push(val);
        } else if (parentKey && Array.isArray(parent[parentKey])) {
          parent[parentKey].push(val);
        }
      }
      continue;
    }

    // Key: value
    if (trimmed.includes(':')) {
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim();

      if (val === '' || val === '|' || val === '>') {
        // Could be a mapping or list — peek ahead
        const nextIdx = findNextNonEmpty(lines, i);
        if (nextIdx >= 0) {
          const nextLine = lines[nextIdx].replace(/\r$/, '');
          const nextTrimmed = nextLine.trimStart();
          const nextIndent = nextLine.length - nextTrimmed.length;
          if (nextIndent > indent && nextTrimmed.startsWith('- ')) {
            // It's a list
            parent[key] = [];
            stack.push({ obj: parent, indent, key });
          } else if (nextIndent > indent) {
            // It's a nested mapping
            parent[key] = {};
            stack.push({ obj: parent[key], indent });
          } else {
            parent[key] = null;
          }
        } else {
          parent[key] = null;
        }
      } else if (val.startsWith('[') && val.endsWith(']')) {
        // Inline list: [a, b, c]
        parent[key] = val.slice(1, -1).split(',').map((s) => parseValue(s.trim()));
      } else {
        parent[key] = parseValue(val);
      }
      continue;
    }
  }

  return root;
}

function findNextNonEmpty(lines, start) {
  for (let j = start; j < lines.length; j++) {
    const t = lines[j].trim();
    if (t && !t.startsWith('#')) return j;
  }
  return -1;
}

function parseValue(val) {
  if (val === '' || val === 'null' || val === '~') return null;
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (/^\d+$/.test(val)) return parseInt(val, 10);
  if (/^\d+\.\d+$/.test(val)) return parseFloat(val);
  // Strip quotes
  if ((val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  return val;
}

function buildRegistry() {
  if (!fs.existsSync(REGISTRY_DIR)) {
    console.error(`Registry directory not found: ${REGISTRY_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(REGISTRY_DIR)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort();

  const catalog = [];

  for (const file of files) {
    const text = fs.readFileSync(path.join(REGISTRY_DIR, file), 'utf-8');
    try {
      const entry = parseSimpleYaml(text);
      if (entry.name) {
        catalog.push(entry);
      } else {
        console.warn(`Skipping ${file}: no 'name' field`);
      }
    } catch (err) {
      console.warn(`Failed to parse ${file}: ${err.message}`);
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(catalog, null, 2) + '\n', 'utf-8');
  console.log(`Built registry.json with ${catalog.length} entries → ${OUTPUT_FILE}`);
}

buildRegistry();
