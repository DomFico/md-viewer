import * as fs from 'fs';
import * as vscode from 'vscode';
import { spawnSync } from 'child_process';
import { bridgeCandidatePaths, RUNTIME_BRIDGE_SCRIPTS, resolveRuntimeBridgePath } from '../runtime/bridgePaths';
import {
  amberTopologyReady,
  buildInterpreterCandidates,
  coreRuntimeReady,
  InterpreterCandidate,
  interpreterSelectionReason,
  netcdfImportReady,
  preferredPythonExecutable,
  resolveExecutablePath,
  runPythonImportDiagnostics,
  selectBestInterpreterCandidate,
  workspaceRootsFromFolders,
} from '../runtime/pythonRuntime';
import {
  CapabilityMatrixSummary,
  CapabilityStatus,
  getHostRuntimeState,
  hostContextInfo,
  setHostRuntimeState,
} from '../runtime/hostRuntimeState';
import { emitCheckpoint } from '../runtimeCheckpoint';

type CapabilityItem = {
  status: CapabilityStatus;
  reasons: string[];
};

type CandidateEvaluation = {
  candidate: InterpreterCandidate;
  resolvedPythonPath: string | null;
  pythonVersion: string | null;
  pythonImports: Record<string, { ok: boolean; error?: string }>;
  diagnosticsError?: string;
  coreReady: boolean;
  amberReady: boolean;
  netcdfImportReady: boolean;
  missingImports: string[];
};

type BridgeCapabilityProbeResult = {
  ok: boolean;
  status: CapabilityStatus;
  reason: string;
  details?: Record<string, unknown>;
  error?: string;
  exitCode: number | null;
  rawOutput: string;
  rawStderr: string;
};

type DiagnosticsSummary = {
  configuredPythonInterpreter: string | null;
  lastKnownGoodInterpreter: string | null;
  selectedPythonExecutable: string;
  selectedPythonSource: string;
  selectedPythonReason: string;
  resolvedPythonPath: string | null;
  extensionHost: {
    isRemote: boolean;
    remoteName: string | null;
    locationLabel: string;
    hostKey: string;
    workspaceRoot: string | null;
  };
  pythonVersion: string | null;
  pythonImports: Record<string, { ok: boolean; error?: string }>;
  candidateEvaluations: Array<{
    executable: string;
    source: string;
    detail: string;
    resolvedPythonPath: string | null;
    pythonVersion: string | null;
    coreReady: boolean;
    amberReady: boolean;
    netcdfImportReady: boolean;
    missingImports: string[];
    diagnosticsError?: string;
  }>;
  bridgeScripts: Record<string, {
    selectedPath: string;
    selectedExists: boolean;
    candidatePaths: string[];
  }>;
  bridgeCapabilityProbes: {
    parm7Topology: BridgeCapabilityProbeResult | null;
    ncRuntime: BridgeCapabilityProbeResult | null;
  };
  capabilities: {
    matrix: {
      coreRuntime: CapabilityItem;
      amberTopology: CapabilityItem;
      netcdfTrajectories: CapabilityItem;
      bridgeScripts: CapabilityItem;
    };
    summary: CapabilityMatrixSummary;
  };
  diagnosticsError?: string;
};

function extensionHostInfo(): DiagnosticsSummary['extensionHost'] {
  const info = hostContextInfo();
  const remoteName = vscode.env.remoteName ?? null;
  return {
    isRemote: Boolean(remoteName),
    remoteName,
    locationLabel: remoteName ? `remote (${remoteName})` : 'local',
    hostKey: info.key,
    workspaceRoot: info.workspaceRoot,
  };
}

function configuredPythonInterpreter(): string | null {
  const configured = vscode.workspace.getConfiguration('mdViewer').get<string>('pythonInterpreter');
  if (configured && configured.trim().length > 0) {
    return configured.trim();
  }
  return null;
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

function parseBridgeJsonOutput(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error('No JSON object found in bridge output.');
    }
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  }
}

function normalizedCapabilityStatus(value: unknown): CapabilityStatus {
  if (value === 'ok' || value === 'degraded' || value === 'blocked') {
    return value;
  }
  return 'blocked';
}

function runBridgeCapabilityProbe(input: {
  pythonExecutable: string;
  bridgePath: string;
  args: string[];
}): BridgeCapabilityProbeResult {
  const spawnResult = spawnSync(input.pythonExecutable, [input.bridgePath, ...input.args], {
    encoding: 'utf8',
    timeout: 20000,
  });

  const rawOutput = spawnResult.stdout || '';
  const rawStderr = spawnResult.stderr || '';
  const exitCode = Number.isInteger(spawnResult.status) ? spawnResult.status : null;

  if (spawnResult.error) {
    return {
      ok: false,
      status: 'blocked',
      reason: `Failed to run bridge probe: ${spawnResult.error.message}`,
      error: spawnResult.error.message,
      exitCode,
      rawOutput,
      rawStderr,
    };
  }

  if (spawnResult.status !== 0) {
    const reason = (rawStderr || rawOutput || `Bridge probe exited with code ${spawnResult.status}`).trim();
    return {
      ok: false,
      status: 'blocked',
      reason,
      error: reason,
      exitCode,
      rawOutput,
      rawStderr,
    };
  }

  try {
    const parsed = parseBridgeJsonOutput(rawOutput);
    const ok = Boolean(parsed?.ok);
    const status = normalizedCapabilityStatus(parsed?.status ?? (ok ? 'ok' : 'blocked'));
    const details = parsed?.details && typeof parsed.details === 'object' ? parsed.details : {};
    const reason = typeof parsed?.error === 'string'
      ? parsed.error
      : typeof details?.error === 'string'
        ? String(details.error)
        : ok
          ? 'Bridge runtime capability probe succeeded.'
          : 'Bridge runtime capability probe reported unavailable.';
    return {
      ok,
      status,
      reason,
      details,
      error: typeof parsed?.error === 'string' ? parsed.error : undefined,
      exitCode,
      rawOutput,
      rawStderr,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 'blocked',
      reason: `Failed to parse bridge probe output: ${reason}`,
      error: reason,
      exitCode,
      rawOutput,
      rawStderr,
    };
  }
}

function evaluateCandidate(candidate: InterpreterCandidate): CandidateEvaluation {
  const resolvedPythonPath = resolveExecutablePath(candidate.executable);
  const pythonDiagnostics = runPythonImportDiagnostics(candidate.executable);
  const pythonImports = pythonDiagnostics.pythonImports || {};
  const coreReady = coreRuntimeReady(pythonImports);
  const amberReady = amberTopologyReady(pythonImports);
  const ncReady = netcdfImportReady(pythonImports);
  const missingImports = Object.entries(pythonImports)
    .filter(([, status]) => !status?.ok)
    .map(([name]) => name);

  return {
    candidate,
    resolvedPythonPath,
    pythonVersion: pythonDiagnostics.pythonVersion,
    pythonImports,
    diagnosticsError: pythonDiagnostics.diagnosticsError,
    coreReady,
    amberReady,
    netcdfImportReady: ncReady,
    missingImports,
  };
}

function capabilityBlocked(reasons: string[]): CapabilityItem {
  return { status: 'blocked', reasons };
}

function capabilityOk(reasons: string[]): CapabilityItem {
  return { status: 'ok', reasons };
}

function capabilityDegraded(reasons: string[]): CapabilityItem {
  return { status: 'degraded', reasons };
}

function buildCapabilityMatrix(input: {
  selected: CandidateEvaluation;
  binaryBridgeExists: boolean;
  parm7BridgeExists: boolean;
  parm7BridgeProbe: BridgeCapabilityProbeResult | null;
  ncBridgeProbe: BridgeCapabilityProbeResult | null;
}): {
  coreRuntime: CapabilityItem;
  amberTopology: CapabilityItem;
  netcdfTrajectories: CapabilityItem;
  bridgeScripts: CapabilityItem;
} {
  const { selected, binaryBridgeExists, parm7BridgeExists, parm7BridgeProbe, ncBridgeProbe } = input;

  const bridgeScripts = (binaryBridgeExists && parm7BridgeExists)
    ? capabilityOk(['Runtime bridge scripts are present.'])
    : capabilityBlocked([
      !binaryBridgeExists ? `Missing ${RUNTIME_BRIDGE_SCRIPTS.binaryTrajectory}` : '',
      !parm7BridgeExists ? `Missing ${RUNTIME_BRIDGE_SCRIPTS.parm7Topology}` : '',
    ].filter((reason) => reason.length > 0));

  const missingCore = ['mdtraj', 'numpy', 'scipy'].filter((name) => selected.pythonImports?.[name]?.ok !== true);
  const coreRuntime = (selected.coreReady && !selected.diagnosticsError)
    ? capabilityOk(['mdtraj + numpy + scipy imports succeeded.'])
    : capabilityBlocked([
      selected.diagnosticsError ? `Python diagnostics error: ${selected.diagnosticsError}` : '',
      missingCore.length > 0 ? `Missing core packages: ${missingCore.join(', ')}` : '',
    ].filter((reason) => reason.length > 0));

  let amberTopology: CapabilityItem;
  if (!parm7BridgeExists) {
    amberTopology = capabilityBlocked([`Missing ${RUNTIME_BRIDGE_SCRIPTS.parm7Topology}`]);
  } else if (!selected.coreReady) {
    amberTopology = capabilityBlocked([
      'Core runtime is blocked (mdtraj/numpy/scipy required before .parm7 can run).',
    ]);
  } else if (parm7BridgeProbe?.ok) {
    amberTopology = capabilityOk([
      '.parm7 topology bridge runtime probe succeeded.',
    ]);
  } else if (parm7BridgeProbe) {
    amberTopology = parm7BridgeProbe.status === 'degraded'
      ? capabilityDegraded([
        `.parm7 bridge probe degraded: ${parm7BridgeProbe.reason}`,
      ])
      : capabilityBlocked([
        `.parm7 bridge probe failed: ${parm7BridgeProbe.reason}`,
      ]);
  } else {
    amberTopology = selected.amberReady
      ? capabilityDegraded(['.parm7 bridge probe was unavailable; mdtraj import passed but runtime path is unverified.'])
      : capabilityBlocked([
        selected.diagnosticsError ? `Python diagnostics error: ${selected.diagnosticsError}` : '',
        selected.pythonImports?.mdtraj?.ok === false ? `mdtraj import failed: ${selected.pythonImports.mdtraj.error || 'unknown error'}` : '',
      ].filter((reason) => reason.length > 0));
  }

  let netcdfTrajectories: CapabilityItem;
  if (!binaryBridgeExists) {
    netcdfTrajectories = capabilityBlocked([`Missing ${RUNTIME_BRIDGE_SCRIPTS.binaryTrajectory}`]);
  } else if (!selected.coreReady) {
    netcdfTrajectories = capabilityBlocked(['Core runtime is blocked (mdtraj/numpy/scipy required before .nc can run).']);
  } else if (ncBridgeProbe?.ok) {
    netcdfTrajectories = capabilityOk([
      '.nc bridge runtime probe succeeded.',
      selected.netcdfImportReady
        ? 'netCDF4 import succeeded.'
        : 'netCDF4 import failed, but the actual .nc bridge runtime path passed on this interpreter.',
    ]);
  } else if (ncBridgeProbe) {
    netcdfTrajectories = ncBridgeProbe.status === 'degraded'
      ? capabilityDegraded([
        `.nc bridge runtime probe degraded: ${ncBridgeProbe.reason}`,
      ])
      : capabilityBlocked([
        `.nc bridge runtime probe failed: ${ncBridgeProbe.reason}`,
      ]);
  } else {
    netcdfTrajectories = capabilityDegraded([
      '.nc bridge runtime probe was unavailable; status inferred from imports only.',
      selected.netcdfImportReady
        ? 'netCDF4 import succeeded, but runtime path remains unverified.'
        : 'netCDF4 import failed and runtime path is unverified.',
    ]);
  }

  return {
    coreRuntime,
    amberTopology,
    netcdfTrajectories,
    bridgeScripts,
  };
}

function summarizeCapabilityMatrix(matrix: {
  coreRuntime: CapabilityItem;
  amberTopology: CapabilityItem;
  netcdfTrajectories: CapabilityItem;
  bridgeScripts: CapabilityItem;
}): CapabilityMatrixSummary {
  return {
    coreRuntime: matrix.coreRuntime.status,
    amberTopology: matrix.amberTopology.status,
    netcdfTrajectories: matrix.netcdfTrajectories.status,
    bridgeScripts: matrix.bridgeScripts.status,
  };
}

function formatCapabilityLine(label: string, capability: CapabilityItem): string {
  const reason = capability.reasons.length > 0 ? ` (${capability.reasons.join(' | ')})` : '';
  return `${label}: ${capability.status.toUpperCase()}${reason}`;
}

function withReasonText(lines: string[]): string {
  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => `- ${line}`)
    .join('\n');
}

export async function runDependencyDiagnostics(context: vscode.ExtensionContext): Promise<void> {
  const hostInfo = extensionHostInfo();
  const configuredPython = configuredPythonInterpreter();
  const lastKnownState = getHostRuntimeState(context);
  const envLastKnown = (process.env.MD_VIEWER_LAST_GOOD_PYTHON || '').trim();
  const lastKnownGoodInterpreter = lastKnownState?.interpreter || (envLastKnown.length > 0 ? envLastKnown : null);

  const candidates = buildInterpreterCandidates({
    configuredInterpreter: configuredPython,
    lastKnownGoodInterpreter,
    workspaceRoots: workspaceRootsFromFolders(vscode.workspace.workspaceFolders),
  });

  emitCheckpoint('CHK_DEP_1_DIAGNOSTICS_STARTED', {
    configuredPythonInterpreter: configuredPython,
    lastKnownGoodInterpreter,
    extensionHost: hostInfo,
    candidateExecutables: candidates.map((candidate) => ({
      executable: candidate.executable,
      source: candidate.source,
      detail: candidate.detail,
    })),
  });

  const evaluations = candidates.map((candidate) => evaluateCandidate(candidate));

  emitCheckpoint('CHK_DEP_6_INTERPRETER_CANDIDATES', {
    extensionHost: hostInfo,
    evaluations: evaluations.map((evaluation) => ({
      executable: evaluation.candidate.executable,
      source: evaluation.candidate.source,
      detail: evaluation.candidate.detail,
      resolvedPythonPath: evaluation.resolvedPythonPath,
      pythonVersion: evaluation.pythonVersion,
      coreReady: evaluation.coreReady,
      amberReady: evaluation.amberReady,
      netcdfImportReady: evaluation.netcdfImportReady,
      missingImports: evaluation.missingImports,
      diagnosticsError: evaluation.diagnosticsError,
    })),
  });

  const chosen = selectBestInterpreterCandidate(evaluations)
    || (evaluations.length > 0 ? evaluations[0] : null);

  const fallbackCandidate = preferredPythonExecutable();
  const selectedEval = chosen || evaluateCandidate({
    executable: fallbackCandidate,
    source: 'default',
    detail: 'Preferred Python fallback',
  });

  const selectedReason = interpreterSelectionReason({
    chosenSource: selectedEval.candidate.source,
    chosenExecutable: selectedEval.candidate.executable,
    chosenCoreReady: selectedEval.coreReady,
  });

  process.env.MD_VIEWER_PYTHON = selectedEval.candidate.executable;

  const binaryBridge = buildBridgeDiagnostics(RUNTIME_BRIDGE_SCRIPTS.binaryTrajectory);
  const parm7Bridge = buildBridgeDiagnostics(RUNTIME_BRIDGE_SCRIPTS.parm7Topology);

  const parm7BridgeProbe = parm7Bridge.selectedExists
    ? runBridgeCapabilityProbe({
      pythonExecutable: selectedEval.candidate.executable,
      bridgePath: parm7Bridge.selectedPath,
      args: ['--mode', 'capability'],
    })
    : null;

  const ncBridgeProbe = binaryBridge.selectedExists
    ? runBridgeCapabilityProbe({
      pythonExecutable: selectedEval.candidate.executable,
      bridgePath: binaryBridge.selectedPath,
      args: ['--mode', 'capability', '--format', 'nc'],
    })
    : null;

  emitCheckpoint('CHK_DEP_10_BRIDGE_CAPABILITY_PROBES', {
    selectedPythonExecutable: selectedEval.candidate.executable,
    extensionHost: hostInfo,
    parm7BridgeProbe,
    ncBridgeProbe,
  });

  const capabilityMatrix = buildCapabilityMatrix({
    selected: selectedEval,
    binaryBridgeExists: binaryBridge.selectedExists,
    parm7BridgeExists: parm7Bridge.selectedExists,
    parm7BridgeProbe,
    ncBridgeProbe,
  });
  const capabilitySummary = summarizeCapabilityMatrix(capabilityMatrix);

  emitCheckpoint('CHK_DEP_7_INTERPRETER_SELECTED', {
    selectedPythonExecutable: selectedEval.candidate.executable,
    selectedPythonSource: selectedEval.candidate.source,
    selectedPythonReason: selectedReason,
    selectedCoreReady: selectedEval.coreReady,
    selectedAmberReady: selectedEval.amberReady,
    selectedNetcdfImportReady: selectedEval.netcdfImportReady,
    extensionHost: hostInfo,
  });

  emitCheckpoint('CHK_DEP_8_CAPABILITY_MATRIX', {
    selectedPythonExecutable: selectedEval.candidate.executable,
    extensionHost: hostInfo,
    matrix: capabilityMatrix,
    summary: capabilitySummary,
  });

  if (selectedEval.coreReady) {
    process.env.MD_VIEWER_LAST_GOOD_PYTHON = selectedEval.candidate.executable;
    await setHostRuntimeState(context, {
      interpreter: selectedEval.candidate.executable,
      validatedAt: new Date().toISOString(),
      extensionHost: hostInfo.locationLabel,
      workspaceRoot: hostInfo.workspaceRoot,
      capabilities: capabilitySummary,
      selectionReason: selectedReason,
    });
    emitCheckpoint('CHK_DEP_9_HOST_RUNTIME_STATE_UPDATED', {
      interpreter: selectedEval.candidate.executable,
      validatedAt: new Date().toISOString(),
      extensionHost: hostInfo,
      capabilities: capabilitySummary,
    });
  }

  const summary: DiagnosticsSummary = {
    configuredPythonInterpreter: configuredPython,
    lastKnownGoodInterpreter,
    selectedPythonExecutable: selectedEval.candidate.executable,
    selectedPythonSource: selectedEval.candidate.source,
    selectedPythonReason: selectedReason,
    resolvedPythonPath: selectedEval.resolvedPythonPath,
    extensionHost: hostInfo,
    pythonVersion: selectedEval.pythonVersion,
    pythonImports: selectedEval.pythonImports,
    candidateEvaluations: evaluations.map((evaluation) => ({
      executable: evaluation.candidate.executable,
      source: evaluation.candidate.source,
      detail: evaluation.candidate.detail,
      resolvedPythonPath: evaluation.resolvedPythonPath,
      pythonVersion: evaluation.pythonVersion,
      coreReady: evaluation.coreReady,
      amberReady: evaluation.amberReady,
      netcdfImportReady: evaluation.netcdfImportReady,
      missingImports: evaluation.missingImports,
      diagnosticsError: evaluation.diagnosticsError,
    })),
    bridgeScripts: {
      [RUNTIME_BRIDGE_SCRIPTS.binaryTrajectory]: binaryBridge,
      [RUNTIME_BRIDGE_SCRIPTS.parm7Topology]: parm7Bridge,
    },
    bridgeCapabilityProbes: {
      parm7Topology: parm7BridgeProbe,
      ncRuntime: ncBridgeProbe,
    },
    capabilities: {
      matrix: capabilityMatrix,
      summary: capabilitySummary,
    },
    diagnosticsError: selectedEval.diagnosticsError,
  };

  emitCheckpoint('CHK_DEP_2_DIAGNOSTICS_SUMMARY', summary);

  const output = vscode.window.createOutputChannel('MD Viewer Diagnostics');
  output.clear();
  output.appendLine('MD Viewer dependency diagnostics');
  output.appendLine(JSON.stringify(summary, null, 2));
  output.appendLine('');
  output.appendLine('Capability matrix:');
  output.appendLine(formatCapabilityLine('Core runtime', capabilityMatrix.coreRuntime));
  output.appendLine(formatCapabilityLine('Amber topology (.parm7)', capabilityMatrix.amberTopology));
  output.appendLine(formatCapabilityLine('NetCDF trajectories (.nc)', capabilityMatrix.netcdfTrajectories));
  output.appendLine(formatCapabilityLine('Binary bridge scripts', capabilityMatrix.bridgeScripts));
  output.show(true);

  const hasBlockingIssue = [
    capabilityMatrix.coreRuntime,
    capabilityMatrix.amberTopology,
    capabilityMatrix.bridgeScripts,
  ].some((capability) => capability.status === 'blocked');
  const netcdfBlocked = capabilityMatrix.netcdfTrajectories.status === 'blocked';

  if (hasBlockingIssue || netcdfBlocked) {
    const blockingLines = [
      ...capabilityMatrix.coreRuntime.reasons,
      ...capabilityMatrix.amberTopology.reasons,
      ...capabilityMatrix.bridgeScripts.reasons,
      ...(netcdfBlocked ? capabilityMatrix.netcdfTrajectories.reasons : []),
    ];

    emitCheckpoint('CHK_DEP_3_DIAGNOSTICS_RESULT', {
      ok: false,
      hasBlockingIssue: true,
      extensionHost: hostInfo,
      selectedPythonExecutable: selectedEval.candidate.executable,
      selectedPythonSource: selectedEval.candidate.source,
      capabilitySummary,
      blockingIssues: blockingLines,
    });

    const action = await vscode.window.showWarningMessage(
      `MD Viewer runtime is blocked on ${hostInfo.locationLabel}.\n${withReasonText(blockingLines)}`,
      'Select Python Interpreter',
      'Bootstrap Remote Runtime',
      'Open Diagnostics Output'
    );
    if (action === 'Select Python Interpreter') {
      await vscode.commands.executeCommand('md-viewer.selectPythonInterpreter');
    } else if (action === 'Bootstrap Remote Runtime') {
      await vscode.commands.executeCommand('md-viewer.bootstrapRemoteRuntime');
    } else if (action === 'Open Diagnostics Output') {
      output.show(true);
    }
    return;
  }

  emitCheckpoint('CHK_DEP_3_DIAGNOSTICS_RESULT', {
    ok: true,
    hasBlockingIssue: false,
    extensionHost: hostInfo,
    selectedPythonExecutable: selectedEval.candidate.executable,
    selectedPythonSource: selectedEval.candidate.source,
    capabilitySummary,
  });

  if (capabilityMatrix.netcdfTrajectories.status === 'degraded') {
    const action = await vscode.window.showWarningMessage(
      `MD Viewer diagnostics passed on ${hostInfo.locationLabel}, but .nc support is DEGRADED on interpreter ${selectedEval.candidate.executable}.\n${withReasonText(capabilityMatrix.netcdfTrajectories.reasons)}`,
      'Select Python Interpreter',
      'Bootstrap Remote Runtime',
      'Open Diagnostics Output'
    );
    if (action === 'Select Python Interpreter') {
      await vscode.commands.executeCommand('md-viewer.selectPythonInterpreter');
    } else if (action === 'Bootstrap Remote Runtime') {
      await vscode.commands.executeCommand('md-viewer.bootstrapRemoteRuntime');
    } else if (action === 'Open Diagnostics Output') {
      output.show(true);
    }
    return;
  }

  void vscode.window.showInformationMessage(
    `MD Viewer diagnostics passed on ${hostInfo.locationLabel}. Core, .parm7, and .nc capabilities are ready.`
  );
}
