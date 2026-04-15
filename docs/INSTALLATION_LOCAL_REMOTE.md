# MD Viewer Installation and Runtime Setup (Local + Remote SSH/HPC)

## 1) Install the extension VSIX

Local VSIX install:

```bash
code --install-extension /path/to/md-viewer-0.1.0-rc2.vsix --force
```

On Remote SSH windows, install the extension on the remote side (from the command palette or `code` CLI in a remote-capable session).

## 2) Configure Python runtime

MD Viewer runs bridge scripts through Python in the extension host environment.

Required packages:

```bash
python -m pip install mdtraj numpy scipy netCDF4
```

Configure interpreter (optional but recommended for multi-env systems):

- Command palette: `MD Viewer: Select Python Interpreter`
- Settings key: `mdViewer.pythonInterpreter`

Example setting:

```json
{
  "mdViewer.pythonInterpreter": "/path/to/python"
}
```

## 3) Run diagnostics

Run:

- `MD Viewer: Run Dependency Diagnostics`

Diagnostics report includes:

- extension host location (`local` vs `remote (<name>)`)
- selected Python executable and resolved path
- import checks (`mdtraj`, `numpy`, `scipy`, `netCDF4`)
- bridge script presence
- runtime capability summary

If diagnostics fail, use:

- `MD Viewer: Select Python Interpreter`
- install missing Python packages in the same host where the extension runs

## 4) Local vs Remote SSH/HPC behavior

When VS Code is connected to a remote machine:

- extension host runs remotely
- Python and packages must exist on that remote machine
- diagnostics must pass on that remote host

This is the most common setup issue: local machine has packages, but remote host does not.

## 5) Smoke-test after install

Recommended quick checks:

1. Open a known-good dataset and run **Launch MD Viewer**.
2. Verify setup panel defaults populate and load succeeds.
3. Run `MD Viewer: Run Dependency Diagnostics` and confirm required deps are available.

## 6) Troubleshooting

### Error: Python executable not found

- Set `mdViewer.pythonInterpreter` to a valid path
- or ensure `python` is available in PATH for extension host process

### Error: `No module named mdtraj`

- Install packages into the interpreter used by `mdViewer.pythonInterpreter`
- Re-run diagnostics and confirm import checks are `ok`

### Bridge script missing

- Reinstall extension VSIX
- Verify installation completed without truncation
