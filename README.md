# MD Viewer — VS Code Extension (v0.1 prototype)

A super-lightweight trajectory viewer for `.xyz` files, right inside VS Code.

---

## What it does

- Right-click any `.xyz` file in the Explorer → **Launch MD Viewer**
- Opens a webview panel with a Three.js point-cloud renderer
- Play/pause, scrub, and step through multi-frame XYZ trajectories
- Atoms coloured by element (CPK palette)
- Mouse drag to orbit, scroll to zoom, Space to play, arrow keys to step

---

## Prototype test asset

```
outputs/ala3_short_explicit_md/ala3_peptide_frames.xyz
```

21 frames, 33 atoms (alanine tripeptide).

---

## How to run the extension in VS Code

### 1. Install dependencies

```bash
cd vscode-md-viewer
npm install
```

### 2. Compile TypeScript

```bash
npm run compile
```

Or watch mode for iterative development:

```bash
npm run watch
```

### 3. Launch Extension Development Host

In VS Code:
- Open the `vscode-md-viewer` folder (or the repo root)
- Press **F5** (or go to Run → Start Debugging)
- VS Code will open a new **Extension Development Host** window

### 4. Open the trajectory

In the Extension Development Host window:
1. Open the `md-preview` repo folder
2. In the Explorer, expand `outputs/ala3_short_explicit_md/`
3. Right-click `ala3_peptide_frames.xyz`
4. Click **Launch MD Viewer**

The viewer panel opens and the trajectory begins at frame 1. Hit Play ▶ or press **Space**.

---

## Controls

| Control | Action |
|---------|--------|
| ▶ / ‖ button | Play / Pause |
| ◀ button | Previous frame |
| ▶▶ button | Next frame |
| Frame slider | Scrub to any frame |
| FPS slider | Change playback speed (1–60 fps) |
| ↺ button | Reset camera & return to frame 1 |
| Left-drag | Orbit camera |
| Scroll wheel | Zoom |
| **Space** | Play / Pause |
| **← / →** | Previous / Next frame |
| **Home / End** | Jump to first / last frame |

---

## Extension file layout

```
vscode-md-viewer/
  package.json          VS Code extension manifest
  tsconfig.json         TypeScript config
  src/
    extension.ts        Activation & command registration
    commands/
      openMdViewer.ts   File read, parse, open webview
    parsing/
      xyz.ts            Multi-frame XYZ parser
    webview/
      getHtml.ts        Generates the webview HTML
  media/
    viewer.js           Three.js renderer & playback engine
    viewer.css          Dark-mode UI styles
  out/                  Compiled JS (created by tsc)
```

---

## Current limitations (v0.1 prototype)

- Only `.xyz` format is supported
- No bond inference or topology pairing
- No solvent stripping
- No atom picking or measurement tools
- No side panel, no custom editor
- Camera auto-fit runs once at load; very large trajectories may be slow to parse
- CDN dependency on `cdn.jsdelivr.net` for Three.js (requires network access)

---

## Next steps (not yet implemented)

- Local Three.js bundle (no CDN dependency)
- `.gro` / `.pdb` / `.xtc` format support
- Bond inference from topology
- Trajectory statistics panel
- Atom picking / distance measurement
- VS Code webview-to-extension message API for lazy frame loading
