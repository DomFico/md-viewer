import * as vscode from 'vscode';
import { openMdDatasetDefault, openMdDatasetWithOptionsPanel } from './commands/openMdSetupPanel';
import { runDependencyDiagnostics } from './commands/runDependencyDiagnostics';

let lastConfiguredPythonInterpreter: string | null = null;

function applyConfiguredPythonInterpreter(): void {
  const configured = vscode.workspace.getConfiguration('mdViewer').get<string>('pythonInterpreter');
  const trimmed = configured && configured.trim().length > 0 ? configured.trim() : null;
  if (trimmed) {
    process.env.MD_VIEWER_PYTHON = trimmed;
    lastConfiguredPythonInterpreter = trimmed;
    return;
  }

  if (
    lastConfiguredPythonInterpreter
    && process.env.MD_VIEWER_PYTHON === lastConfiguredPythonInterpreter
  ) {
    delete process.env.MD_VIEWER_PYTHON;
  }
  lastConfiguredPythonInterpreter = null;
}

export function activate(context: vscode.ExtensionContext) {
  console.log('MD Viewer extension activated');
  applyConfiguredPythonInterpreter();

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
    () => runDependencyDiagnostics()
  );
  const configWatcherDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('mdViewer.pythonInterpreter')) {
      applyConfiguredPythonInterpreter();
    }
  });

  context.subscriptions.push(launchDisposable);
  context.subscriptions.push(legacyOpenDisposable);
  context.subscriptions.push(legacyWithOptionsDisposable);
  context.subscriptions.push(diagnosticsDisposable);
  context.subscriptions.push(configWatcherDisposable);
}

export function deactivate() {}
