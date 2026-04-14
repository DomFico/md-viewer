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
  const configuredPython = configuredPythonInterpreter();
  const selectedPython = configuredPython ?? preferredPythonExecutable();
  const selectedSource = selectedPythonSource(configuredPython, selectedPython);
  const resolvedPython = resolveExecutablePath(selectedPython);
  emitCheckpoint('CHK_DEP_1_DIAGNOSTICS_STARTED', {
    configuredPythonInterpreter: configuredPython,
    selectedPythonExecutable: selectedPython,
    selectedPythonSource: selectedSource,
    resolvedPythonPath: resolvedPython,
  });

  const pythonDiagnostics = runPythonImportDiagnostics(selectedPython);

  const binaryBridge = buildBridgeDiagnostics(RUNTIME_BRIDGE_SCRIPTS.binaryTrajectory);
  const parm7Bridge = buildBridgeDiagnostics(RUNTIME_BRIDGE_SCRIPTS.parm7Topology);

  const mdtrajOk = pythonDiagnostics.pythonImports?.mdtraj?.ok === true;
  const summary: DiagnosticsSummary = {
    configuredPythonInterpreter: configuredPython,
    selectedPythonExecutable: selectedPython,
    selectedPythonSource: selectedSource,
    resolvedPythonPath: resolvedPython,
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

  const hasBlockingIssue =
    !summary.resolvedPythonPath
    || !summary.capabilities.binaryTrajectoryBridgeReady
    || !summary.capabilities.parm7TopologyBridgeReady;

  if (hasBlockingIssue) {
    emitCheckpoint('CHK_DEP_3_DIAGNOSTICS_RESULT', {
      ok: false,
      hasBlockingIssue: true,
    });
    vscode.window.showWarningMessage('MD Viewer diagnostics found missing dependencies. See "MD Viewer Diagnostics" output.');
  } else {
    emitCheckpoint('CHK_DEP_3_DIAGNOSTICS_RESULT', {
      ok: true,
      hasBlockingIssue: false,
    });
    vscode.window.showInformationMessage('MD Viewer diagnostics passed. Python bridge dependencies look available.');
  }
}
