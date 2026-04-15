# MD Viewer — VS Code Extension

A molecular dynamics dataset viewer for VS Code with setup-panel based loading, topology pairing, and chunked binary trajectory support.

---

## What it does

- Launch from Explorer on supported trajectory/topology files via **Launch MD Viewer**
- Resolve dataset pairings in a setup panel with override controls
- Render trajectories with residue-aware navigation and selection
- Support trajectories: `.xyz`, `.xtc`, `.dcd`, `.trr`, `.nc`, `.rst7`
- Support topologies: `.pdb`, `.gro`, `.parm7`
- Stream binary trajectories through metadata-first init + chunked frame requests

---

## Install from VSIX

```bash
code --install-extension md-viewer-0.1.0-rc3.vsix
```

Then run:
- **MD Viewer: Run Dependency Diagnostics**
- **MD Viewer: Select Python Interpreter** (if needed)
- **MD Viewer: Bootstrap Remote Python Runtime** (optional, useful on Remote SSH/HPC)

---

## Dependency notes

MD Viewer bridge/runtime dependencies:
- Python 3.10+ reachable by PATH or `mdViewer.pythonInterpreter`
- Python packages: `mdtraj`, `numpy`, `scipy` (and `netCDF4` recommended for some environments)

If you use VS Code Remote SSH, dependencies must be installed on the remote host where the extension host runs.

See deployment guide:
- [docs/INSTALLATION_LOCAL_REMOTE.md](docs/INSTALLATION_LOCAL_REMOTE.md)

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

## Current limitations

- Large systems may still require careful Python/runtime dependency setup
- Remote/HPC deployments require matching Python environment on remote extension host
- Marketplace publishing metadata may still evolve as release process stabilizes

---
