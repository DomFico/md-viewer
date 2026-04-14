import { spawn } from 'child_process';
import { emitCheckpoint } from '../runtimeCheckpoint';
import { preferredPythonExecutable, resolveExecutablePath } from '../runtime/pythonRuntime';
import {
  TrajectoryProvider,
  TrajectoryProviderMetadata,
  TrajectoryFrameChunk,
} from './TrajectoryProvider';

export type BridgeTrajectoryFormat = 'xtc' | 'dcd' | 'trr' | 'nc' | 'rst7';

type BridgeMode = 'metadata' | 'chunk' | 'full';

type BridgeCheckpointNames = {
  launch: string;
  exit: string;
  parsed: string;
};

type BridgeRequest = {
  mode: BridgeMode;
  start?: number;
  count?: number;
  stride?: number;
};

interface BinaryBridgeProviderOptions {
  trajectoryPath: string;
  topologyPath: string;
  format: BridgeTrajectoryFormat;
  sourceName: string;
  bridgePath: string;
  checkpoints: BridgeCheckpointNames;
  accessMode: 'chunked' | 'eager';
  defaultChunkSize: number;
}

interface BridgeResponseBase {
  atomCount?: number;
  frameCount?: number;
  sourceFormat?: string;
}

interface BridgeChunkResponse extends BridgeResponseBase {
  start?: number;
  count?: number;
  stride?: number;
  frameIndices?: number[];
  frames?: number[][];
}

interface BridgeFullResponse extends BridgeResponseBase {
  frames?: number[][];
}

export class BinaryBridgeTrajectoryProvider implements TrajectoryProvider {
  private metadataCache?: TrajectoryProviderMetadata;
  private readonly frameCache = new Map<number, Float32Array>();
  private readonly inflightChunkRequests = new Map<string, Promise<TrajectoryFrameChunk>>();

  constructor(private readonly options: BinaryBridgeProviderOptions) {}

  async getMetadata(): Promise<TrajectoryProviderMetadata> {
    if (this.metadataCache) {
      return this.metadataCache;
    }

    const parsed = await this.runBridge({ mode: 'metadata' }) as BridgeResponseBase;
    const atomCount = Number(parsed?.atomCount ?? 0);
    const frameCount = Number(parsed?.frameCount ?? 0);
    if (!Number.isFinite(atomCount) || atomCount <= 0) {
      throw new Error(`Bridge metadata missing valid atomCount for ${this.options.format}`);
    }
    if (!Number.isFinite(frameCount) || frameCount <= 0) {
      throw new Error(`Bridge metadata missing valid frameCount for ${this.options.format}`);
    }

    this.metadataCache = {
      atomCount,
      frameCount,
      format: this.options.format,
      sourceName: this.options.sourceName,
      accessMode: this.options.accessMode,
      supportsChunkRequests: this.options.accessMode === 'chunked',
      defaultChunkSize: this.options.defaultChunkSize,
    };

    return this.metadataCache;
  }

  async getFrame(index: number): Promise<Float32Array> {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`Invalid frame index: ${index}`);
    }
    const cached = this.frameCache.get(index);
    if (cached) {
      return cached;
    }

    const chunk = await this.getFrameChunk(index, 1, 1);
    if (chunk.frames.length === 0) {
      throw new Error(`Bridge returned no frames for requested index ${index}`);
    }
    return chunk.frames[0];
  }

  async getFrameChunk(start: number, count: number, stride = 1): Promise<TrajectoryFrameChunk> {
    if (!Number.isInteger(start) || start < 0) {
      throw new Error(`Invalid chunk start: ${start}`);
    }
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`Invalid chunk count: ${count}`);
    }
    if (!Number.isInteger(stride) || stride <= 0) {
      throw new Error(`Invalid chunk stride: ${stride}`);
    }

    const metadata = await this.getMetadata();
    const expectedIndices = buildExpectedFrameIndices(metadata.frameCount, start, count, stride);
    const allCached = expectedIndices.every((frameIndex) => this.frameCache.has(frameIndex));
    if (allCached) {
      return {
        start,
        count: expectedIndices.length,
        stride,
        frameIndices: expectedIndices,
        frames: expectedIndices.map((frameIndex) => this.frameCache.get(frameIndex) as Float32Array),
        fromCache: true,
      };
    }

    const cacheKey = `${start}:${count}:${stride}`;
    const inflight = this.inflightChunkRequests.get(cacheKey);
    if (inflight) {
      return inflight;
    }

    const promise = this.fetchFrameChunk(start, count, stride);
    this.inflightChunkRequests.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.inflightChunkRequests.delete(cacheKey);
    }
  }

  private async fetchFrameChunk(start: number, count: number, stride: number): Promise<TrajectoryFrameChunk> {
    const parsed = await this.runBridge({ mode: 'chunk', start, count, stride }) as BridgeChunkResponse;
    const frameIndices = Array.isArray(parsed?.frameIndices) ? parsed.frameIndices.map((idx) => Number(idx)) : [];
    const rawFrames = Array.isArray(parsed?.frames) ? parsed.frames : [];

    if (frameIndices.length !== rawFrames.length) {
      throw new Error(
        `Bridge chunk response mismatch: frameIndices=${frameIndices.length}, frames=${rawFrames.length}`
      );
    }

    const frames: Float32Array[] = rawFrames.map((values: number[]) => new Float32Array(values));
    for (let i = 0; i < frameIndices.length; i++) {
      this.frameCache.set(frameIndices[i], frames[i]);
    }

    return {
      start,
      count: frames.length,
      stride,
      frameIndices,
      frames,
      fromCache: false,
    };
  }

  async loadAllFramesEagerly(): Promise<Float32Array[]> {
    const parsed = await this.runBridge({ mode: 'full' }) as BridgeFullResponse;
    const rawFrames = Array.isArray(parsed?.frames) ? parsed.frames : [];
    const frames = rawFrames.map((values: number[]) => new Float32Array(values));
    for (let i = 0; i < frames.length; i++) {
      this.frameCache.set(i, frames[i]);
    }

    if (!this.metadataCache) {
      const atomCount = Number(parsed?.atomCount ?? 0);
      const frameCount = Number(parsed?.frameCount ?? frames.length);
      this.metadataCache = {
        atomCount,
        frameCount,
        format: this.options.format,
        sourceName: this.options.sourceName,
        accessMode: this.options.accessMode,
        supportsChunkRequests: this.options.accessMode === 'chunked',
        defaultChunkSize: this.options.defaultChunkSize,
      };
    }

    return frames;
  }

  private async runBridge(request: BridgeRequest): Promise<unknown> {
    const pythonExecutable = preferredPythonExecutable();
    const pythonExecutableResolved = resolveExecutablePath(pythonExecutable);
    const spawnArgs = [
      this.options.bridgePath,
      '--mode',
      request.mode,
      '--traj',
      this.options.trajectoryPath,
      '--top',
      this.options.topologyPath,
      '--format',
      this.options.format,
    ];

    if (request.mode === 'chunk') {
      spawnArgs.push('--start', String(request.start ?? 0));
      spawnArgs.push('--count', String(request.count ?? 0));
      spawnArgs.push('--stride', String(request.stride ?? 1));
    }

    emitCheckpoint(this.options.checkpoints.launch, {
      pythonExecutable,
      pythonExecutableResolved,
      bridgePath: this.options.bridgePath,
      trajectoryPath: this.options.trajectoryPath,
      topologyPath: this.options.topologyPath,
      format: this.options.format,
      request,
      spawnArgs,
    });

    return await new Promise((resolve, reject) => {
      const child = spawn(pythonExecutable, spawnArgs);
      const stdoutChunks: Buffer[] = [];
      let stderrData = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderrData += chunk.toString('utf8');
      });

      child.on('close', (code: number | null) => {
        const fullOutput = Buffer.concat(stdoutChunks).toString('utf8');

        emitCheckpoint(this.options.checkpoints.exit, {
          exitCode: code,
          stderr: summarizeText(stderrData),
          stdoutFirst200Chars: summarizeText(fullOutput),
          stdoutLength: fullOutput.length,
          stderrLength: stderrData.length,
          pythonExecutable,
          pythonExecutableResolved,
          bridgePath: this.options.bridgePath,
          format: this.options.format,
          request,
          spawnArgs,
        });

        if (code !== 0) {
          reject(new Error(`${this.options.format.toUpperCase()} bridge failed with code ${code}. stderr: ${stderrData}`));
          return;
        }

        try {
          const parsed = parseBridgeJson(fullOutput) as any;
          emitCheckpoint(this.options.checkpoints.parsed, {
            jsonParseSucceeded: true,
            mode: request.mode,
            parsedKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [],
            atomCount: parsed?.atomCount ?? null,
            frameCount: parsed?.frameCount ?? (Array.isArray(parsed?.frames) ? parsed.frames.length : null),
            returnedFrames: Array.isArray(parsed?.frames) ? parsed.frames.length : null,
          });
          if (parsed?.error) {
            reject(new Error(String(parsed.error)));
            return;
          }
          resolve(parsed);
        } catch (err) {
          emitCheckpoint(this.options.checkpoints.parsed, {
            jsonParseSucceeded: false,
            mode: request.mode,
            parseError: err instanceof Error ? err.message : String(err),
            stdoutFirst200Chars: summarizeText(fullOutput),
          });
          reject(new Error(`Failed to parse ${this.options.format} bridge output: ${err instanceof Error ? err.message : String(err)}`));
        }
      });

      child.on('error', (err: unknown) => {
        emitCheckpoint(this.options.checkpoints.exit, {
          exitCode: null,
          spawnError: err instanceof Error ? err.message : String(err),
          stderr: summarizeText(stderrData),
          stdoutFirst200Chars: summarizeText(Buffer.concat(stdoutChunks).toString('utf8')),
          pythonExecutable,
          pythonExecutableResolved,
          bridgePath: this.options.bridgePath,
          format: this.options.format,
          request,
          spawnArgs,
        });
        reject(new Error(`Failed to spawn ${this.options.format} bridge: ${err instanceof Error ? err.message : String(err)}`));
      });
    });
  }
}

function buildExpectedFrameIndices(frameCount: number, start: number, count: number, stride: number): number[] {
  const indices: number[] = [];
  for (let idx = start; idx < frameCount && indices.length < count; idx += stride) {
    indices.push(idx);
  }
  return indices;
}

function summarizeText(text: string, limit = 200): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}...[truncated ${text.length - limit} chars]`;
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
