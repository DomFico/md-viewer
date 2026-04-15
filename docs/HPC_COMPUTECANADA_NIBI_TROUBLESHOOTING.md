# Compute Canada / Alliance `nibi` Troubleshooting Reference

This guide is specific to one tested environment:

- VS Code Remote SSH
- Compute Canada / Alliance `nibi`
- cluster-managed Python, modules, and MPI-linked scientific packages

Use it as a troubleshooting reference, not as a universal guarantee for every HPC system. Other clusters may differ in module names, Python builds, MPI linkage, and package behavior.

This page is most useful when MD Viewer is already installed remotely, simpler workflows such as `.xyz`, `.dcd`, or `.xtc` are working, but `.nc` is still the stubborn format on this tested cluster path.

## What the problem looked like

The extension installed correctly and bootstrap improved the environment, but `.nc` still failed even when diagnostics looked partially encouraging.

That happened because Remote SSH/HPC is different from a local desktop flow:

- the extension host runs remotely
- Python packages come from the remote environment
- module state can change runtime behavior
- cluster-provided scientific builds may differ from upstream wheels

## What was actually wrong on `nibi`

There were multiple layers to the issue.

1. The default/system interpreter was not a usable runtime.
2. Bootstrap mostly fixed that by creating `~/.venvs/mdviewer`, installing core packages, and pointing `mdViewer.pythonInterpreter` at the new venv.
3. Bootstrap alone was not enough on this cluster, because it did not fully solve module inheritance for the Remote SSH extension host or the broken cluster-specific MDTraj NetCDF loader.
4. On this cluster, module inheritance still mattered for `.nc` support, and loading modules in an integrated terminal was not enough for the Remote SSH extension host.
5. A wrapper interpreter fixed that environment inheritance problem.
6. Even after the wrapper, the real remaining problem was the installed cluster-specific MDTraj build for `.nc`.

The broken MDTraj build reported itself as:

`netcdf_file.__init__() got an unexpected keyword argument 'format'`

That meant the remaining issue was not:

- the selected interpreter path
- the extension host location
- bootstrap itself
- missing bridge scripts

It was the actual MDTraj NetCDF runtime path in that specific environment.

## Working solution on the tested `nibi` path

### 1. Run diagnostics first

Start in the Remote SSH window with:

- `MD Viewer: Run Dependency Diagnostics`

If the system interpreter is blocked, that is expected on this cluster.

### 2. Bootstrap a user runtime

Use:

- `MD Viewer: Bootstrap Remote Python Runtime`

This mostly fixes the wrong-interpreter problem by creating and selecting:

- `~/.venvs/mdviewer`

### 3. Create a wrapper interpreter for module inheritance

On this tested cluster, loading modules in a terminal alone was not reliable enough for the Remote SSH extension host. The working fix was a wrapper like:

```bash
#!/bin/bash
source /etc/profile
module load StdEnv/2023 gcc/12.3 openmpi/4.1.5 mpi4py/4.1.0 >/dev/null 2>&1
exec /home/$USER/.venvs/mdviewer/bin/python "$@"
```

For example, save it as:

- `/home/<user>/bin/mdviewer-python`

Then set:

```json
{
  "mdViewer.pythonInterpreter": "/home/<user>/bin/mdviewer-python"
}
```

After that, reload the VS Code window and rerun diagnostics.

### 4. Replace the cluster MDTraj build with upstream

On this tested path, the cluster MDTraj build was the remaining `.nc` blocker.

Observed build versions:

- cluster build: `1.10.0+computecanada`
- working upstream build: `1.11.1.post1`

The working replacement command was:

```bash
source ~/.venvs/mdviewer/bin/activate
python -m pip install --upgrade --force-reinstall --no-cache-dir mdtraj==1.11.1.post1
```

### 5. Verify the real `.nc` path, not only imports

After the wrapper + MDTraj replacement, the tested path succeeded for:

- direct MDTraj load of the real `.nc` file
- bridge metadata reads
- bridge chunk reads
- `.nc` use inside the extension

That was the point where `.nc` became practically usable on this cluster.

## Why this is cluster-specific

HPC systems can differ because of:

- module systems
- MPI-linked Python packages
- cluster-managed wheelhouses
- custom package rebuilds
- ABI compatibility constraints

So while the pattern here is useful, another cluster may need different module loads, a different wrapper, or no wrapper at all.

## Recommended troubleshooting order

Use this order before concluding the extension is at fault:

1. Run `MD Viewer: Run Dependency Diagnostics`
2. Bootstrap or select a user-controlled interpreter
3. If the cluster uses modules, consider a wrapper interpreter for the extension host
4. Verify a real `.nc` load directly in the selected Python environment
5. Only then treat the issue as an extension/runtime integration problem

## General guidance vs `nibi`-specific guidance

General guidance:

- install the extension on the remote side
- run diagnostics
- bootstrap the runtime
- select the intended interpreter if needed

Specific to the tested `nibi` case:

- use a wrapper interpreter so module state is applied consistently to the Remote SSH extension host
- replace the cluster MDTraj build with upstream `mdtraj==1.11.1.post1` to restore working `.nc` behavior
