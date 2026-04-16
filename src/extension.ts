import * as vscode from 'vscode';
import { openMdDatasetDefault, openMdDatasetWithOptionsPanel } from './commands/openMdSetupPanel';
import { runDependencyDiagnostics } from './commands/runDependencyDiagnostics';
import { selectPythonInterpreter } from './commands/selectPythonInterpreter';
import { bootstrapRemoteRuntime } from './commands/bootstrapRemoteRuntime';
import { getHostRuntimeState, hostContextInfo } from './runtime/hostRuntimeState';
import { differentHomePathReason, staleHostKeyReason } from './runtime/pythonRuntime';
import { setRuntimeBridgeBasePath } from './runtime/bridgePaths';
import { emitCheckpoint } from './runtimeCheckpoint';

let lastConfiguredPythonInterpreter: string | null = null;

function applyConfiguredPythonInterpreter(context: vscode.ExtensionContext): void {
  const hostInfo = hostContextInfo();
  process.env.MD_VIEWER_ACTIVE_HOST_KEY = hostInfo.key;
  if (hostInfo.homeDir) {
    process.env.MD_VIEWER_ACTIVE_HOME_DIR = hostInfo.homeDir;
  }

  const configured = vscode.workspace.getConfiguration('mdViewer').get<string>('pythonInterpreter');
  const trimmed = configured && configured.trim().length > 0 ? configured.trim() : null;
  if (trimmed) {
    process.env.MD_VIEWER_PYTHON = trimmed;
    process.env.MD_VIEWER_PYTHON_SOURCE = 'setting';
    process.env.MD_VIEWER_PYTHON_HOST_KEY = hostInfo.key;
    lastConfiguredPythonInterpreter = trimmed;
    emitCheckpoint('CHK_DEP_13_INTERPRETER_APPLIED', {
      source: 'setting',
      interpreter: trimmed,
      extensionHost: hostInfo.extensionHost,
      hostKey: hostInfo.key,
    });
    return;
  }

  const hostState = getHostRuntimeState(context);
  const cachedInterpreter = hostState?.interpreter || null;
  const envLastKnownInterpreter = (process.env.MD_VIEWER_LAST_GOOD_PYTHON || '').trim() || null;
  const envLastKnownHostKey = (process.env.MD_VIEWER_LAST_GOOD_PYTHON_HOST_KEY || '').trim() || null;
  const cachedStateRejectedReason = cachedInterpreter
    ? differentHomePathReason(cachedInterpreter, hostInfo.homeDir)
    : null;
  const envLastKnownRejectedReason = envLastKnownInterpreter
    ? staleHostKeyReason({ candidateHostKey: envLastKnownHostKey, currentHostKey: hostInfo.key })
      || differentHomePathReason(envLastKnownInterpreter, hostInfo.homeDir)
    : null;

  if (cachedInterpreter && cachedInterpreter.trim().length > 0 && !cachedStateRejectedReason) {
    process.env.MD_VIEWER_PYTHON = cachedInterpreter;
    process.env.MD_VIEWER_LAST_GOOD_PYTHON = cachedInterpreter;
    process.env.MD_VIEWER_PYTHON_SOURCE = 'cached';
    process.env.MD_VIEWER_PYTHON_HOST_KEY = hostInfo.key;
    process.env.MD_VIEWER_LAST_GOOD_PYTHON_HOST_KEY = hostInfo.key;
    emitCheckpoint('CHK_DEP_13_INTERPRETER_APPLIED', {
      source: 'cached',
      interpreter: cachedInterpreter,
      validatedAt: hostState?.validatedAt ?? null,
      extensionHost: hostInfo.extensionHost,
      hostKey: hostInfo.key,
      capabilities: hostState?.capabilities ?? null,
    });
  } else if (envLastKnownInterpreter && !envLastKnownRejectedReason) {
    process.env.MD_VIEWER_PYTHON = envLastKnownInterpreter;
    process.env.MD_VIEWER_PYTHON_SOURCE = 'cached';
    process.env.MD_VIEWER_PYTHON_HOST_KEY = hostInfo.key;
    emitCheckpoint('CHK_DEP_13_INTERPRETER_APPLIED', {
      source: 'env_last_known_good',
      interpreter: envLastKnownInterpreter,
      extensionHost: hostInfo.extensionHost,
      hostKey: hostInfo.key,
    });
  } else {
    delete process.env.MD_VIEWER_PYTHON;
    delete process.env.MD_VIEWER_PYTHON_SOURCE;
    delete process.env.MD_VIEWER_PYTHON_HOST_KEY;
    if (!envLastKnownInterpreter) {
      delete process.env.MD_VIEWER_LAST_GOOD_PYTHON;
      delete process.env.MD_VIEWER_LAST_GOOD_PYTHON_HOST_KEY;
    }
    if (
      lastConfiguredPythonInterpreter
      && process.env.MD_VIEWER_PYTHON === lastConfiguredPythonInterpreter
    ) {
      delete process.env.MD_VIEWER_PYTHON;
    }
    emitCheckpoint('CHK_DEP_13_INTERPRETER_APPLIED', {
      source: 'none',
      interpreter: null,
      extensionHost: hostInfo.extensionHost,
      hostKey: hostInfo.key,
      cachedInterpreterRejectedReason: cachedStateRejectedReason,
      envLastKnownRejectedReason,
    });
  }

  lastConfiguredPythonInterpreter = null;
}

export function activate(context: vscode.ExtensionContext) {
  console.log('MD Viewer extension activated');
  setRuntimeBridgeBasePath(context.extensionUri.fsPath);
  applyConfiguredPythonInterpreter(context);

  const launchDisposable = vscode.commands.registerCommand(
    'md-viewer.launch',
    (input?: vscode.Uri | { uri?: vscode.Uri | string; options?: unknown; autoConfirm?: boolean } | string) =>
      openMdDatasetDefault(context, input)
  );
  const legacyOpenDisposable = vscode.commands.registerCommand(
    'md-viewer.openDataset',
    (input?: vscode.Uri | { uri?: vscode.Uri | string; options?: unknown; autoConfirm?: boolean } | string) =>
      openMdDatasetDefault(context, input)
  );
  const legacyWithOptionsDisposable = vscode.commands.registerCommand(
    'md-viewer.openDatasetWithOptions',
    (input?: vscode.Uri | { uri?: vscode.Uri | string; options?: unknown; autoConfirm?: boolean } | string) =>
      openMdDatasetWithOptionsPanel(context, input)
  );
  const diagnosticsDisposable = vscode.commands.registerCommand(
    'md-viewer.runDependencyDiagnostics',
    () => runDependencyDiagnostics(context)
  );
  const selectPythonInterpreterDisposable = vscode.commands.registerCommand(
    'md-viewer.selectPythonInterpreter',
    () => selectPythonInterpreter(context)
  );
  const bootstrapRemoteRuntimeDisposable = vscode.commands.registerCommand(
    'md-viewer.bootstrapRemoteRuntime',
    () => bootstrapRemoteRuntime(context)
  );
  const configWatcherDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('mdViewer.pythonInterpreter')) {
      applyConfiguredPythonInterpreter(context);
    }
  });

  context.subscriptions.push(launchDisposable);
  context.subscriptions.push(legacyOpenDisposable);
  context.subscriptions.push(legacyWithOptionsDisposable);
  context.subscriptions.push(diagnosticsDisposable);
  context.subscriptions.push(selectPythonInterpreterDisposable);
  context.subscriptions.push(bootstrapRemoteRuntimeDisposable);
  context.subscriptions.push(configWatcherDisposable);
}

export function deactivate() {}
