import * as vscode from 'vscode';

export type CapabilityStatus = 'ok' | 'degraded' | 'blocked';

export type CapabilityMatrixSummary = {
  coreRuntime: CapabilityStatus;
  amberTopology: CapabilityStatus;
  netcdfTrajectories: CapabilityStatus;
  bridgeScripts: CapabilityStatus;
};

export type HostRuntimeState = {
  interpreter: string;
  validatedAt: string;
  extensionHost: string;
  workspaceRoot: string | null;
  capabilities: CapabilityMatrixSummary;
  selectionReason: string;
};

type HostStateMap = Record<string, HostRuntimeState>;

const HOST_STATE_KEY = 'mdViewer.hostRuntimeState.v1';

export function hostContextInfo(): {
  extensionHost: string;
  workspaceRoot: string | null;
  key: string;
} {
  const extensionHost = vscode.env.remoteName ? `remote:${vscode.env.remoteName}` : 'local';
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  const key = `${extensionHost}::${workspaceRoot ?? '<no-workspace>'}`;
  return { extensionHost, workspaceRoot, key };
}

function readHostStateMap(context: vscode.ExtensionContext): HostStateMap {
  return context.globalState.get<HostStateMap>(HOST_STATE_KEY) || {};
}

async function writeHostStateMap(context: vscode.ExtensionContext, map: HostStateMap): Promise<void> {
  await context.globalState.update(HOST_STATE_KEY, map);
}

export function getHostRuntimeState(context: vscode.ExtensionContext): HostRuntimeState | null {
  const map = readHostStateMap(context);
  const info = hostContextInfo();
  return map[info.key] || null;
}

export async function setHostRuntimeState(
  context: vscode.ExtensionContext,
  state: HostRuntimeState
): Promise<void> {
  const map = readHostStateMap(context);
  const info = hostContextInfo();
  map[info.key] = {
    ...state,
    extensionHost: info.extensionHost,
    workspaceRoot: info.workspaceRoot,
  };
  await writeHostStateMap(context, map);
}

export async function clearHostRuntimeState(context: vscode.ExtensionContext): Promise<void> {
  const map = readHostStateMap(context);
  const info = hostContextInfo();
  if (map[info.key]) {
    delete map[info.key];
    await writeHostStateMap(context, map);
  }
}
