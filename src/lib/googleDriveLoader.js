/**
 * Load custom units, items, and lore from a shared Google Drive folder.
 *
 * Setup:
 * 1. Create a folder in Google Drive with your custom JSON files.
 * 2. Share the folder as "Anyone with the link can view" (or use a service account).
 * 3. Set VITE_GOOGLE_DRIVE_FOLDER_ID in .env
 *
 * Expected file structure in the folder:
 *   - custom-units.json    Array of unit objects (same shape as your DEFAULT_UNITS)
 *   - custom-items.json    Array of magic items
 *   - custom-rules.json    Array of army rules
 *   - lore/                (optional) Folder with markdown files per unit/faction
 *
 * For public folders, we use the export URL format:
 *   https://drive.google.com/uc?export=download&id=FILE_ID
 *
 * You need to get file IDs from the shared folder. Options:
 * A) Use a server/proxy to list folder contents (requires OAuth or service account)
 * B) Manually specify file IDs in config
 * C) Use a public index.json that lists file IDs
 */

const CONFIG_KEY = 'tow_google_drive_config'
const CACHE_KEY = 'tow_google_drive_cache'
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Get stored Google Drive config (folder ID or file IDs).
 * Set via Settings or .env: VITE_GOOGLE_DRIVE_FOLDER_ID
 */
export function getGoogleDriveConfig() {
  const fromEnv = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID
  if (fromEnv) {
    return { folderId: fromEnv, fileIds: null }
  }
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setGoogleDriveConfig(config) {
  if (!config) {
    localStorage.removeItem(CONFIG_KEY)
    localStorage.removeItem(CACHE_KEY)
    return
  }
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  localStorage.removeItem(CACHE_KEY)
}

/**
 * Fetch a single file from Google Drive by ID (public link).
 * Use format: https://drive.google.com/uc?export=download&id=FILE_ID
 */
async function fetchDriveFile(fileId) {
  const url = `https://drive.google.com/uc?export=download&id=${fileId}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch file ${fileId}: ${res.status}`)
  return res.json()
}

/**
 * Fetch an index file that maps names to file IDs.
 * If folderId is set, we can't list it from client without auth.
 * So we expect either:
 * - Explicit fileIds in config: { fileIds: { units: 'xxx', items: 'yyy' } }
 * - Or an index file ID that returns { units: 'id', items: 'id', ... }
 */
export async function loadCustomDataFromDrive() {
  const config = getGoogleDriveConfig()
  if (!config) return null

  const cached = getCachedData()
  if (cached) return cached

  const fileIds = config.fileIds || {}
  if (config.indexFileId) {
    try {
      const index = await fetchDriveFile(config.indexFileId)
      Object.assign(fileIds, index)
    } catch (e) {
      console.warn('Could not fetch Google Drive index:', e)
      return null
    }
  }

  const result = { units: [], items: [], rules: [], lore: {} }
  const promises = []

  if (fileIds.units) {
    promises.push(
      fetchDriveFile(fileIds.units).then((data) => {
        result.units = Array.isArray(data) ? data : data.units || []
      })
    )
  }
  if (fileIds.items) {
    promises.push(
      fetchDriveFile(fileIds.items).then((data) => {
        result.items = Array.isArray(data) ? data : data.items || []
      })
    )
  }
  if (fileIds.rules) {
    promises.push(
      fetchDriveFile(fileIds.rules).then((data) => {
        result.rules = Array.isArray(data) ? data : data.rules || []
      })
    )
  }
  if (fileIds.lore) {
    promises.push(
      fetchDriveFile(fileIds.lore).then((data) => {
        result.lore = data && typeof data === 'object' ? data : {}
      })
    )
  }

  try {
    await Promise.all(promises)
    setCachedData(result)
    return result
  } catch (e) {
    console.warn('Could not load custom data from Google Drive:', e)
    return null
  }
}

function getCachedData() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { data, at } = JSON.parse(raw)
    if (Date.now() - at > CACHE_TTL_MS) return null
    return data
  } catch {
    return null
  }
}

function setCachedData(data) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ data, at: Date.now() })
    )
  } catch {
    // ignore
  }
}

/**
 * Clear the cache (e.g. after config change or manual refresh).
 */
export function clearGoogleDriveCache() {
  localStorage.removeItem(CACHE_KEY)
}
