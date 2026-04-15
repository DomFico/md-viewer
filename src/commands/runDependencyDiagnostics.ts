import * as fs from 'fs';
import { spawnSync } from 'child_process';
import * as vscode from 'vscode';
import { bridgeCandidatePaths, RUNTIME_BRIDGE_SCRIPTS, resolveRuntimeBridgePath } from '../runtime/bridgePaths';
import { preferredPythonExecutable, resolveExecutablePath } from '../runtime/pythonRuntime';
import { emitCheckpoint } from '../runtimeCheckpoint';

type PythonImportStatus = {
  ok: boolean;
  error?: string;
};

type DiagnosticsSummary = {
  configuredPythonInterpreter: string | null;
  selectedPythonExecutable: string;
  selectedPythonSource: 'setting' | 'env' | 'default';
  resolvedPythonPath: string | null;
  extensionHost: {
    isRemote: boolean;
    remoteName: string | null;
    locationLabel: string;
  };
  pythonVersion: string | null;
  pythonImports: Record<string, PythonImportStatus>;
  bridgeScripts: Record<string, {
    selectedPath: string;
    selectedExists: boolean;
    candidatePaths: string[];
  }>;
  capabilities: {
    binaryTrajectoryBridgeReady: boolean;
    parm7TopologyBridgeReady: boolean;
    chunkedBinaryFormats: string[];
    amberFormats: string[];
  };
  diagnosticsError?: string;
};

function extensionHostInfo(): DiagnosticsSummary['extensionHost'] {
  const remoteName = vscode.env.remoteName ?? null;
  return {
    isRemote: Boolean(remoteName),
    remoteName,
    locationLabel: remoteName ? `remote (${remoteName})` : 'local',
  };
}

function configuredPythonInterpreter(): string | null {
  const configured = vscode.workspace.getConfiguration('mdViewer').get<string>('pythonInterpreter');
  if (configured && configured.trim().length > 0) {
    return configured.trim();
  }
  return null;
}

function selectedPythonSource(configured: string | null, selected: string): 'setting' | 'env' | 'default' {
  if (configured && configured === selected) return 'setting';
  const envCandidates = [process.env.MD_VIEWER_PYTHON, process.env.PYTHON, process.env.PYTHON3]
    .filter((value): value is string => Boolean(value && value.trim().length > 0))
    .map((value) => value.trim());
  if (envCandidates.includes(selected)) return 'env';
  return 'default';
}

function parseJsonFromMixedStdout(stdout: string): any {
  const firstBrace = stdout.indexOf('{');
  const lastBrace = stdout.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('No JSON object found in python diagnostics output.');
  }
  return JSON.parse(stdout.slice(firstBrace, lastBrace + 1));
}

function runPythonImportDiagnostics(pythonExecutable: string): {
  pythonVersion: string | null;
  pythonImports: Record<string, PythonImportStatus>;
  diagnosticsError?: string;
} {
  const snippet = `
import importlib, json, sys
mods = ["mdtraj", "numpy", "scipy", "netCDF4"]
status = {}
for name in mods:
    try:
        importlib.import_module(name)
        status[name] = {"ok": True}
    except Exception as exc:
        status[name] = {"ok": False, "error": str(exc)}
print(json.dumps({
    "pythonVersion": sys.version.split()[0],
    "imports": status
}))
`.trim();

  const result = spawnSync(pythonExecutable, ['-c', snippet], {
    encoding: 'utf8',
    timeout: 15000,
  });

  if (result.error) {
    return {
      pythonVersion: null,
      pythonImports: {},
      diagnosticsError: result.error.message,
    };
  }

  if (result.status !== 0) {
    return {
      pythonVersion: null,
      pythonImports: {},
      diagnosticsError: (result.stderr || result.stdout || `python exited with code ${result.status}`).trim(),
    };
  }

  try {
    const parsed = parseJsonFromMixedStdout(result.stdout || '');
    return {
      pythonVersion: typeof parsed?.pythonVersion === 'string' ? parsed.pythonVersion : null,
      pythonImports: parsed?.imports && typeof parsed.imports === 'object'
        ? parsed.imports
        : {},
    };
  } catch (err) {
    return {
      pythonVersion: null,
      pythonImports: {},
      diagnosticsError: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildBridgeDiagnostics(scriptName: string): {
  selectedPath: string;
  selectedExists: boolean;
  candidatePaths: string[];
} {
  const selectedPath = resolveRuntimeBridgePath(scriptName);
  return {
    selectedPath,
    selectedExists: fs.existsSync(selectedPath),
    candidatePaths: bridgeCandidatePaths(scriptName),
  };
}

export async function runDependencyDiagnostics(): Promise<void> {
  const hostInfo = extensionHostInfo();
  const configuredPython = configuredPythonInterpreter();
  const selectedPython = configuredPython ?? preferredPythonExecutable();
  const selectedSource = selectedPythonSource(configuredPython, selectedPython);
  const resolvedPython = resolveExecutablePath(selectedPython);
  emitCheckpoint('CHK_DEP_1_DIAGNOSTICS_STARTED', {
    configuredPythonInterpreter: configuredPython,
    selectedPythonExecutable: selectedPython,
    selectedPythonSource: selectedSource,
    resolvedPythonPath: resolvedPython,
    extensionHost: hostInfo,
  });

  const pythonDiagnostics = runPythonImportDiagnostics(selectedPython);

  const binaryBridge = buildBridgeDiagnostics(RUNTIME_BRIDGE_SCRIPTS.binaryTrajectory);
  const parm7Bridge = buildBridgeDiagnostics(RUNTIME_BRIDGE_SCRIPTS.parm7Topology);

  const mdtrajOk = pythonDiagnostics.pythonImports?.mdtraj?.ok === true;
  const missingImports = Object.entries(pythonDiagnostics.pythonImports)
    .filter(([, status]) => !status?.ok)
    .map(([name]) => name);
  const summary: DiagnosticsSummary = {
    configuredPythonInterpreter: configuredPython,
    selectedPythonExecutable: selectedPython,
    selectedPythonSource: selectedSource,
    resolvedPythonPath: resolvedPython,
    extensionHost: hostInfo,
    pythonVersion: pythonDiagnostics.pythonVersion,
    pythonImports: pythonDiagnostics.pythonImports,
    bridgeScripts: {
      [RUNTIME_BRIDGE_SCRIPTS.binaryTrajectory]: binaryBridge,
      [RUNTIME_BRIDGE_SCRIPTS.parm7Topology]: parm7Bridge,
    },
    capabilities: {
      binaryTrajectoryBridgeReady: mdtrajOk && binaryBridge.selectedExists,
      parm7TopologyBridgeReady: mdtrajOk && parm7Bridge.selectedExists,
      chunkedBinaryFormats: ['xtc', 'dcd', 'trr', 'nc', 'rst7'],
      amberFormats: ['nc', 'parm7', 'rst7'],
    },
    diagnosticsError: pythonDiagnostics.diagnosticsError,
  };
  emitCheckpoint('CHK_DEP_2_DIAGNOSTICS_SUMMARY', summary);

  const output = vscode.window.createOutputChannel('MD Viewer Diagnostics');
  output.clear();
  output.appendLine('MD Viewer dependency diagnostics');
  output.appendLine(JSON.stringify(summary, null, 2));
  output.show(true);

  const blockingIssues: string[] = [];
  if (!summary.resolvedPythonPath) {
    blockingIssues.push(`Python executable not found: ${summary.selectedPythonExecutable}`);
  }
  if (!summary.capabilities.binaryTrajectoryBridgeReady) {
    if (!mdtrajOk) {
      blockingIssues.push('Python package "mdtraj" is missing');
    }
    if (!binaryBridge.selectedExists) {
      blockingIssues.push(`Bridge script missing: ${binaryBridge.selectedPath}`);
    }
  }
  if (!summary.capabilities.parm7TopologyBridgeReady) {
    if (!parm7Bridge.selectedExists) {
      blockingIssues.push(`Bridge script missing: ${parm7Bridge.selectedPath}`);
    }
  }
  if (pythonDiagnostics.diagnosticsError) {
    blockingIssues.push(`Python diagnostics failed: ${pythonDiagnostics.diagnosticsError}`);
  }

  const hasBlockingIssue =
    !summary.resolvedPythonPath
    || !summary.capabilities.binaryTrajectoryBridgeReady
    || !summary.capabilities.parm7TopologyBridgeReady;

  if (hasBlockingIssue) {
    emitCheckpoint('CHK_DEP_3_DIAGNOSTICS_RESULT', {
      ok: false,
      hasBlockingIssue: true,
      blockingIssues,
      missingImports,
      extensionHost: hostInfo,
    });
    const msg =
      `MD Viewer diagnostics found missing dependencies on the ${hostInfo.locationLabel} extension host. `
      + `Issues: ${blockingIssues.join('; ') || 'unknown dependency issue'}.`;
    const action = await vscode.window.showWarningMessage(
      msg,
      'Select Python Interpreter',
      'Open Python Interpreter Setting',
      'Open Diagnostics Output'
    );
    if (action === 'Select Python Interpreter') {
      await vscode.commands.executeCommand('md-viewer.selectPythonInterpreter');
    } else if (action === 'Open Python Interpreter Setting') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'mdViewer.pythonInterpreter');
    } else if (action === 'Open Diagnostics Output') {
      output.show(true);
    }
  } else {
    emitCheckpoint('CHK_DEP_3_DIAGNOSTICS_RESULT', {
      ok: true,
      hasBlockingIssue: false,
      missingImports,
      extensionHost: hostInfo,
    });
    const optionalMissing = missingImports.filter((name) => name !== 'netCDF4');
    const suffix = optionalMissing.length > 0
      ? ` Optional packages missing: ${optionalMissing.join(', ')}.`
      : '';
    vscode.window.showInformationMessage(
      `MD Viewer diagnostics passed on ${hostInfo.locationLabel} extension host.${suffix}`
    );
  }
}
