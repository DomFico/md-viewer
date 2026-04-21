import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { emitCheckpoint } from '../runtimeCheckpoint';
import { hostContextInfo } from '../runtime/hostRuntimeState';
import { preferredPythonExecutable, resolveExecutablePath } from '../runtime/pythonRuntime';

type BootstrapStep = {
  id: string;
  command: string;
  args: string[];
};

type BootstrapStepResult = {
  id: string;
  ok: boolean;
  exitCode: number | null;
  stderr: string;
  stdout: string;
  spawnError?: string;
};

type BootstrapPreflight = {
  pythonVersion: string | null;
  versionInfo: number[];
  platform: string | null;
  includeDir: string | null;
  pythonHExists: boolean | null;
  executable: string | null;
  error?: string;
};

type BootstrapFailureGuidance = {
  category: string;
  summary: string;
  details: string[];
};

const PREFLIGHT_SNIPPET = `
import json, os, pathlib, platform, sys, sysconfig
include_dir = sysconfig.get_paths().get("include") or sysconfig.get_config_var("INCLUDEPY") or ""
python_h = pathlib.Path(include_dir) / "Python.h" if include_dir else None
print(json.dumps({
    "pythonVersion": sys.version.split()[0],
    "versionInfo": list(sys.version_info[:3]),
    "platform": platform.platform(),
    "includeDir": include_dir,
    "pythonHExists": bool(python_h and python_h.exists()),
    "executable": sys.executable,
}))
`;

function settingTarget(): vscode.ConfigurationTarget {
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    return vscode.ConfigurationTarget.Workspace;
  }
  return vscode.ConfigurationTarget.Global;
}

function summarizeText(text: string, limit = 240): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...[truncated ${text.length - limit} chars]`;
}

async function runStep(output: vscode.OutputChannel, step: BootstrapStep): Promise<BootstrapStepResult> {
  output.appendLine(`$ ${step.command} ${step.args.join(' ')}`);
  return await new Promise((resolve) => {
    const child = spawn(step.command, step.args, {
      env: process.env,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      output.append(chunk.toString('utf8'));
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      output.append(chunk.toString('utf8'));
    });

    child.on('close', (code: number | null) => {
      resolve({
        id: step.id,
        ok: code === 0,
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });

    child.on('error', (err: unknown) => {
      resolve({
        id: step.id,
        ok: false,
        exitCode: null,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        spawnError: err instanceof Error ? err.message : String(err),
      });
    });
  });
}

function parseJsonObjectFromText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Keep scanning earlier lines; pip and Python wrappers can print banners.
    }
  }
  return null;
}

function parsePreflight(result: BootstrapStepResult): BootstrapPreflight {
  if (!result.ok) {
    return {
      pythonVersion: null,
      versionInfo: [],
      platform: null,
      includeDir: null,
      pythonHExists: null,
      executable: null,
      error: result.spawnError || result.stderr || result.stdout || 'Python preflight command failed',
    };
  }
  const parsed = parseJsonObjectFromText(result.stdout);
  if (!parsed) {
    return {
      pythonVersion: null,
      versionInfo: [],
      platform: null,
      includeDir: null,
      pythonHExists: null,
      executable: null,
      error: 'Python preflight did not return JSON',
    };
  }
  const versionInfo = Array.isArray(parsed.versionInfo)
    ? parsed.versionInfo.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];
  return {
    pythonVersion: typeof parsed.pythonVersion === 'string' ? parsed.pythonVersion : null,
    versionInfo,
    platform: typeof parsed.platform === 'string' ? parsed.platform : null,
    includeDir: typeof parsed.includeDir === 'string' ? parsed.includeDir : null,
    pythonHExists: typeof parsed.pythonHExists === 'boolean' ? parsed.pythonHExists : null,
    executable: typeof parsed.executable === 'string' ? parsed.executable : null,
  };
}

function isPython39(preflight: BootstrapPreflight): boolean {
  return preflight.versionInfo[0] === 3 && preflight.versionInfo[1] === 9;
}

function hasMissingPythonHeadersSignal(result: BootstrapStepResult): boolean {
  const combined = `${result.stderr}\n${result.stdout}\n${result.spawnError || ''}`.toLowerCase();
  return combined.includes('python.h')
    || combined.includes('python3-devel')
    || combined.includes('python-dev')
    || combined.includes('failed building wheel')
    || combined.includes('error: command') && combined.includes('gcc');
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function asPackageOverrides(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string' && raw.trim().length > 0) {
      out[key] = raw.trim();
    }
  }
  return out;
}

function packageRequirement(packageName: string, fallback: string, overrides: Record<string, string>): string {
  return overrides[packageName] || fallback;
}

function modernCoreRequirements(overrides: Record<string, string>): string[] {
  return [
    packageRequirement('numpy', 'numpy', overrides),
    packageRequirement('scipy', 'scipy', overrides),
    packageRequirement('mdtraj', 'mdtraj', overrides),
  ];
}

function legacyPython39CoreRequirements(overrides: Record<string, string>): string[] {
  return [
    packageRequirement('numpy', 'numpy<2', overrides),
    packageRequirement('scipy', 'scipy<1.14', overrides),
    packageRequirement('mdtraj', 'mdtraj<1.10', overrides),
  ];
}

function hasCorePackageOverrides(overrides: Record<string, string>): boolean {
  return ['numpy', 'scipy', 'mdtraj'].some((name) => Boolean(overrides[name]));
}

function mdtrajRequirement(requirements: string[]): string {
  return requirements.find((requirement) => requirement.toLowerCase().startsWith('mdtraj')) || 'mdtraj';
}

function bootstrapFailureGuidance(input: {
  failedStep: string;
  result: BootstrapStepResult;
  preflight: BootstrapPreflight | null;
  wheelProbeFailed?: boolean;
  attemptedSourceBuild?: boolean;
}): BootstrapFailureGuidance {
  const details: string[] = [];
  const pyVersion = input.preflight?.pythonVersion || 'unknown Python';
  const includeDir = input.preflight?.includeDir || 'unknown include dir';
  const pythonHExists = input.preflight?.pythonHExists;

  if (hasMissingPythonHeadersSignal(input.result)) {
    details.push('A Python package source build failed because Python development headers were not available.');
    details.push(`Selected runtime: ${pyVersion}; include dir: ${includeDir}; Python.h exists: ${String(pythonHExists)}`);
    details.push('This is common on managed HPC systems where python3-devel / Python.h is not available to users.');
    details.push('Prefer a newer Python with binary wheels, a conda/mamba environment, admin-installed development headers, or the MD Viewer legacy Python 3.9 fallback when applicable.');
    return {
      category: 'missing_python_headers',
      summary: 'Bootstrap fell into a source-build path and could not find Python.h.',
      details,
    };
  }

  if (input.wheelProbeFailed) {
    details.push('No compatible binary wheel was found for MDTraj on this interpreter/platform using the configured pip indexes.');
    details.push(`Selected runtime: ${pyVersion}; include dir: ${includeDir}; Python.h exists: ${String(pythonHExists)}`);
    details.push('MD Viewer did not silently continue into a source build because that commonly fails on managed HPC systems without Python.h.');
    details.push('Try Python 3.10+, a conda/mamba environment, cluster-provided compatible wheels, custom bootstrap package overrides, or enable source builds only if development headers are available.');
    return {
      category: 'no_mdtraj_binary_wheel',
      summary: 'Bootstrap could not find a binary MDTraj wheel for this interpreter.',
      details,
    };
  }

  return {
    category: 'bootstrap_step_failed',
    summary: `Bootstrap failed at step "${input.failedStep}".`,
    details: [
      `Selected runtime: ${pyVersion}`,
      'Open the MD Viewer Bootstrap output and rerun dependency diagnostics after adjusting the Python environment.',
    ],
  };
}

async function runMdtrajWheelProbe(
  output: vscode.OutputChannel,
  pythonExecutable: string,
  requirement: string,
  extraPipArgs: string[],
  probeLabel: string
): Promise<BootstrapStepResult> {
  const probeDir = path.join(os.tmpdir(), `mdviewer-mdtraj-wheel-${process.pid}-${Date.now()}-${probeLabel}`);
  fs.mkdirSync(probeDir, { recursive: true });
  try {
    return await runStep(output, {
      id: `probe_mdtraj_wheel_${probeLabel}`,
      command: pythonExecutable,
      args: [
        '-m',
        'pip',
        'download',
        '--only-binary=:all:',
        '--no-deps',
        '--dest',
        probeDir,
        ...extraPipArgs,
        requirement,
      ],
    });
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
}

export async function bootstrapRemoteRuntime(context: vscode.ExtensionContext): Promise<void> {
  const hostInfo = hostContextInfo();
  const isDryRun = process.env.MD_VIEWER_BOOTSTRAP_DRY_RUN === '1';
  const output = vscode.window.createOutputChannel('MD Viewer Bootstrap');
  output.clear();
  output.show(true);

  const seedInterpreter = process.env.MD_VIEWER_BOOTSTRAP_SEED_PYTHON
    || (resolveExecutablePath('python3') ? 'python3' : 'python');

  const defaultVenvDir = process.env.MD_VIEWER_BOOTSTRAP_VENV_DIR
    || path.join(os.homedir(), '.venvs', 'mdviewer');
  const venvPython = path.join(defaultVenvDir, 'bin', 'python');
  const config = vscode.workspace.getConfiguration('mdViewer');
  const packageOverrides = asPackageOverrides(
    process.env.MD_VIEWER_BOOTSTRAP_PACKAGE_OVERRIDES_JSON
      ? JSON.parse(process.env.MD_VIEWER_BOOTSTRAP_PACKAGE_OVERRIDES_JSON)
      : config.get('bootstrapPackageOverrides')
  );
  const extraPipArgs = asStringArray(
    process.env.MD_VIEWER_BOOTSTRAP_EXTRA_PIP_ARGS_JSON
      ? JSON.parse(process.env.MD_VIEWER_BOOTSTRAP_EXTRA_PIP_ARGS_JSON)
      : config.get('bootstrapPipExtraArgs')
  );
  const allowSourceBuild = process.env.MD_VIEWER_BOOTSTRAP_ALLOW_SOURCE_BUILD === '1'
    || config.get<boolean>('bootstrapAllowSourceBuild') === true;

  let includeNetcdf = true;
  if (process.env.MD_VIEWER_BOOTSTRAP_ASSUME_YES !== '1') {
    const pick = await vscode.window.showQuickPick(
      [
        {
          label: 'Install netCDF4 (Recommended)',
          description: '.nc support is better when netCDF4 imports successfully on this host.',
          value: true,
        },
        {
          label: 'Skip netCDF4 for now',
          description: 'Core runtime only (mdtraj/numpy/scipy). Useful when HPC MPI modules are not loaded yet.',
          value: false,
        },
      ],
      {
        title: 'MD Viewer: Bootstrap Remote Python Runtime',
      }
    );
    if (!pick) return;
    includeNetcdf = pick.value;
  }

  emitCheckpoint('CHK_DEP_10_BOOTSTRAP_STARTED', {
    extensionHost: hostInfo,
    dryRun: isDryRun,
    seedInterpreter,
    seedInterpreterResolved: resolveExecutablePath(seedInterpreter),
    venvDir: defaultVenvDir,
    venvPython,
    includeNetcdf,
    packageOverrides,
    extraPipArgs,
    allowSourceBuild,
  });

  output.appendLine('MD Viewer bootstrap started');
  output.appendLine(`Extension host: ${hostInfo.extensionHost}`);
  output.appendLine(`Seed interpreter: ${seedInterpreter}`);
  output.appendLine(`Venv dir: ${defaultVenvDir}`);
  output.appendLine(`Install netCDF4: ${includeNetcdf}`);
  output.appendLine(`Allow source builds: ${allowSourceBuild}`);
  if (extraPipArgs.length > 0) {
    output.appendLine(`Extra pip args: ${extraPipArgs.join(' ')}`);
  }
  if (Object.keys(packageOverrides).length > 0) {
    output.appendLine(`Package overrides: ${JSON.stringify(packageOverrides)}`);
  }

  if (isDryRun) {
    const testInterpreter = process.env.MD_VIEWER_BOOTSTRAP_TEST_INTERPRETER || preferredPythonExecutable();
    const target = settingTarget();
    await vscode.workspace.getConfiguration('mdViewer').update('pythonInterpreter', testInterpreter, target);
    process.env.MD_VIEWER_PYTHON = testInterpreter;
    process.env.MD_VIEWER_LAST_GOOD_PYTHON = testInterpreter;

    emitCheckpoint('CHK_DEP_11_BOOTSTRAP_STEP', {
      stepId: 'dry_run',
      ok: true,
      selectedInterpreter: testInterpreter,
      extensionHost: hostInfo,
    });
    emitCheckpoint('CHK_DEP_12_BOOTSTRAP_RESULT', {
      ok: true,
      dryRun: true,
      selectedInterpreter: testInterpreter,
      extensionHost: hostInfo,
    });

    void vscode.window.showInformationMessage(
      `MD Viewer bootstrap dry-run completed. Interpreter set to ${testInterpreter}`
    );
    await vscode.commands.executeCommand('md-viewer.runDependencyDiagnostics');
    return;
  }

  const initialSteps: BootstrapStep[] = [
    {
      id: 'create_venv',
      command: seedInterpreter,
      args: ['-m', 'venv', defaultVenvDir],
    },
    {
      id: 'upgrade_bootstrap_tools',
      command: venvPython,
      args: ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel', ...extraPipArgs],
    },
  ];

  let preflight: BootstrapPreflight | null = null;
  let selectedCoreRequirements = modernCoreRequirements(packageOverrides);
  let usedLegacyFallback = false;
  let sourceBuildAllowedAfterProbe = false;

  const runAndHandleFailure = async (
    step: BootstrapStep,
    options: { wheelProbeFailed?: boolean; attemptedSourceBuild?: boolean } = {}
  ): Promise<boolean> => {
    const result = await runStep(output, step);
    emitCheckpoint('CHK_DEP_11_BOOTSTRAP_STEP', {
      extensionHost: hostInfo,
      stepId: step.id,
      command: step.command,
      args: step.args,
      ok: result.ok,
      exitCode: result.exitCode,
      stdoutFirst200Chars: summarizeText(result.stdout, 200),
      stderrFirst200Chars: summarizeText(result.stderr, 200),
      spawnError: result.spawnError ?? null,
    });

    if (!result.ok) {
      const guidance = bootstrapFailureGuidance({
        failedStep: step.id,
        result,
        preflight,
        wheelProbeFailed: options.wheelProbeFailed,
        attemptedSourceBuild: options.attemptedSourceBuild,
      });
      output.appendLine('');
      output.appendLine(`Bootstrap failure guidance: ${guidance.summary}`);
      for (const detail of guidance.details) {
        output.appendLine(`- ${detail}`);
      }
      emitCheckpoint('CHK_DEP_12_BOOTSTRAP_RESULT', {
        ok: false,
        extensionHost: hostInfo,
        failedStep: step.id,
        exitCode: result.exitCode,
        spawnError: result.spawnError ?? null,
        stderrFirst200Chars: summarizeText(result.stderr, 200),
        failureGuidance: guidance,
      });
      const action = await vscode.window.showErrorMessage(
        `MD Viewer bootstrap failed at step "${step.id}" on ${hostInfo.extensionHost}. ${guidance.summary}`,
        'Open Bootstrap Output',
        'Run Dependency Diagnostics'
      );
      if (action === 'Open Bootstrap Output') {
        output.show(true);
      } else if (action === 'Run Dependency Diagnostics') {
        await vscode.commands.executeCommand('md-viewer.runDependencyDiagnostics');
      }
      return false;
    }
    return true;
  };

  for (const step of initialSteps) {
    const ok = await runAndHandleFailure(step);
    if (!ok) return;
  }

  const preflightResult = await runStep(output, {
    id: 'bootstrap_preflight',
    command: venvPython,
    args: ['-c', PREFLIGHT_SNIPPET],
  });
  preflight = parsePreflight(preflightResult);
  emitCheckpoint('CHK_DEP_15_BOOTSTRAP_PREFLIGHT', {
    extensionHost: hostInfo,
    ok: preflightResult.ok && !preflight.error,
    preflight,
    stdoutFirst200Chars: summarizeText(preflightResult.stdout, 200),
    stderrFirst200Chars: summarizeText(preflightResult.stderr, 200),
  });
  output.appendLine('');
  output.appendLine('Bootstrap preflight:');
  output.appendLine(`- Python version: ${preflight.pythonVersion || 'unknown'}`);
  output.appendLine(`- Platform: ${preflight.platform || 'unknown'}`);
  output.appendLine(`- Include dir: ${preflight.includeDir || 'unknown'}`);
  output.appendLine(`- Python.h exists: ${String(preflight.pythonHExists)}`);

  if (!preflightResult.ok || preflight.error) {
    const guidance = bootstrapFailureGuidance({
      failedStep: 'bootstrap_preflight',
      result: preflightResult,
      preflight,
    });
    output.appendLine('');
    output.appendLine(`Bootstrap failure guidance: ${guidance.summary}`);
    for (const detail of guidance.details) {
      output.appendLine(`- ${detail}`);
    }
    emitCheckpoint('CHK_DEP_12_BOOTSTRAP_RESULT', {
      ok: false,
      extensionHost: hostInfo,
      failedStep: 'bootstrap_preflight',
      preflight,
      failureGuidance: guidance,
    });
    void vscode.window.showErrorMessage(`MD Viewer bootstrap failed during Python preflight. ${guidance.summary}`);
    return;
  }

  const modernProbeRequirement = mdtrajRequirement(selectedCoreRequirements);
  const modernWheelProbe = await runMdtrajWheelProbe(
    output,
    venvPython,
    modernProbeRequirement,
    extraPipArgs,
    'modern'
  );
  emitCheckpoint('CHK_DEP_16_BOOTSTRAP_WHEEL_PROBE', {
    extensionHost: hostInfo,
    probe: 'modern',
    requirement: modernProbeRequirement,
    ok: modernWheelProbe.ok,
    exitCode: modernWheelProbe.exitCode,
    stdoutFirst200Chars: summarizeText(modernWheelProbe.stdout, 200),
    stderrFirst200Chars: summarizeText(modernWheelProbe.stderr, 200),
  });

  if (!modernWheelProbe.ok) {
    const canUseLegacyFallback = isPython39(preflight) && !hasCorePackageOverrides(packageOverrides);
    emitCheckpoint('CHK_DEP_17_BOOTSTRAP_LEGACY_FALLBACK', {
      extensionHost: hostInfo,
      considered: true,
      eligible: canUseLegacyFallback,
      reason: canUseLegacyFallback
        ? 'Python 3.9 with no explicit package overrides; trying legacy wheel-compatible package specs.'
        : 'Legacy fallback is only used for Python 3.9 without explicit package overrides.',
      preflight,
    });

    if (canUseLegacyFallback) {
      const legacyRequirements = legacyPython39CoreRequirements(packageOverrides);
      const legacyProbeRequirement = mdtrajRequirement(legacyRequirements);
      const legacyWheelProbe = await runMdtrajWheelProbe(
        output,
        venvPython,
        legacyProbeRequirement,
        extraPipArgs,
        'legacy_py39'
      );
      emitCheckpoint('CHK_DEP_16_BOOTSTRAP_WHEEL_PROBE', {
        extensionHost: hostInfo,
        probe: 'legacy_py39',
        requirement: legacyProbeRequirement,
        ok: legacyWheelProbe.ok,
        exitCode: legacyWheelProbe.exitCode,
        stdoutFirst200Chars: summarizeText(legacyWheelProbe.stdout, 200),
        stderrFirst200Chars: summarizeText(legacyWheelProbe.stderr, 200),
      });
      if (legacyWheelProbe.ok) {
        usedLegacyFallback = true;
        selectedCoreRequirements = legacyRequirements;
        output.appendLine('Modern MDTraj wheel probe failed; using Python 3.9 legacy fallback package specs.');
        const ok = await runAndHandleFailure({
          id: 'apply_legacy_bootstrap_constraints',
          command: venvPython,
          args: ['-m', 'pip', 'install', '--upgrade', 'setuptools<82', 'wheel', ...extraPipArgs],
        });
        if (!ok) return;
      } else if (allowSourceBuild) {
        sourceBuildAllowedAfterProbe = true;
        output.appendLine('Legacy MDTraj wheel probe failed; source builds are enabled by setting/env, so bootstrap will attempt source build.');
      } else {
        const guidance = bootstrapFailureGuidance({
          failedStep: 'probe_mdtraj_wheel',
          result: legacyWheelProbe,
          preflight,
          wheelProbeFailed: true,
        });
        output.appendLine('');
        output.appendLine(`Bootstrap failure guidance: ${guidance.summary}`);
        for (const detail of guidance.details) {
          output.appendLine(`- ${detail}`);
        }
        emitCheckpoint('CHK_DEP_12_BOOTSTRAP_RESULT', {
          ok: false,
          extensionHost: hostInfo,
          failedStep: 'probe_mdtraj_wheel',
          preflight,
          failureGuidance: guidance,
        });
        void vscode.window.showErrorMessage(`MD Viewer bootstrap stopped before source build. ${guidance.summary}`);
        return;
      }
    } else if (allowSourceBuild) {
      sourceBuildAllowedAfterProbe = true;
      output.appendLine('MDTraj wheel probe failed; source builds are enabled by setting/env, so bootstrap will attempt source build.');
    } else {
      const guidance = bootstrapFailureGuidance({
        failedStep: 'probe_mdtraj_wheel',
        result: modernWheelProbe,
        preflight,
        wheelProbeFailed: true,
      });
      output.appendLine('');
      output.appendLine(`Bootstrap failure guidance: ${guidance.summary}`);
      for (const detail of guidance.details) {
        output.appendLine(`- ${detail}`);
      }
      emitCheckpoint('CHK_DEP_12_BOOTSTRAP_RESULT', {
        ok: false,
        extensionHost: hostInfo,
        failedStep: 'probe_mdtraj_wheel',
        preflight,
        failureGuidance: guidance,
      });
      void vscode.window.showErrorMessage(`MD Viewer bootstrap stopped before source build. ${guidance.summary}`);
      return;
    }
  } else {
    emitCheckpoint('CHK_DEP_17_BOOTSTRAP_LEGACY_FALLBACK', {
      extensionHost: hostInfo,
      considered: false,
      eligible: false,
      reason: 'Modern MDTraj wheel probe succeeded; default package specs remain active.',
      preflight,
    });
  }

  const installCoreStep: BootstrapStep = {
    id: 'install_core_runtime',
    command: venvPython,
    args: ['-m', 'pip', 'install', '--upgrade', ...selectedCoreRequirements, ...extraPipArgs],
  };
  const installCoreOk = await runAndHandleFailure(installCoreStep, {
    attemptedSourceBuild: sourceBuildAllowedAfterProbe,
  });
  if (!installCoreOk) return;

  if (includeNetcdf) {
    const netcdfRequirement = packageRequirement('netCDF4', 'netCDF4', packageOverrides);
    const ok = await runAndHandleFailure({
      id: 'install_netcdf4',
      command: venvPython,
      args: ['-m', 'pip', 'install', '--upgrade', netcdfRequirement, ...extraPipArgs],
    });
    if (!ok) return;
  }

  const target = settingTarget();
  await vscode.workspace.getConfiguration('mdViewer').update('pythonInterpreter', venvPython, target);
  process.env.MD_VIEWER_PYTHON = venvPython;
  process.env.MD_VIEWER_LAST_GOOD_PYTHON = venvPython;

  emitCheckpoint('CHK_DEP_12_BOOTSTRAP_RESULT', {
    ok: true,
    extensionHost: hostInfo,
    selectedInterpreter: venvPython,
    includeNetcdf,
    preflight,
    selectedCoreRequirements,
    usedLegacyFallback,
    allowSourceBuild,
  });

  const action = await vscode.window.showInformationMessage(
    `MD Viewer bootstrap finished. Interpreter set to ${venvPython}.`,
    'Run Dependency Diagnostics'
  );
  if (action === 'Run Dependency Diagnostics') {
    await vscode.commands.executeCommand('md-viewer.runDependencyDiagnostics');
  }

  if (includeNetcdf) {
    output.appendLine('');
    output.appendLine('HPC note: if netCDF4 import still fails (for example mpi4py-linked issues), load cluster MPI/Python modules and rerun diagnostics.');
  }
}
