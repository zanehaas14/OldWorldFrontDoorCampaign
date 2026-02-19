/**
 * Load unit data from BattleScribe catalogues on GitHub.
 * Default: vflam/Warhammer-The-Old-World (TOW 2024 data). Override with VITE_BSDATA_REPO / VITE_BSDATA_BRANCH.
 */

const RAW_BASE = 'https://raw.githubusercontent.com'

const DEFAULT_REPO = 'vflam/Warhammer-The-Old-World'
const DEFAULT_BRANCH = 'main'

/** Map our faction keys to .cat filename in the repo (vflam/Warhammer-The-Old-World). */
export const FACTION_CATALOGUES = {
  eonir: 'Wood Elf Realms.cat',
  tombKings: 'Tomb Kings of Khemri.cat',
  lizardmen: 'Lizardmen.cat',
  borderPrinces: 'The Empire of Man.cat',
}

const CACHE_PREFIX = 'tow_bsdata_'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h

function cacheKey(repo, filename) {
  return `${CACHE_PREFIX}${repo.replace('/', '_')}_${filename}`
}

function getCached(repo, filename) {
  try {
    const key = cacheKey(repo, filename)
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { data, at } = JSON.parse(raw)
    if (Date.now() - at > CACHE_TTL_MS) return null
    return data
  } catch {
    return null
  }
}

function setCache(repo, filename, data) {
  try {
    const key = cacheKey(repo, filename)
    localStorage.setItem(key, JSON.stringify({ data, at: Date.now() }))
  } catch {
    // ignore
  }
}

/**
 * Fetch raw XML from GitHub.
 */
async function fetchCatRaw(repo, branch, filename) {
  const url = `${RAW_BASE}/${repo}/${branch}/${encodeURIComponent(filename)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`BSData fetch failed: ${res.status} ${filename}`)
  return res.text()
}

// Namespace-agnostic helpers (BattleScribe uses default xmlns)
function byLocalName(el, localName) {
  if (!el) return null
  for (const child of el.children) {
    if (child.localName === localName) return child
  }
  return null
}
function allByLocalName(el, localName) {
  if (!el) return []
  return Array.from(el.children).filter((c) => c.localName === localName)
}

function getPointsCost(costsEl) {
  if (!costsEl) return null
  for (const cost of costsEl.children) {
    if (cost.localName !== 'cost') continue
    if (cost.getAttribute('name') === 'pts') {
      const v = cost.getAttribute('value')
      return v != null ? parseFloat(v) : null
    }
  }
  return null
}

function getMinMax(constraintsEl) {
  let min = null
  let max = null
  if (!constraintsEl) return { min, max }
  for (const c of constraintsEl.children) {
    if (c.localName !== 'constraint') continue
    if (c.getAttribute('field') !== 'selections') continue
    const type = c.getAttribute('type')
    const val = parseFloat(c.getAttribute('value'))
    if (Number.isNaN(val)) continue
    if (type === 'min') min = val
    if (type === 'max' && val > 0) max = val
  }
  return { min, max }
}

/**
 * Parse .cat XML text into array of units (our app shape).
 * Only top-level selectionEntry type="unit" to keep it simple.
 */
function parseCatXml(xmlText) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'text/xml')
  const err = doc.documentElement.querySelector('parsererror') || doc.querySelector('parsererror')
  if (err) throw new Error('BSData XML parse error: ' + (err.textContent || 'unknown'))

  const root = doc.documentElement
  const rootEntries = byLocalName(root, 'selectionEntries')
  if (!rootEntries) return []

  const units = []
  for (const entry of allByLocalName(rootEntries, 'selectionEntry')) {
    const type = entry.getAttribute('type')
    if (type !== 'unit') continue
    const n = entry.getAttribute('name')
    const id = entry.getAttribute('id')
    const hidden = entry.getAttribute('hidden') === 'true'
    if (hidden) continue
    const costsEl = byLocalName(entry, 'costs')
    const pts = getPointsCost(costsEl)
    const { min, max } = getMinMax(byLocalName(entry, 'constraints'))
    const isCharacter = /lord|hero|character|wizard|sorcerer|king|queen|prince|mage|necromancer|priest/i.test(n)
    units.push({
      id: (id || n).replace(/\s+/g, '_').replace(/[^a-z0-9_-]/gi, '').slice(0, 64),
      name: n,
      category: 'Core',
      ptsPerModel: !isCharacter ? (pts ?? 0) : undefined,
      ptsCost: isCharacter ? (pts ?? 0) : undefined,
      isCharacter: !!isCharacter,
      minSize: min ?? 1,
      maxSize: max ?? 99,
      troopType: '',
      equipment: [],
      specialRules: [],
      profiles: [],
      notes: 'From Warhammer: The Old World catalogue (vflam/Warhammer-The-Old-World).',
    })
  }
  return units
}

/**
 * Load units for one faction from BSData. Returns array of unit objects.
 */
export async function loadUnitsFromBsdataForFaction(factionKey) {
  const filename = FACTION_CATALOGUES[factionKey]
  if (!filename) return null

  const repo = import.meta.env.VITE_BSDATA_REPO || DEFAULT_REPO
  const branch = import.meta.env.VITE_BSDATA_BRANCH || DEFAULT_BRANCH

  const cached = getCached(repo, filename)
  if (cached) return cached

  const xmlText = await fetchCatRaw(repo, branch, filename)
  const units = parseCatXml(xmlText)
  setCache(repo, filename, units)
  return units
}

/**
 * Load units from BSData for all mapped factions. Returns { tombKings: [...], lizardmen: [...], borderPrinces: [...] }.
 */
export async function loadAllBsdataUnits() {
  const result = {}
  for (const factionKey of Object.keys(FACTION_CATALOGUES)) {
    try {
      const units = await loadUnitsFromBsdataForFaction(factionKey)
      if (units && units.length) result[factionKey] = units
    } catch (e) {
      console.warn(`BSData load failed for ${factionKey}:`, e)
    }
  }
  return result
}

export function clearBsdataCache() {
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(CACHE_PREFIX)) keys.push(k)
  }
  keys.forEach((k) => localStorage.removeItem(k))
}

export function isBsdataEnabled() {
  try {
    return localStorage.getItem('tow_use_bsdata') === 'true'
  } catch {
    return false
  }
}

export function setBsdataEnabled(enabled) {
  if (enabled) localStorage.setItem('tow_use_bsdata', 'true')
  else localStorage.removeItem('tow_use_bsdata')
}
