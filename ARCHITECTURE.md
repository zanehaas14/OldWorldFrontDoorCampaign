# Warhammer: The Old World Army Builder – Architecture

## Overview

This army builder supports:
- **Custom units, army rules, items** (from your legacy JSX or Supabase)
- **Google Drive integration** for shared custom data and lore
- **Unit verification on launch** against New Recruit / BSData
- **Cross-platform sharing** (mobile, Mac, Windows) via PWA + web URL

---

## Data Sources (Priority Order)

1. **Supabase** – If `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set, factions/units/items/rules come from Supabase.
2. **Local JSON** – `/public/data/*.json` (factions.json, units.json, items.json, rules.json).
3. **Google Drive** – Custom units, items, rules, lore merged in if configured.

### Google Drive Setup

1. Create a folder in Google Drive with your custom JSON files.
2. Share the folder as **Anyone with the link can view**.
3. You need **file IDs** (not folder IDs) for direct download. Options:
   - **Option A**: Create an `index.json` that maps keys to file IDs:
     ```json
     { "units": "FILE_ID_1", "items": "FILE_ID_2", "rules": "FILE_ID_3", "lore": "FILE_ID_4" }
     ```
   - **Option B**: Set `VITE_GOOGLE_DRIVE_FOLDER_ID` (folder ID) and use an `indexFileId` in config that points to that index file.
   - **Option C**: In-app settings to paste file IDs manually.

4. Export URL format: `https://drive.google.com/uc?export=download&id=FILE_ID`

**Note**: Browsers cannot list folder contents without OAuth. Use an index file or explicit file IDs.

### Custom Data Format

- **units**: Array of unit objects. Each unit should have `factionId` (e.g. `eonir`) to merge into the correct faction.
- **items**: Array of `{ name, pts, slot }` (slot: weapons, armour, talismans, arcane, enchanted, banners).
- **rules**: Array of `{ faction, rule }`.
- **lore**: Object mapping unit/faction IDs to markdown or HTML strings.

---

## Unit Verification (New Recruit)

- **New Recruit** uses BattleScribe (.cat) data from BSData GitHub.
- On launch, the app checks the GitHub API for the latest commit on `BSData/whfb` (or `BSData/warhammer-the-old-world` when available).
- If the remote has changed since the last check, a banner can prompt: "New unit data available. Consider refreshing."
- Throttled to once per hour to respect API limits.
- No authentication needed (public GitHub API).

---

## Sharing (Mobile + Desktop)

- Deploy the app to a **public URL** (e.g. Vercel, Netlify, GitHub Pages).
- Users open the URL on any device (phone, tablet, Mac, Windows).
- **PWA**: The app uses `vite-plugin-pwa` for installable experience and offline caching.
- **Supabase** (optional): Use Supabase for shared army lists and real-time sync across devices.

---

## File Structure

```
old-world-army-builder/
├── public/
│   └── data/
│       ├── factions.json
│       ├── units.json      # Run: node scripts/import-from-legacy.js path/to/army-builder.jsx
│       ├── items.json
│       └── rules.json
├── src/
│   ├── lib/
│   │   ├── dataService.js      # Main data loader, merges all sources
│   │   ├── googleDriveLoader.js
│   │   ├── unitVerification.js
│   │   └── supabase.js
│   └── bootstrap.js            # Launch verification
├── scripts/
│   └── import-from-legacy.js   # Imports DEFAULT_UNITS from legacy JSX
└── ARCHITECTURE.md
```

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_GOOGLE_DRIVE_FOLDER_ID` | (Optional) Default Google Drive folder ID |

---

## Importing from Legacy JSX

```bash
node scripts/import-from-legacy.js /path/to/army-builder-2-2.jsx
```

This extracts `DEFAULT_UNITS` and writes `public/data/units.json`. Run after updating the legacy file.
