# MD Viewer Installation and Runtime Setup (Local + Remote SSH/HPC)

## 1) Install the extension VSIX

Local VSIX install:

```bash
code --install-extension /path/to/md-viewer-<version>.vsix --force
```

On Remote SSH windows, install the extension on the remote side (command palette or remote `code` CLI session).

## 2) Interpreter selection model (important on HPC)

MD Viewer executes Python bridge scripts in the extension host.

- Local window: extension host is local.
- Remote SSH window: extension host is remote.

Interpreter priority:

1. `mdViewer.pythonInterpreter` (explicit setting)
2. Last-known-good validated interpreter for this host/workspace
3. Common venv locations (`~/.venvs/mdviewer/bin/python`, `.venv/bin/python`, etc.)
4. Environment defaults (`python`, `python3`)

This prevents silently sticking to broken system Python when a working user venv exists.

## 3) Commands for runtime setup

- `MD Viewer: Run Dependency Diagnostics`
- `MD Viewer: Select Python Interpreter`
- `MD Viewer: Bootstrap Remote Python Runtime`

Setting:

```json
{
  "mdViewer.pythonInterpreter": "/path/to/python"
}
```

## 4) Capability-based diagnostics output

Diagnostics now report capability families separately:

- **Core runtime** (`mdtraj`, `numpy`, `scipy`)
- **Amber topology (.parm7)**
- **NetCDF trajectories (.nc)**
- **Binary bridge scripts**

Status model:

- `OK`: ready on selected interpreter
- `DEGRADED`: partially usable / host-dependent (common for `.nc` on HPC without full netCDF stack)
- `BLOCKED`: not runnable until missing requirements are fixed

Supported dataset notes:
- common trajectories include `.xyz`, `.xtc`, `.dcd`, `.trr`, `.nc`, `.rst7`, `.inpcrd`, and `.mdcrd`
- common topologies include `.pdb`, `.gro`, `.parm7`, and `.prmtop`
- DNA/RNA systems use nucleic-acid backbone trace anchors when topology metadata is available
- Amber-family topology/trajectory pairings must have matching atom counts

## 5) Optional bootstrap flow for Remote SSH/HPC

`MD Viewer: Bootstrap Remote Python Runtime` can:

1. Create `~/.venvs/mdviewer`
2. Upgrade `pip setuptools wheel`
3. Run a Python/runtime preflight (`Python.h`, include dir, platform, Python version)
4. Probe for an MDTraj binary wheel before installing core packages
5. Install `numpy scipy mdtraj`
6. Optionally install `netCDF4`
7. Set `mdViewer.pythonInterpreter`
8. Re-run diagnostics

If `netCDF4` fails due MPI/module linkage, load cluster modules and re-run diagnostics.

Python 3.10+ remains the preferred bootstrap path. Python 3.9 on managed HPC systems is best-effort / legacy: if no compatible MDTraj wheel is available, pip may otherwise fall into a source build that needs `Python.h` / `python3-devel`, which many clusters do not expose to users. MD Viewer now probes wheel availability first and surfaces clearer guidance instead of silently continuing into an opaque source-build failure.

Advanced bootstrap settings:
- `mdViewer.bootstrapPipExtraArgs`: append extra pip flags, such as custom package indexes
- `mdViewer.bootstrapPackageOverrides`: override package specs, such as `{ "mdtraj": "mdtraj==1.11.1.post1" }`
- `mdViewer.bootstrapAllowSourceBuild`: allow source builds when no MDTraj wheel is available; disabled by default because it commonly fails on managed HPC systems without development headers

When a Python 3.9 runtime has no modern MDTraj wheel and no explicit package overrides, bootstrap may try a targeted legacy fallback (`numpy<2`, `scipy<1.14`, `mdtraj<1.10`) rather than making those older constraints the default for everyone.

Latest tested HPC outcome for this release branch:
- fresh system interpreter can start `BLOCKED` (expected)
- bootstrap/interpreter selection can recover to usable runtime
- `.parm7` and `.nc` bridge paths are expected to work after recovery on the validated cluster path
- for the tested Compute Canada / Alliance `nibi` environment, see [HPC_COMPUTECANADA_NIBI_TROUBLESHOOTING.md](HPC_COMPUTECANADA_NIBI_TROUBLESHOOTING.md)

## 6) Typical HPC package install (manual)

If you prefer manual setup:

```bash
python3 -m venv ~/.venvs/mdviewer
~/.venvs/mdviewer/bin/python -m pip install --upgrade pip setuptools wheel
~/.venvs/mdviewer/bin/python -m pip install --upgrade numpy scipy mdtraj
# optional, if supported by cluster environment:
~/.venvs/mdviewer/bin/python -m pip install --upgrade netCDF4
```

Then set:

```json
{
  "mdViewer.pythonInterpreter": "~/.venvs/mdviewer/bin/python"
}
```

## 7) Graceful failure guidance during open

If runtime requirements are missing, open attempts now show format-specific actions, e.g.:

- `.parm7` blocked by missing core runtime packages
- `.nc` unavailable/degraded on current interpreter
- bridge scripts present vs actually missing (reported separately)

Recommended next steps in error prompts:

1. Run diagnostics
2. Select interpreter
3. Bootstrap remote runtime

## 8) Smoke-test checklist

1. Run `MD Viewer: Run Dependency Diagnostics`
2. Confirm selected interpreter and capability matrix are sensible
3. Open a known-good dataset via **Launch MD Viewer**
4. On Remote SSH/HPC, confirm diagnostics were run on the remote extension host
5. For quick manual validation, use [REMOTE_UI_SMOKE_CHECKLIST.md](REMOTE_UI_SMOKE_CHECKLIST.md)
