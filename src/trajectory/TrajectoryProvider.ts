export type TrajectoryAccessMode = 'eager' | 'chunked' | 'lazy';

export interface TrajectoryProviderMetadata {
  atomCount: number;
  frameCount: number;
  format: string;
  sourceName: string;
  accessMode: TrajectoryAccessMode;
  supportsChunkRequests: boolean;
  defaultChunkSize?: number;
}

export interface TrajectoryFrameChunk {
  start: number;
  count: number;
  stride: number;
  frameIndices: number[];
  frames: Float32Array[];
  fromCache: boolean;
}

export interface TrajectoryProvider {
  getMetadata(): Promise<TrajectoryProviderMetadata>;
  getFrame(index: number): Promise<Float32Array>;
  getFrameChunk(start: number, count: number, stride?: number): Promise<TrajectoryFrameChunk>;
}

export class InMemoryTrajectoryProvider implements TrajectoryProvider {
  private readonly metadata: TrajectoryProviderMetadata;

  constructor(
    private readonly frames: Float32Array[],
    options: {
      atomCount: number;
      format: string;
      sourceName: string;
    }
  ) {
    this.metadata = {
      atomCount: options.atomCount,
      frameCount: frames.length,
      format: options.format,
      sourceName: options.sourceName,
      accessMode: 'eager',
      supportsChunkRequests: false,
      defaultChunkSize: frames.length,
    };
  }

  async getMetadata(): Promise<TrajectoryProviderMetadata> {
    return this.metadata;
  }

  async getFrame(index: number): Promise<Float32Array> {
    if (!Number.isInteger(index) || index < 0 || index >= this.frames.length) {
      throw new Error(`Frame index out of range: ${index}`);
    }
    return this.frames[index];
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

    const frameIndices: number[] = [];
    const chunkFrames: Float32Array[] = [];

    for (let idx = start; idx < this.frames.length && frameIndices.length < count; idx += stride) {
      frameIndices.push(idx);
      chunkFrames.push(this.frames[idx]);
    }

    return {
      start,
      count: chunkFrames.length,
      stride,
      frameIndices,
      frames: chunkFrames,
      fromCache: true,
    };
  }
}
