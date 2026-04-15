# MD Viewer Installation and Runtime Setup (Local + Remote SSH/HPC)

## 1) Install the extension VSIX

Local VSIX install:

```bash
code --install-extension /path/to/md-viewer-0.1.0-rc3.vsix --force
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

## 5) Optional bootstrap flow for Remote SSH/HPC

`MD Viewer: Bootstrap Remote Python Runtime` can:

1. Create `~/.venvs/mdviewer`
2. Upgrade `pip setuptools wheel`
3. Install `numpy scipy mdtraj`
4. Optionally install `netCDF4`
5. Set `mdViewer.pythonInterpreter`
6. Re-run diagnostics

If `netCDF4` fails due MPI/module linkage, load cluster modules and re-run diagnostics.

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
