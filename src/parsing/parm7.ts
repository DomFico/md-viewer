import * as fs from 'fs';
import { spawn } from 'child_process';
import { ITopologyParser } from './IParser';
import { TopologyMetadata } from './pdb';
import { RUNTIME_BRIDGE_SCRIPTS, resolveRuntimeBridgePath } from '../runtime/bridgePaths';
import { preferredPythonExecutable } from '../runtime/pythonRuntime';

export class Parm7Parser implements ITopologyParser {
  canParse(ext: string): boolean {
    return ext === '.parm7' || ext === '.prmtop';
  }

  async parse(filePath: string): Promise<TopologyMetadata> {
    const bridgePath = resolveRuntimeBridgePath(RUNTIME_BRIDGE_SCRIPTS.parm7Topology);
    if (!fs.existsSync(bridgePath)) {
      throw new Error(`.parm7 parser bridge is missing: ${bridgePath}`);
    }

    const pythonExecutable = preferredPythonExecutable();
    const args = [bridgePath, filePath];

    const raw = await new Promise<string>((resolve, reject) => {
      const child = spawn(pythonExecutable, args);
      const stdoutChunks: Buffer[] = [];
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      child.on('close', (code: number | null) => {
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        if (code !== 0) {
          reject(new Error(`.parm7 parser bridge failed with code ${code}: ${stderr || stdout}`));
          return;
        }
        resolve(stdout);
      });

      child.on('error', (err: unknown) => {
        reject(new Error(`Failed to spawn .parm7 parser bridge: ${err instanceof Error ? err.message : String(err)}`));
      });
    });

    let parsed: any;
    try {
      parsed = parseBridgeJson(raw);
    } catch (err: unknown) {
      throw new Error(`Failed to parse .parm7 bridge JSON: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (parsed?.error) {
      throw new Error(String(parsed.error));
    }

    const topology = normalizeTopology(parsed);
    if (!topology.hasTopology) {
      throw new Error('.parm7 parser returned hasTopology=false');
    }
    return topology;
  }
}

function normalizeTopology(input: any): TopologyMetadata {
  const asNumberArray = (value: unknown): number[] => (
    Array.isArray(value)
      ? value
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry))
      : []
  );

  const residueEntries = Array.isArray(input?.residueEntries)
    ? input.residueEntries.map((entry: any) => ({
      chainId: typeof entry?.chainId === 'string' ? entry.chainId : '',
      chainIndex: Number.isFinite(Number(entry?.chainIndex)) ? Number(entry.chainIndex) : 0,
      resSeq: Number.isFinite(Number(entry?.resSeq)) ? Number(entry.resSeq) : 0,
      insertionCode: typeof entry?.insertionCode === 'string' ? entry.insertionCode : '',
      resName: typeof entry?.resName === 'string' ? entry.resName : 'UNK',
      atomIndices: asNumberArray(entry?.atomIndices),
      isLigand: Boolean(entry?.isLigand),
      isIon: Boolean(entry?.isIon),
      isPolymer: typeof entry?.isPolymer === 'boolean' ? entry.isPolymer : undefined,
      isSolvent: typeof entry?.isSolvent === 'boolean' ? entry.isSolvent : undefined,
    }))
    : [];

  return {
    hasTopology: Boolean(input?.hasTopology),
    bondPairs: asNumberArray(input?.bondPairs),
    chainInference: (
      input?.chainInference && typeof input.chainInference === 'object'
        ? {
          mode: typeof input.chainInference.mode === 'string' ? input.chainInference.mode : undefined,
          topologyChainCount: Number.isFinite(Number(input.chainInference.topologyChainCount))
            ? Number(input.chainInference.topologyChainCount)
            : undefined,
          componentCount: Number.isFinite(Number(input.chainInference.componentCount))
            ? Number(input.chainInference.componentCount)
            : undefined,
          componentSizes: asNumberArray(input.chainInference.componentSizes),
        }
        : undefined
    ),
    caIndices: asNumberArray(input?.caIndices),
    caLinePairs: asNumberArray(input?.caLinePairs),
    ligandIndices: asNumberArray(input?.ligandIndices),
    ionIndices: asNumberArray(input?.ionIndices),
    ligandIonIndices: asNumberArray(input?.ligandIonIndices),
    chains: Array.isArray(input?.chains)
      ? input.chains.map((value: any) => (typeof value === 'string' ? value : String(value ?? '')))
      : [],
    atomToChain: asNumberArray(input?.atomToChain),
    residueEntries,
    atomToResidue: asNumberArray(input?.atomToResidue),
    atomNames: Array.isArray(input?.atomNames)
      ? input.atomNames.map((value: any) => (typeof value === 'string' ? value : String(value ?? '')))
      : [],
    elements: Array.isArray(input?.elements)
      ? input.elements.map((value: any) => (typeof value === 'string' ? value : String(value ?? '')))
      : [],
  };
}

function parseBridgeJson(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch (primaryError) {
    const firstBrace = output.indexOf('{');
    const lastBrace = output.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw primaryError;
    }
    const candidate = output.slice(firstBrace, lastBrace + 1);
    return JSON.parse(candidate);
  }
}
