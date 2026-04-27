# zombie-recoil

Vite + vanilla JS + Three.js zombie game with a built-in level editor.

## Modes / routes

- **Game**: `/`
- **Editor**: `/edit` (also supports `#/edit`)

## Run locally

```bash
npm install
npm run dev
```

Then open:
- `http://localhost:5173/` for the game
- `http://localhost:5173/edit` for the editor

## Level data

- **Default level file**: `public/maps/level.json` (served at `/maps/level.json`)
- **Format**: array of placements:
  - `{ type, position: {x,y,z}, rotation: {y}, scale? }`
  - `type` is normalized to `House | Silo | Frame | Barricade`

## Editor controls (quick)

- **Click**: place/select
- **W/A/S/D**: move selected (snap)
- **R**: rotate 90°
- **Esc**: cancel placement

## Saving in editor (important)

The editor writes to two places:
- **Local**: browser `localStorage` key `zombieRecoil.level.v1`
- **Disk (dev only)**: `POST /api/save-map` which writes `public/maps/level.json`

`/api/save-map` is implemented via Vite dev server middleware in `vite.config.js`, so it **only exists while running `npm run dev`**.

## Build / preview

```bash
npm run build
npm run preview
```

This produces a static build in `dist/`.

## Deployment

### Static hosting (recommended for the game)

Deploy the `dist/` folder to any static host (GitHub Pages, Netlify, Cloudflare Pages, S3+CloudFront, etc.).

Note: on static hosting there is **no** `/api/save-map`, so the editor cannot save back to `public/maps/level.json`. Ship a baked `public/maps/level.json` instead, or add a backend endpoint for saving.

