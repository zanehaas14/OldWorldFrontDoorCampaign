#!/usr/bin/env node
/**
 * Imports DEFAULT_UNITS from a legacy army-builder JSX file into public/data/units.json
 *
 * Usage:
 *   node scripts/import-from-legacy.js [path]
 *
 * If no path is given, tries (in order):
 *   army-builder-2-2.jsx, army-builder-2.jsx, army-builder.jsx
 *   in the project's ../Downloads folder.
 *
 * Supported source files (any version):
 *   - army-builder.jsx       (earliest – UNIT_CATEGORIES without "Characters")
 *   - army-builder-2.jsx     (adds "Characters")
 *   - army-builder-2-2.jsx   (latest / most complete)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const downloadsDir = join(__dirname, '../../Downloads')
const defaultNames = ['army-builder-2-2.jsx', 'army-builder-2.jsx', 'army-builder.jsx']

function findSourcePath() {
  if (args[0]) return args[0]
  for (const name of defaultNames) {
    const p = join(downloadsDir, name)
    if (existsSync(p)) return p
  }
  return join(downloadsDir, 'army-builder-2-2.jsx')
}

const srcPath = findSourcePath()

let content
try {
  content = readFileSync(srcPath, 'utf8')
} catch (e) {
  console.error('Could not read file:', srcPath)
  process.exit(1)
}

// Find DEFAULT_UNITS = { then extract by brace matching (regex fails on large nested objects)
const startMarker = 'const DEFAULT_UNITS = '
const idx = content.indexOf(startMarker)
if (idx === -1) {
  console.error('Could not find DEFAULT_UNITS in file')
  process.exit(1)
}
const start = idx + startMarker.length
if (content[start] !== '{') {
  console.error('Expected { after DEFAULT_UNITS =')
  process.exit(1)
}
let depth = 1
let i = start + 1
while (depth > 0 && i < content.length) {
  const c = content[i]
  if (c === '{' || c === '[') depth++
  else if (c === '}' || c === ']') depth--
  i++
}
const objStr = content.slice(start, i)

const wrapped = `
  const FACTIONS = {};
  const UNIT_CATEGORIES = [];
  const DEFAULT_UNITS = ${objStr};
  return JSON.stringify(DEFAULT_UNITS);
`
try {
  const result = new Function(wrapped)()
  const units = JSON.parse(result)
  const outPath = join(__dirname, '../public/data/units.json')
  writeFileSync(outPath, JSON.stringify(units, null, 2), 'utf8')
  const total = Object.values(units).flat().length
  console.log('Imported', total, 'units from', srcPath.split('/').pop(), 'to', outPath)
} catch (e) {
  console.error('Parse error:', e.message)
  process.exit(1)
}
