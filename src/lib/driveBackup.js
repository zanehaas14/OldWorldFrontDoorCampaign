/**
 * Army Builder — Backup & Restore
 *
 * Layer 1: Auto-snapshot to localStorage on every save (zero setup, instant).
 * Layer 2: Manual JSON export / import (download file, re-import to restore).
 * Layer 3: Google Drive OAuth2 auto-sync (requires Cloud project setup).
 */

// ─── Keys ───────────────────────────────────────────────────────────────────
const SNAPSHOT_KEY   = 'tow-backup-snapshot';
const DRIVE_TOKEN_KEY = 'tow-backup-drive-token';
const DRIVE_FILE_KEY  = 'tow-backup-drive-file-id'; // ID of backup file in Drive

const STORAGE_KEYS = {
  lists:   'tow-campaign-army-lists',
  units:   'tow-campaign-custom-units',
  overrides: 'tow-campaign-unit-overrides',
  rules:   'tow-campaign-house-rules-custom',
};

// ─── Snapshot (Layer 1) ──────────────────────────────────────────────────────

/** Called every time army lists are saved. Writes a timestamped snapshot. */
export function writeSnapshot(armyLists) {
  try {
    const snapshot = {
      at: Date.now(),
      version: 1,
      lists: armyLists,
      units: safeRead(STORAGE_KEYS.units),
      overrides: safeRead(STORAGE_KEYS.overrides),
      rules: safeRead(STORAGE_KEYS.rules),
    };
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch (e) {
    console.warn('[Backup] Snapshot write failed:', e);
  }
}

/** Returns { at: timestamp, lists, units, overrides, rules } or null. */
export function readSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeRead(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ─── Export / Import (Layer 2) ───────────────────────────────────────────────

/** Builds a full backup payload from current state. */
export function buildBackupPayload(armyLists) {
  return {
    appVersion: '1.0',
    exportedAt: new Date().toISOString(),
    lists:     armyLists,
    units:     safeRead(STORAGE_KEYS.units),
    overrides: safeRead(STORAGE_KEYS.overrides),
    rules:     safeRead(STORAGE_KEYS.rules),
  };
}

/** Triggers a .json file download in the browser. */
export function downloadBackup(armyLists) {
  const payload = buildBackupPayload(armyLists);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href     = url;
  a.download = `tow-army-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Parses an imported backup file.
 * Returns { lists, units, overrides, rules } or throws on bad format.
 */
export function parseBackupFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.lists) throw new Error('Missing lists field — not a valid backup.');
        resolve({
          lists:     data.lists     || {},
          units:     data.units     || [],
          overrides: data.overrides || {},
          rules:     data.rules     || [],
          exportedAt: data.exportedAt || null,
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsText(file);
  });
}

// ─── Google Drive OAuth2 (Layer 3) ───────────────────────────────────────────
// Requires a Google Cloud project with Drive API enabled and an OAuth2 Client ID.
// Client ID is set via VITE_GDRIVE_CLIENT_ID env var OR pasted in Settings.

const DRIVE_SCOPE   = 'https://www.googleapis.com/auth/drive.appdata';
const BACKUP_FNAME  = 'tow-army-builder-backup.json';

export function getDriveClientId() {
  return (
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GDRIVE_CLIENT_ID) ||
    localStorage.getItem('tow-gdrive-client-id') ||
    ''
  );
}

export function setDriveClientId(id) {
  localStorage.setItem('tow-gdrive-client-id', id.trim());
}

export function getDriveToken() {
  try {
    const raw = localStorage.getItem(DRIVE_TOKEN_KEY);
    if (!raw) return null;
    const { token, expiry } = JSON.parse(raw);
    if (Date.now() > expiry) { localStorage.removeItem(DRIVE_TOKEN_KEY); return null; }
    return token;
  } catch { return null; }
}

function storeDriveToken(token, expiresInSeconds) {
  localStorage.setItem(DRIVE_TOKEN_KEY, JSON.stringify({
    token,
    expiry: Date.now() + expiresInSeconds * 1000 - 60_000,
  }));
}

export function clearDriveToken() {
  localStorage.removeItem(DRIVE_TOKEN_KEY);
  localStorage.removeItem(DRIVE_FILE_KEY);
}

/**
 * Opens the Google OAuth2 popup and returns an access token.
 * Uses the implicit grant flow (no backend needed).
 */
export function authoriseDrive() {
  return new Promise((resolve, reject) => {
    const clientId = getDriveClientId();
    if (!clientId) return reject(new Error('No Google Client ID configured.'));

    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  window.location.origin + '/oauth2callback',
      response_type: 'token',
      scope:         DRIVE_SCOPE,
      prompt:        'select_account',
    });

    const popup = window.open(
      'https://accounts.google.com/o/oauth2/v2/auth?' + params,
      'gdrive_auth',
      'width=500,height=600,left=200,top=100'
    );

    const onMessage = (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'gdrive_token') {
        window.removeEventListener('message', onMessage);
        storeDriveToken(e.data.token, e.data.expiresIn);
        resolve(e.data.token);
      }
      if (e.data?.type === 'gdrive_error') {
        window.removeEventListener('message', onMessage);
        reject(new Error(e.data.message || 'Auth failed'));
      }
    };
    window.addEventListener('message', onMessage);

    // Fallback: detect popup closed
    const check = setInterval(() => {
      if (popup?.closed) {
        clearInterval(check);
        window.removeEventListener('message', onMessage);
        reject(new Error('Auth window closed.'));
      }
    }, 800);
  });
}

/** Save backup JSON to Drive appdata folder. */
export async function saveToDrive(armyLists) {
  let token = getDriveToken();
  if (!token) token = await authoriseDrive();

  const payload = JSON.stringify(buildBackupPayload(armyLists));
  const fileId  = localStorage.getItem(DRIVE_FILE_KEY);

  if (fileId) {
    // Update existing file
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: payload,
    });
  } else {
    // Create new file in appdata
    const meta = { name: BACKUP_FNAME, parents: ['appDataFolder'] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    form.append('file',     new Blob([payload],              { type: 'application/json' }));

    const res  = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const json = await res.json();
    if (json.id) localStorage.setItem(DRIVE_FILE_KEY, json.id);
    else throw new Error(json.error?.message || 'Could not create backup file in Drive.');
  }
}

/** Load backup JSON from Drive appdata folder. */
export async function loadFromDrive() {
  let token = getDriveToken();
  if (!token) token = await authoriseDrive();

  // Find the backup file
  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D%27${BACKUP_FNAME}%27&fields=files(id%2Cname)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const list = await listRes.json();
  const file = list.files?.[0];
  if (!file) throw new Error('No backup found in Google Drive.');

  localStorage.setItem(DRIVE_FILE_KEY, file.id);
  const dlRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return dlRes.json();
}

/** Formats a timestamp into a human-readable age string. */
export function formatAge(timestamp) {
  if (!timestamp) return 'never';
  const secs = Math.floor((Date.now() - timestamp) / 1000);
  if (secs < 60)   return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}
