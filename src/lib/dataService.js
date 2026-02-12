/**
 * Data service: fetches factions, units, items, rules.
 * - If Supabase is configured: fetches from Supabase (real-time updates)
 * - Otherwise: fetches from /data/*.json (updates on deploy)
 * - Merges in custom units/items/rules from Google Drive if configured
 */

import { supabase, isSupabaseEnabled } from './supabase'
import { loadCustomDataFromDrive } from './googleDriveLoader'

const CACHE = { factions: null, units: null, items: null, rules: null, customData: null }

async function fetchJson(path) {
  const base = import.meta.env.BASE_URL || '/'
  const res = await fetch(`${base}data/${path}`)
  if (!res.ok) throw new Error(`Failed to fetch ${path}`)
  return res.json()
}

/** Merge custom units into by-faction map. Custom units need factionId. */
function mergeUnits(base, custom) {
  if (!custom?.length) return base
  const merged = { ...base }
  for (const u of custom) {
    const fid = u.factionId || u.faction_id || 'eonir'
    if (!merged[fid]) merged[fid] = []
    merged[fid].push({ ...u, isCustom: true })
  }
  return merged
}

/** Merge custom items into by-slot map. Base uses keys like weapons, armour, talismans. */
function mergeItems(base, custom) {
  if (!custom?.length) return base
  const merged = JSON.parse(JSON.stringify(base))
  const slotMap = { Weapon: 'weapons', weapon: 'weapons', Armour: 'armour', armour: 'armour', Talisman: 'talismans', talisman: 'talismans', Arcane: 'arcane', arcane: 'arcane', Enchanted: 'enchanted', enchanted: 'enchanted', Banner: 'banners', banner: 'banners' }
  for (const i of custom) {
    const slot = i.slot || 'Weapon'
    const key = slotMap[slot] || slot.toLowerCase() || 'weapons'
    if (!merged[key]) merged[key] = []
    merged[key].push({ name: i.name, pts: i.pts ?? i.ptsCost ?? 0 })
  }
  return merged
}

/** Merge custom rules into array. */
function mergeRules(base, custom) {
  if (!custom?.length) return base
  return [...base, ...custom.map((r) => (typeof r === 'string' ? { faction: 'Custom', rule: r } : r))]
}

async function getFactions() {
  if (CACHE.factions) return CACHE.factions
  if (isSupabaseEnabled()) {
    const { data, error } = await supabase.from('factions').select('*').order('id')
    if (!error && data) {
      const map = {}
      data.forEach((f) => { map[f.id] = f.config })
      CACHE.factions = map
      return map
    }
  }
  const data = await fetchJson('factions.json')
  CACHE.factions = data
  return data
}

async function getUnits() {
  if (CACHE.units) return CACHE.units
  let base
  if (isSupabaseEnabled()) {
    const { data, error } = await supabase.from('units').select('*').order('faction_id').order('category').order('name')
    if (!error && data) {
      base = {}
      data.forEach((u) => {
        const fid = u.faction_id
        if (!base[fid]) base[fid] = []
        base[fid].push(u.data)
      })
    }
  }
  if (!base) base = await fetchJson('units.json')
  const custom = await loadCustomDataFromDrive()
  CACHE.units = mergeUnits(base, custom?.units)
  return CACHE.units
}

async function getItems() {
  if (CACHE.items) return CACHE.items
  let base
  if (isSupabaseEnabled()) {
    const { data, error } = await supabase.from('magic_items').select('*')
    if (!error && data) {
      base = {}
      data.forEach((i) => {
        const slot = i.slot
        if (!base[slot]) base[slot] = []
        base[slot].push({ name: i.name, pts: i.pts })
      })
    }
  }
  if (!base) base = await fetchJson('items.json')
  const custom = await loadCustomDataFromDrive()
  CACHE.items = mergeItems(base, custom?.items)
  return CACHE.items
}

async function getRules() {
  if (CACHE.rules) return CACHE.rules
  let base
  if (isSupabaseEnabled()) {
    const { data, error } = await supabase.from('house_rules').select('*').order('faction')
    if (!error && data) {
      base = data.map((r) => ({ faction: r.faction, rule: r.rule }))
    }
  }
  if (!base) base = await fetchJson('rules.json')
  const custom = await loadCustomDataFromDrive()
  CACHE.rules = mergeRules(Array.isArray(base) ? base : [], custom?.rules)
  return CACHE.rules
}

/** Get lore map from Google Drive custom data. */
export async function getLore() {
  const custom = await loadCustomDataFromDrive()
  return custom?.lore ?? {}
}

export async function loadAllData() {
  const [factions, units, items, rules] = await Promise.all([
    getFactions(),
    getUnits(),
    getItems(),
    getRules(),
  ])
  return { factions, units, items, rules }
}

export function clearCache() {
  CACHE.factions = CACHE.units = CACHE.items = CACHE.rules = CACHE.customData = null
}
