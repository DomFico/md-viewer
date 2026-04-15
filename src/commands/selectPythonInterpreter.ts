import * as vscode from 'vscode';
import { emitCheckpoint } from '../runtimeCheckpoint';
import { preferredPythonExecutable, resolveExecutablePath } from '../runtime/pythonRuntime';

type InterpreterPick = vscode.QuickPickItem & {
  value: string;
  entryType: 'configured' | 'resolved' | 'fallback' | 'auto' | 'browse';
};

function settingTarget(): vscode.ConfigurationTarget {
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    return vscode.ConfigurationTarget.Workspace;
  }
  return vscode.ConfigurationTarget.Global;
}

function addCandidate(
  picks: InterpreterPick[],
  seen: Set<string>,
  label: string,
  value: string,
  entryType: InterpreterPick['entryType']
): void {
  const normalized = value.trim();
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  const resolved = resolveExecutablePath(normalized);
  picks.push({
    label,
    value: normalized,
    entryType,
    description: resolved ? `Resolved: ${resolved}` : 'Not currently resolvable from PATH',
  });
}

export async function selectPythonInterpreter(): Promise<void> {
  const config = vscode.workspace.getConfiguration('mdViewer');
  const configured = (config.get<string>('pythonInterpreter') || '').trim();
  const preferred = preferredPythonExecutable();
  const target = settingTarget();

  const picks: InterpreterPick[] = [];
  const seen = new Set<string>();

  picks.push({
    label: 'Use Environment Default',
    value: '',
    entryType: 'auto',
    description: `Current auto value: ${preferred}`,
    detail: 'Clears mdViewer.pythonInterpreter and falls back to environment/PATH.',
  });

  if (configured) {
    addCandidate(picks, seen, `Configured: ${configured}`, configured, 'configured');
  }

  const common = ['python', 'python3', 'python3.12', 'python3.11', 'python3.10', preferred];
  for (const candidate of common) {
    addCandidate(picks, seen, candidate, candidate, 'resolved');
  }

  picks.push({
    label: 'Browse for Python Executable...',
    value: '__BROWSE__',
    entryType: 'browse',
    description: 'Pick an absolute interpreter path from disk.',
  });

  const pick = await vscode.window.showQuickPick<InterpreterPick>(picks, {
    title: 'MD Viewer: Select Python Interpreter',
    placeHolder: configured || preferred,
  });

  if (!pick) return;

  if (pick.entryType === 'browse') {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Use Python Interpreter',
    });
    if (!selected || selected.length === 0) return;
    const value = selected[0].fsPath;
    await config.update('pythonInterpreter', value, target);
    process.env.MD_VIEWER_PYTHON = value;
    emitCheckpoint('CHK_DEP_4_INTERPRETER_SELECTED', {
      source: 'browse',
      configuredPythonInterpreter: value,
      resolvedPythonPath: resolveExecutablePath(value),
      extensionHost: vscode.env.remoteName ? `remote:${vscode.env.remoteName}` : 'local',
    });
    void vscode.window.showInformationMessage(`MD Viewer Python interpreter set to: ${value}`);
    return;
  }

  if (pick.entryType === 'auto') {
    await config.update('pythonInterpreter', '', target);
    delete process.env.MD_VIEWER_PYTHON;
    emitCheckpoint('CHK_DEP_4_INTERPRETER_SELECTED', {
      source: 'auto',
      configuredPythonInterpreter: null,
      selectedPythonExecutable: preferredPythonExecutable(),
      extensionHost: vscode.env.remoteName ? `remote:${vscode.env.remoteName}` : 'local',
    });
    void vscode.window.showInformationMessage('MD Viewer Python interpreter reset to environment default.');
    return;
  }

  await config.update('pythonInterpreter', pick.value, target);
  process.env.MD_VIEWER_PYTHON = pick.value;
  emitCheckpoint('CHK_DEP_4_INTERPRETER_SELECTED', {
    source: pick.entryType,
    configuredPythonInterpreter: pick.value,
    resolvedPythonPath: resolveExecutablePath(pick.value),
    extensionHost: vscode.env.remoteName ? `remote:${vscode.env.remoteName}` : 'local',
  });
  void vscode.window.showInformationMessage(`MD Viewer Python interpreter set to: ${pick.value}`);
}
