import { TrajectoryAccessMode, TrajectoryProvider } from '../trajectory/TrajectoryProvider';

export type ClassificationBucket = 'polymer' | 'ligand' | 'ion' | 'solvent' | 'unknown';

export interface AtomRecordNormalized {
  index: number;
  name: string;
  element: string;
  residueId: number;
  residueName: string;
  chainIdentifier: string;
  isHetero: boolean;
  classification: ClassificationBucket;
  isCommonSolvent: boolean;
}

export interface ResidueRecordNormalized {
  id: number;
  name: string;
  seqNumber: number;
  chainIdentifier: string;
  atomIndices: number[];
  classification: ClassificationBucket;
  isCommonSolvent: boolean;
}

export interface NormalizedDataset {
  metadata: {
    id: string;
    trajectorySource: string;
    topologySource?: string;
  };
  structure: {
    atomCount: number;
    atoms: AtomRecordNormalized[];
    residues: ResidueRecordNormalized[];
    bonds?: number[]; 
    bondPairs?: number[];
    hasTopology: boolean;
  };
  classification: {
    caIndices: number[];
    ligandIndices: number[];
    ionIndices: number[];
    solventIndices: number[];
    commonSolventIndices: number[];
    polymerIndices: number[];
    residueNameCounts: Record<string, number>;
    commonSolventResidueNames: string[];
    commonSolventThreshold: number;
  };
  trajectory: {
    frameCount: number;
    provider: TrajectoryProvider;
    sourceFormat: string;
    accessMode: TrajectoryAccessMode;
  };
}

export interface ViewerPayload {
  data: {
    atomCount: number;
    atoms: any[]; 
    frames: Float32Array[];
    sourceName: string;
    trajectory?: {
      atomCount: number;
      frameCount: number;
      rawFrameCount?: number;
      sampledFrameCount?: number;
      samplingFrameStride?: number;
      format: string;
      accessMode: TrajectoryAccessMode;
      supportsFrameRequests: boolean;
      chunkSizeHint: number;
      initialFrameIndices: number[];
      initialFrameRawIndices?: number[];
      initialFrameStride?: number;
    };
    displayFilter?: {
      selectionPreset: string;
      solventHandling: string;
      functionalModel?: string;
      allowedClasses?: string[];
      hiddenAtomIndices: number[];
      hiddenResidueIds: number[];
      visibleAtomCount: number;
      hiddenAtomCount: number;
      visibleResidueCount: number;
      hiddenResidueCount: number;
      applied: boolean;
      reason: string;
      functional: boolean;
    };
    topology: any; 
  };
  stats: {
    originalFramesCount: number;
    decimated: boolean;
    initFrameCount?: number;
    initPayloadEstimatedFloatCount?: number;
    fullTrajectoryEstimatedFloatCount?: number;
    initFrameStride?: number;
    initRequestedFrameCount?: number;
    rawFrameCount?: number;
    sampledFrameCount?: number;
    visibleAtomCount?: number;
    hiddenAtomCount?: number;
  };
  config: Record<string, any>;
}
