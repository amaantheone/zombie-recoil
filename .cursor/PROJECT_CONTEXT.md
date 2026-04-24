## Zombie Recoil (Vite + Three.js) — project context

This repo is a **vanilla JS** Three.js game + a simple in-browser **level editor**.

### Quick map of the repo
- **Entry**: `index.html` loads `src/main.js`
- **Game + editor**: `src/main.js` (route switch: `/edit` runs editor, otherwise runs game)
- **Assets/prefabs**: `src/assetLoader.js` (loads prefab models / builds instanced groups)
- **Maps**:
  - **Default**: `public/maps/level.json`
  - **Local draft**: `localStorage["zombieRecoil.level.v1"]`
- **Dev server API**: `vite.config.js` exposes `POST /api/save-map` to write `public/maps/level.json`

### Runtime routes
- **Game**: `/`
- **Editor**: `/edit` (also accepts `#/edit`)

### Core concepts (as implemented today)
- **Placements format**: array of objects with `{ type, position: {x,y,z}, rotation: {y}, scale? }`
  - `type` is normalized into one of `House | Silo | Frame | Barricade`
  - placements are **hard-locked to ground** (`position.y = 0` then y-offset applied per prefab)
- **Rendering perf**: both editor and game try to use **InstancedMesh** per prefab type
- **Collision**: cheap **AABB (Box3)** checks against placement boxes; “slide” resolves by axis separation

### Where to start reading
- **Route selection + high-level flow**: `src/main.js`
- **Editor UX + save/sync**: `runEditor()` in `src/main.js`
- **Game loop + movement/camera**: `runGame()` in `src/main.js`
- **Prefab loading / instancing**: `AssetLoader` in `src/assetLoader.js`

### Development
- **Dev**: `npm run dev`
- **Build**: `npm run build`
- **Preview**: `npm run preview`

