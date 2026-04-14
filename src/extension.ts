import * as vscode from 'vscode';
import { openMdDatasetDefault, openMdDatasetWithOptionsPanel } from './commands/openMdSetupPanel';

export function activate(context: vscode.ExtensionContext) {
  console.log('MD Viewer extension activated');

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

  context.subscriptions.push(launchDisposable);
  context.subscriptions.push(legacyOpenDisposable);
  context.subscriptions.push(legacyWithOptionsDisposable);
}

export function deactivate() {}
