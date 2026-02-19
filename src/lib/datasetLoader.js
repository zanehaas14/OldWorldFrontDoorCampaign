/**
 * Load unit data from JSON dataset files (e.g. from nthiebes/old-world-builder style).
 * Files live in public/data/datasets/. Filename determines faction:
 * - *elf* → eonir (Wood Elf Realms, Dark Elves, High Elf Realms)
 * - Renegade Crowns, Empire of Man, Kingdom of Bretonnia → borderPrinces
 * - Tomb Kings of Khemri → tombKings
 * - Lizardmen → lizardmen (no file in default set; use base/BSData)
 */

const DATASET_BASE = '/data/datasets'

/** Map dataset filename (no .json) to app faction id. */
export const DATASET_FACTION_MAP = {
  'wood-elf-realms': 'eonir',
  'dark-elves': 'eonir',
  'high-elf-realms': 'eonir',
  'renegade-crowns': 'borderPrinces',
  'empire-of-man': 'borderPrinces',
  'kingdom-of-bretonnia': 'borderPrinces',
  'tomb-kings-of-khemri': 'tombKings',
}

const STORAGE_KEY = 'tow_use_dataset_json'
const CACHE_PREFIX = 'tow_dataset_'
const CACHE_TTL_MS = 60 * 60 * 1000 // 1h

export function isDatasetEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function setDatasetEnabled(on) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'true' : 'false')
  } catch {
    // ignore
  }
}

function cacheKey(filename) {
  return `${CACHE_PREFIX}${filename}`
}

function getCached(filename) {
  try {
    const raw = localStorage.getItem(cacheKey(filename))
    if (!raw) return null
    const { data, at } = JSON.parse(raw)
    if (Date.now() - at > CACHE_TTL_MS) return null
    return data
  } catch {
    return null
  }
}

function setCache(filename, data) {
  try {
    localStorage.setItem(cacheKey(filename), JSON.stringify({ data, at: Date.now() }))
  } catch {
    // ignore
  }
}

export function clearDatasetCache() {
  try {
    const keys = Object.keys(DATASET_FACTION_MAP)
    keys.forEach((k) => localStorage.removeItem(cacheKey(k + '.json')))
  } catch {
    // ignore
  }
}

function nameEn(obj) {
  if (!obj) return ''
  return obj.name_en ?? obj.name ?? ''
}

function notesStr(entry) {
  const n = entry.notes
  if (typeof n === 'string') return n
  if (n && typeof n === 'object' && n.name_en) return n.name_en
  return ''
}

/** Stable id for upgrades: slug from name, deduped with _1, _2, ... */
function upgradeId(name, existingIds) {
  const base = (name || 'upgrade').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'upgrade'
  let id = base
  let n = 0
  while (existingIds.has(id)) {
    n += 1
    id = `${base}_${n}`
  }
  existingIds.add(id)
  return id
}

/** Map dataset magic type strings to app slot names. */
const MAGIC_TYPE_TO_SLOT = {
  'weapon': 'weapons',
  'armor': 'armour',
  'armour': 'armour',
  'talisman': 'talismans',
  'enchanted-item': 'enchanted',
  'arcane': 'arcane',
  'arcane-item': 'arcane',
  'banner': 'banners',
  'forest-spite': 'enchanted', // Forest spites map to enchanted slot
}

/** Convert dataset magic types to app slot names. */
function convertMagicTypes(types) {
  if (!Array.isArray(types)) return []
  return types.map(t => MAGIC_TYPE_TO_SLOT[t] || t).filter(Boolean)
}

/** Convert options array to upgrade objects, preserving exclusive flag. */
function convertOptions(options, upgradeIds) {
  const upgrades = []
  if (!Array.isArray(options)) return upgrades
  options.forEach((o) => {
    const name = nameEn(o)
    const up = {
      id: upgradeId(name, upgradeIds),
      name,
      pts: o.points ?? 0,
      perModel: !!o.perModel,
      type: 'equipment',
    }
    if (o.exclusive) up.exclusive = true
    upgrades.push(up)
  })
  return upgrades
}

/** Convert command array to upgrade objects, preserving magic item budgets. */
function convertCommand(command, upgradeIds) {
  const upgrades = []
  if (!Array.isArray(command)) return upgrades
  command.forEach((c) => {
    const name = nameEn(c)
    const up = {
      id: upgradeId(name, upgradeIds),
      name,
      pts: c.points ?? 0,
      perModel: false,
      type: 'command',
    }
    // Preserve magic item budget for command figures (champions, standard bearers)
    if (c.magic) {
      up.magic = {
        slots: convertMagicTypes(c.magic.types),
        maxPoints: c.magic.maxPoints ?? 0,
      }
    }
    upgrades.push(up)
  })
  return upgrades
}

/** Convert mounts array to upgrade objects. */
function convertMounts(mounts, upgradeIds) {
  const upgrades = []
  if (!Array.isArray(mounts)) return upgrades
  mounts.forEach((m) => {
    if (!m.active) {
      const name = nameEn(m).replace(/\s*\{mount\}\s*/gi, '').trim()
      upgrades.push({
        id: upgradeId(name, upgradeIds),
        name,
        pts: m.points ?? 0,
        perModel: false,
        type: 'mount',
        exclusive: true, // Mounts are always mutually exclusive
      })
    }
  })
  return upgrades
}

/** Parse specialRules from dataset entry (localized comma-separated string → array). */
function parseSpecialRules(entry) {
  const sr = entry.specialRules
  if (!sr) return []
  const str = typeof sr === 'string' ? sr : (sr.name_en ?? sr.name ?? '')
  if (!str.trim()) return []
  return str.split(',').map(s => s.trim()).filter(Boolean)
}

/** Convert a character entry to app unit shape. Lords/Heroes for magic item budget (Lords 100pts, Heroes 50pts). */
function characterToUnit(entry, sourceKey) {
  const id = entry.id || entry.name_en?.toLowerCase().replace(/\s+/g, '-') || 'unknown'
  const uniqueId = `${sourceKey}_${id}`
  const equipment = []
  if (Array.isArray(entry.equipment)) entry.equipment.forEach((e) => equipment.push(nameEn(e)))
  if (Array.isArray(entry.armor)) entry.armor.forEach((a) => equipment.push(nameEn(a)))
  const upgradeIds = new Set()
  const upgrades = [
    ...convertOptions(entry.options, upgradeIds),
    ...convertCommand(entry.command, upgradeIds),
    ...convertMounts(entry.mounts, upgradeIds),
  ]
  // Categorize by magic item point limit: Lords 100 pts, Heroes 50 pts (TOW standard)
  const MAGIC_LIMIT_LORDS = 100
  const MAGIC_LIMIT_HEROES = 50
  const pts = entry.points ?? 0
  const isLord = pts >= 100
  const magicItemBudget = isLord ? MAGIC_LIMIT_LORDS : MAGIC_LIMIT_HEROES
  const specialRules = parseSpecialRules(entry)
  return {
    id: uniqueId,
    name: nameEn(entry),
    category: isLord ? 'Lords' : 'Heroes',
    isCharacter: true,
    ptsCost: pts,
    minSize: 1,
    maxSize: 1,
    magicItemBudget,
    equipment,
    specialRules: specialRules.length ? specialRules : undefined,
    upgrades: upgrades.length ? upgrades : undefined,
    notes: notesStr(entry) || undefined,
    fromDataset: true,
  }
}

/** Convert a core/special/rare/mercenaries/allies entry to app unit shape. */
function rosterEntryToUnit(entry, category, sourceKey) {
  const id = entry.id || entry.name_en?.toLowerCase().replace(/\s+/g, '-') || 'unknown'
  const uniqueId = `${sourceKey}_${id}`
  const equipment = []
  if (Array.isArray(entry.equipment)) entry.equipment.forEach((e) => equipment.push(nameEn(e)))
  if (Array.isArray(entry.armor)) entry.armor.forEach((a) => equipment.push(nameEn(a)))
  const upgradeIds = new Set()
  const upgrades = [
    ...convertOptions(entry.options, upgradeIds),
    ...convertCommand(entry.command, upgradeIds),
    ...convertMounts(entry.mounts, upgradeIds),
  ]
  const min = entry.minimum ?? 1
  const max = entry.maximum === 0 ? 99 : (entry.maximum ?? 99)
  const specialRules = parseSpecialRules(entry)
  return {
    id: uniqueId,
    name: nameEn(entry),
    category,
    isCharacter: false,
    ptsPerModel: entry.points ?? 0,
    minSize: min,
    maxSize: max,
    equipment,
    specialRules: specialRules.length ? specialRules : undefined,
    upgrades: upgrades.length ? upgrades : undefined,
    notes: notesStr(entry) || undefined,
    fromDataset: true,
  }
}

/** Parse one dataset JSON into array of app-style units. */
function parseDatasetJson(json, sourceKey) {
  const units = []
  if (Array.isArray(json.characters)) {
    json.characters.forEach((e) => units.push(characterToUnit(e, sourceKey)))
  }
  const rosterCategories = [
    ['core', 'Core'],
    ['special', 'Special'],
    ['rare', 'Rare'],
    ['mercenaries', 'Mercenaries'],
    ['allies', 'Allies'],
  ]
  rosterCategories.forEach(([key, cat]) => {
    if (Array.isArray(json[key])) {
      json[key].forEach((e) => units.push(rosterEntryToUnit(e, cat, sourceKey)))
    }
  })
  return units
}

/** Fetch one dataset file and return parsed units (or use cache). */
async function loadOneDataset(filename) {
  const base = import.meta.env.BASE_URL || '/'
  const url = `${base}data/datasets/${filename}`
  const cached = getCached(filename)
  if (cached) return cached
  const res = await fetch(url)
  if (!res.ok) return []
  const json = await res.json()
  const sourceKey = filename.replace(/\.json$/i, '')
  const units = parseDatasetJson(json, sourceKey)
  setCache(filename, units)
  return units
}

/** Load all dataset files and return { eonir: [...], borderPrinces: [...], tombKings: [...] }. */
export async function loadAllDatasetUnits() {
  const result = {}
  const byFaction = {}
  for (const [filenameNoExt, factionId] of Object.entries(DATASET_FACTION_MAP)) {
    const filename = filenameNoExt + '.json'
    const units = await loadOneDataset(filename)
    if (!byFaction[factionId]) byFaction[factionId] = []
    byFaction[factionId].push(...units)
  }
  for (const [factionId, list] of Object.entries(byFaction)) {
    result[factionId] = list
  }
  return result
}
