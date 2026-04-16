import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
  hostName: string;
  homeDir: string | null;
  workspaceRoot: string | null;
  capabilities: CapabilityMatrixSummary;
  selectionReason: string;
};

type HostStateMap = Record<string, HostRuntimeState>;

const HOST_STATE_KEY = 'mdViewer.hostRuntimeState.v2';

function normalizeFsPath(value: string | null): string | null {
  if (!value || value.trim().length === 0) return null;
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

export function buildHostContextKey(input: {
  extensionHost: string;
  hostName: string;
  homeDir: string | null;
  workspaceRoot: string | null;
}): string {
  return [
    input.extensionHost,
    input.hostName || '<unknown-host>',
    input.homeDir || '<unknown-home>',
    input.workspaceRoot || '<no-workspace>',
  ].join('::');
}

export function hostContextInfo(): {
  extensionHost: string;
  hostName: string;
  homeDir: string | null;
  workspaceRoot: string | null;
  key: string;
} {
  const extensionHost = vscode.env.remoteName ? `remote:${vscode.env.remoteName}` : 'local';
  const hostName = os.hostname();
  const homeDir = normalizeFsPath(os.homedir());
  const workspaceRoot = normalizeFsPath(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null);
  const key = buildHostContextKey({
    extensionHost,
    hostName,
    homeDir,
    workspaceRoot,
  });
  return { extensionHost, hostName, homeDir, workspaceRoot, key };
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
  state: Omit<HostRuntimeState, 'extensionHost' | 'hostName' | 'homeDir' | 'workspaceRoot'>
    & Partial<Pick<HostRuntimeState, 'extensionHost' | 'hostName' | 'homeDir' | 'workspaceRoot'>>
): Promise<void> {
  const map = readHostStateMap(context);
  const info = hostContextInfo();
  map[info.key] = {
    ...state,
    extensionHost: info.extensionHost,
    hostName: info.hostName,
    homeDir: info.homeDir,
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
