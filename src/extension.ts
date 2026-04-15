import * as vscode from 'vscode';
import { openMdDatasetDefault, openMdDatasetWithOptionsPanel } from './commands/openMdSetupPanel';
import { runDependencyDiagnostics } from './commands/runDependencyDiagnostics';
import { selectPythonInterpreter } from './commands/selectPythonInterpreter';
import { bootstrapRemoteRuntime } from './commands/bootstrapRemoteRuntime';
import { getHostRuntimeState } from './runtime/hostRuntimeState';
import { emitCheckpoint } from './runtimeCheckpoint';

let lastConfiguredPythonInterpreter: string | null = null;

function applyConfiguredPythonInterpreter(context: vscode.ExtensionContext): void {
  const configured = vscode.workspace.getConfiguration('mdViewer').get<string>('pythonInterpreter');
  const trimmed = configured && configured.trim().length > 0 ? configured.trim() : null;
  if (trimmed) {
    process.env.MD_VIEWER_PYTHON = trimmed;
    process.env.MD_VIEWER_LAST_GOOD_PYTHON = trimmed;
    lastConfiguredPythonInterpreter = trimmed;
    emitCheckpoint('CHK_DEP_13_INTERPRETER_APPLIED', {
      source: 'setting',
      interpreter: trimmed,
      extensionHost: vscode.env.remoteName ? `remote:${vscode.env.remoteName}` : 'local',
    });
    return;
  }

  const hostState = getHostRuntimeState(context);
  const cachedInterpreter = hostState?.interpreter || null;
  const envLastKnownInterpreter = (process.env.MD_VIEWER_LAST_GOOD_PYTHON || '').trim() || null;
  if (cachedInterpreter && cachedInterpreter.trim().length > 0) {
    process.env.MD_VIEWER_PYTHON = cachedInterpreter;
    process.env.MD_VIEWER_LAST_GOOD_PYTHON = cachedInterpreter;
    emitCheckpoint('CHK_DEP_13_INTERPRETER_APPLIED', {
      source: 'cached',
      interpreter: cachedInterpreter,
      validatedAt: hostState?.validatedAt ?? null,
      extensionHost: vscode.env.remoteName ? `remote:${vscode.env.remoteName}` : 'local',
      capabilities: hostState?.capabilities ?? null,
    });
  } else if (envLastKnownInterpreter) {
    process.env.MD_VIEWER_PYTHON = envLastKnownInterpreter;
    emitCheckpoint('CHK_DEP_13_INTERPRETER_APPLIED', {
      source: 'env_last_known_good',
      interpreter: envLastKnownInterpreter,
      extensionHost: vscode.env.remoteName ? `remote:${vscode.env.remoteName}` : 'local',
    });
  } else {
    if (
      lastConfiguredPythonInterpreter
      && process.env.MD_VIEWER_PYTHON === lastConfiguredPythonInterpreter
    ) {
      delete process.env.MD_VIEWER_PYTHON;
    }
  }

  lastConfiguredPythonInterpreter = null;
}

export function activate(context: vscode.ExtensionContext) {
  console.log('MD Viewer extension activated');
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
