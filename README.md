# Warhammer: The Old World Army Builder

A narrative campaign army builder for Warhammer: The Old World, with custom units, army rules, and magic items. Supports Google Drive for shared custom data and verifies unit info against New Recruit / BSData on launch.

## Features

- **Custom content**: Units, army rules, magic items, and lore
- **Google Drive**: Pull custom units and lore from a shared folder
- **Launch verification**: Check for updates against New Recruit / BSData (GitHub)
- **Cross-platform**: Share via URL – works on mobile, Mac, and Windows
- **PWA**: Installable, works offline after first load

## Quick Start

```bash
npm install
npm run dev
```

## Import Units from Legacy JSX

You can import from any of your JSX versions:

| File | Notes |
|------|--------|
| `army-builder.jsx` | Earliest – UNIT_CATEGORIES without "Characters" |
| `army-builder-2.jsx` | Adds "Characters" category |
| `army-builder-2-2.jsx` | Latest / most complete |

```bash
# Import from a specific file
node scripts/import-from-legacy.js /path/to/army-builder-2-2.jsx

# Or run with no args: uses ../Downloads and picks first found of 2-2, 2, or 1
node scripts/import-from-legacy.js
```

This writes `public/data/units.json`.

## Google Drive Setup

1. Create a folder with JSON files: `custom-units.json`, `custom-items.json`, etc.
2. Share as **Anyone with the link can view**.
3. Create an index file or set file IDs in `.env`:
   ```
   VITE_GOOGLE_DRIVE_FOLDER_ID=your_folder_id
   ```
4. See [ARCHITECTURE.md](./ARCHITECTURE.md) for data formats.

## New Recruit Verification

On launch, the app checks GitHub for BSData catalog updates. If new data is available, a banner appears. Throttled to once per hour.

## Deploy for Sharing

Deploy to Vercel, Netlify, or GitHub Pages. Users can open the URL on any device.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL (optional) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (optional) |
| `VITE_GOOGLE_DRIVE_FOLDER_ID` | Google Drive folder ID (optional) |

## License

Private / for personal use.
