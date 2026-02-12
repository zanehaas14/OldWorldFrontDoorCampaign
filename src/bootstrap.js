/**
 * Launch bootstrap: runs on app load.
 * - Verifies unit data against New Recruit / BSData (GitHub)
 * - Optionally loads custom data from Google Drive
 */

import { checkForUnitUpdates, hasUpdateAvailable } from './lib/unitVerification'

const BOOT_KEY = 'tow_boot_done'

/** Run verification in background; don't block initial render. */
export async function runLaunchVerification() {
  try {
    const result = await checkForUnitUpdates()
    return result
  } catch (e) {
    console.warn('Launch verification failed:', e)
    return { updated: false, message: 'Verification failed' }
  }
}

/** True if an update was previously detected. */
export function isUpdateAvailable() {
  return hasUpdateAvailable()
}
