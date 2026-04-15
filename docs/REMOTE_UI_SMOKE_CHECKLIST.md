# Remote SSH UI Smoke Checklist (10-minute)

Use this checklist for final pre-release sanity on a Remote SSH/HPC window.

## Preconditions
- VS Code is connected to the target host using Remote SSH.
- MD Viewer VSIX is installed on the **remote** extension host.
- You have one known-good local-control dataset and one Amber-style dataset path available on the remote filesystem.

## 1) Confirm remote extension install (1 minute)
1. Open Extensions view in the Remote SSH window.
2. Confirm `MD Viewer` is installed under `SSH: <host>`.
3. Open Command Palette and verify commands appear:
- `MD Viewer: Run Dependency Diagnostics`
- `MD Viewer: Select Python Interpreter`
- `MD Viewer: Bootstrap Remote Python Runtime`
- `Launch MD Viewer`

Pass criteria:
- Commands are present in remote window.

## 2) Diagnostics first-run check (1 minute)
1. Run `MD Viewer: Run Dependency Diagnostics`.
2. Confirm diagnostics output clearly shows:
- selected interpreter path
- remote host context (remote extension host)
- capability matrix (`coreRuntime`, `.parm7`, `.nc`, `bridgeScripts`)

Pass criteria:
- Diagnostics output is understandable and not empty.

## 3) Bootstrap + interpreter selection check (2 minutes)
1. If capabilities are blocked, run `MD Viewer: Bootstrap Remote Python Runtime`.
2. Run `MD Viewer: Select Python Interpreter` and pick the intended venv.
3. Re-run diagnostics.

Pass criteria:
- interpreter selection persists
- capability matrix improves after bootstrap/interpreter selection

## 4) Setup panel launch check (1 minute)
1. In Explorer, right-click a supported file and click `Launch MD Viewer`.
2. Confirm setup panel opens with defaults populated.
3. Confirm no obviously misleading runtime message appears.

Pass criteria:
- setup panel opens reliably and is actionable.

## 5) Known-good XYZ open (1 minute)
1. Launch MD Viewer on a known-good `.xyz` case.
2. Confirm viewer opens and frame controls are visible.

Pass criteria:
- load completes without dependency/runtime error.

## 6) Amber `.nc + .parm7` open (2 minutes)
1. Launch on `.nc` file and verify matching `.parm7` selection in setup panel.
2. Confirm dataset opens and frame slider/chunking works.

Pass criteria:
- `.nc + .parm7` open completes without fatal bridge/runtime error.

## 7) Amber `.dcd + .parm7` open (2 minutes)
1. Launch on `.dcd` file with matching `.parm7`.
2. Confirm dataset opens and stepping through frames works.

Pass criteria:
- `.dcd + .parm7` open completes without fatal bridge/runtime error.

## 8) One chunked binary sanity check (1 minute)
Use one of: `.xtc`, `.dcd`, `.trr`, `.nc`.
- Move slider forward enough to trigger chunk fetch.

Pass criteria:
- frame playback/scrub remains usable; no hard failure.

## Record result
- Mark each step as PASS/FAIL and attach screenshots or log snippets only for failures.
- If failures occur, include:
  - interpreter path from diagnostics
  - capability matrix
  - exact dataset pair
  - first actionable error text
