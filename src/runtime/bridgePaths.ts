import * as fs from 'fs';
import * as path from 'path';

export const RUNTIME_BRIDGE_SCRIPTS = {
  binaryTrajectory: 'binary_traj_bridge.py',
  parm7Topology: 'parm7_topology_bridge.py',
} as const;

export function bridgeCandidatePaths(scriptName: string): string[] {
  return [
    // Packaged extension layout: <extension-root>/out/** -> <extension-root>/scripts
    path.resolve(__dirname, '../../scripts', scriptName),
    // Monorepo/dev fallback layout: <repo-root>/scripts
    path.resolve(__dirname, '../../../scripts', scriptName),
  ];
}

export function resolveRuntimeBridgePath(scriptName: string): string {
  const candidates = bridgeCandidatePaths(scriptName);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}
