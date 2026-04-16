import * as fs from 'fs';
import * as path from 'path';

export const RUNTIME_BRIDGE_SCRIPTS = {
  binaryTrajectory: 'binary_traj_bridge.py',
  parm7Topology: 'parm7_topology_bridge.py',
} as const;

type BridgeCandidateDescriptor = {
  source: 'extension_root' | 'module_relative_packaged' | 'module_relative_monorepo';
  path: string;
};

export type BridgePathResolution = {
  scriptName: string;
  selectedPath: string;
  selectedExists: boolean;
  selectedSource: BridgeCandidateDescriptor['source'] | 'fallback_first_candidate';
  candidatePaths: string[];
  extensionRoot: string | null;
  pathMatchesExtensionRoot: boolean | null;
};

let runtimeBridgeBasePath: string | null = null;

export function setRuntimeBridgeBasePath(extensionRoot: string | null): void {
  runtimeBridgeBasePath = extensionRoot && extensionRoot.trim().length > 0
    ? path.resolve(extensionRoot)
    : null;
}

function bridgeCandidateDescriptors(scriptName: string): BridgeCandidateDescriptor[] {
  const descriptors: BridgeCandidateDescriptor[] = [];
  if (runtimeBridgeBasePath) {
    descriptors.push({
      source: 'extension_root',
      path: path.resolve(runtimeBridgeBasePath, 'scripts', scriptName),
    });
  }

  descriptors.push(
    {
      source: 'module_relative_packaged',
      path: path.resolve(__dirname, '../../scripts', scriptName),
    },
    {
      source: 'module_relative_monorepo',
      path: path.resolve(__dirname, '../../../scripts', scriptName),
    }
  );

  const unique = new Map<string, BridgeCandidateDescriptor>();
  for (const descriptor of descriptors) {
    if (!unique.has(descriptor.path)) {
      unique.set(descriptor.path, descriptor);
    }
  }
  return Array.from(unique.values());
}

export function bridgeCandidatePaths(scriptName: string): string[] {
  return bridgeCandidateDescriptors(scriptName).map((descriptor) => descriptor.path);
}

export function resolveRuntimeBridge(scriptName: string): BridgePathResolution {
  const candidates = bridgeCandidateDescriptors(scriptName);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate.path)) {
      return {
        scriptName,
        selectedPath: candidate.path,
        selectedExists: true,
        selectedSource: candidate.source,
        candidatePaths: candidates.map((entry) => entry.path),
        extensionRoot: runtimeBridgeBasePath,
        pathMatchesExtensionRoot: runtimeBridgeBasePath
          ? candidate.path === path.resolve(runtimeBridgeBasePath, 'scripts', scriptName)
          : null,
      };
    }
  }

  return {
    scriptName,
    selectedPath: candidates[0].path,
    selectedExists: false,
    selectedSource: 'fallback_first_candidate',
    candidatePaths: candidates.map((entry) => entry.path),
    extensionRoot: runtimeBridgeBasePath,
    pathMatchesExtensionRoot: runtimeBridgeBasePath
      ? candidates[0].path === path.resolve(runtimeBridgeBasePath, 'scripts', scriptName)
      : null,
  };
}

export function resolveRuntimeBridgePath(scriptName: string): string {
  return resolveRuntimeBridge(scriptName).selectedPath;
}
