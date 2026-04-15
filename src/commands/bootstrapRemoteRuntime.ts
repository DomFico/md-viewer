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
  });

  output.appendLine('MD Viewer bootstrap started');
  output.appendLine(`Extension host: ${hostInfo.extensionHost}`);
  output.appendLine(`Seed interpreter: ${seedInterpreter}`);
  output.appendLine(`Venv dir: ${defaultVenvDir}`);
  output.appendLine(`Install netCDF4: ${includeNetcdf}`);

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

  const steps: BootstrapStep[] = [
    {
      id: 'create_venv',
      command: seedInterpreter,
      args: ['-m', 'venv', defaultVenvDir],
    },
    {
      id: 'upgrade_bootstrap_tools',
      command: venvPython,
      args: ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'],
    },
    {
      id: 'install_core_runtime',
      command: venvPython,
      args: ['-m', 'pip', 'install', '--upgrade', 'numpy', 'scipy', 'mdtraj'],
    },
  ];

  if (includeNetcdf) {
    steps.push({
      id: 'install_netcdf4',
      command: venvPython,
      args: ['-m', 'pip', 'install', '--upgrade', 'netCDF4'],
    });
  }

  for (const step of steps) {
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
      emitCheckpoint('CHK_DEP_12_BOOTSTRAP_RESULT', {
        ok: false,
        extensionHost: hostInfo,
        failedStep: step.id,
        exitCode: result.exitCode,
        spawnError: result.spawnError ?? null,
        stderrFirst200Chars: summarizeText(result.stderr, 200),
      });
      const action = await vscode.window.showErrorMessage(
        `MD Viewer bootstrap failed at step "${step.id}" on ${hostInfo.extensionHost}. See "MD Viewer Bootstrap" output for details.`,
        'Open Bootstrap Output',
        'Run Dependency Diagnostics'
      );
      if (action === 'Open Bootstrap Output') {
        output.show(true);
      } else if (action === 'Run Dependency Diagnostics') {
        await vscode.commands.executeCommand('md-viewer.runDependencyDiagnostics');
      }
      return;
    }
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
