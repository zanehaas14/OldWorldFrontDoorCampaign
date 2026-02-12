/**
 * Unit verification and update from New Recruit / BSData sources.
 * Runs on launch: checks GitHub for latest BSData catalog versions,
 * optionally validates official unit points/rules against New Recruit wiki.
 *
 * New Recruit uses BattleScribe (.cat) data from BSData GitHub.
 * For Warhammer The Old World: New Recruit wiki links to catalogue data.
 * We verify by checking GitHub API for repo updates (BSData/whfb for legacy,
 * or warhammer-the-old-world style repos when available).
 */

const GITHUB_API = 'https://api.github.com'
const BSDATA_WHFB = 'BSData/whfb'
const BSDATA_OLD_WORLD = 'BSData/warhammer-the-old-world'

const STORAGE_KEYS = {
  lastCheck: 'tow_verification_last_check',
  lastCommitSha: 'tow_verification_last_sha',
  updateAvailable: 'tow_update_available',
}

/**
 * Check if we have a newer version of unit data available from remote sources.
 * Uses GitHub API (no auth needed for public repos) to compare latest commit.
 *
 * @returns {Promise<{ updated: boolean, message?: string, lastChecked: string }>}
 */
export async function checkForUnitUpdates() {
  const now = new Date().toISOString()
  const lastCheck = localStorage.getItem(STORAGE_KEYS.lastCheck)
  const lastSha = localStorage.getItem(STORAGE_KEYS.lastCommitSha)

  // Throttle: don't check more than once per hour
  if (lastCheck) {
    const elapsed = Date.now() - new Date(lastCheck).getTime()
    if (elapsed < 60 * 60 * 1000 && lastSha) {
      return {
        updated: false,
        lastChecked: lastCheck,
        message: 'Recent check already performed',
      }
    }
  }

  try {
    // Try Warhammer The Old World repo first (if BSData has one)
    let sha = null
    let repo = BSDATA_WHFB
    try {
      const res = await fetch(
        `${GITHUB_API}/repos/${BSDATA_OLD_WORLD}/commits/master`,
        { headers: { Accept: 'application/vnd.github.v3+json' } }
      )
      if (res.ok) {
        const data = await res.json()
        sha = data.sha
        repo = BSDATA_OLD_WORLD
      }
    } catch {
      // Fall back to whfb
    }

    if (!sha) {
      const res = await fetch(
        `${GITHUB_API}/repos/${BSDATA_WHFB}/commits/master`,
        { headers: { Accept: 'application/vnd.github.v3+json' } }
      )
      if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
      const data = await res.json()
      sha = data.sha
    }

    localStorage.setItem(STORAGE_KEYS.lastCheck, now)
    const hasUpdate = lastSha && lastSha !== sha
    if (hasUpdate) {
      localStorage.setItem(STORAGE_KEYS.lastCommitSha, sha)
      localStorage.setItem(STORAGE_KEYS.updateAvailable, 'true')
    } else if (!lastSha) {
      localStorage.setItem(STORAGE_KEYS.lastCommitSha, sha)
    }

    return {
      updated: hasUpdate,
      lastChecked: now,
      message: hasUpdate
        ? `New unit data available from ${repo}. Consider refreshing.`
        : 'Unit data is up to date.',
    }
  } catch (err) {
    console.warn('Unit verification check failed:', err)
    localStorage.setItem(STORAGE_KEYS.lastCheck, now)
    return {
      updated: false,
      lastChecked: now,
      message: 'Could not verify updates (offline or API limit).',
    }
  }
}

/**
 * Get New Recruit wiki URL for a faction (for manual verification).
 */
export function getNewRecruitWikiUrl(factionSlug) {
  const base = 'https://www.newrecruit.eu/wiki/tow/warhammer-the-old-world'
  if (!factionSlug) return base
  const map = {
    eonir: 'wood-elf-realms',
    tombKings: 'tomb-kings-of-khemri',
    lizardmen: 'lizardmen',
    borderPrinces: 'the-empire-of-man',
  }
  const slug = map[factionSlug] || factionSlug
  return `${base}/${slug}`
}

/**
 * Whether an update was detected (call after checkForUnitUpdates).
 */
export function hasUpdateAvailable() {
  return localStorage.getItem(STORAGE_KEYS.updateAvailable) === 'true'
}

export function clearUpdateFlag() {
  localStorage.removeItem(STORAGE_KEYS.updateAvailable)
}
