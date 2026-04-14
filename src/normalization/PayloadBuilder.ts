import { NormalizedDataset, ViewerPayload } from '../types/NormalizedDataset';
import { emitCheckpoint } from '../runtimeCheckpoint';
import { SelectionPreset, SolventHandling } from '../options/LoadOptions';

export interface BuildInitPayloadOptions {
  initialFrameOnly?: boolean;
  enableFrameRequests?: boolean;
  chunkSizeHint?: number;
  frameStride?: number;
  selectionPreset?: SelectionPreset;
  solventHandling?: SolventHandling;
  optionsSource?: 'default' | 'with_options' | 'setup_panel';
  emitOptionsCheckpoints?: boolean;
}

type AtomClass = 'polymer' | 'ligand' | 'ion' | 'solvent' | 'unknown';

type DisplayFilterResult = {
  selectionPreset: SelectionPreset;
  solventHandling: SolventHandling;
  functionalModel: string;
  allowedClasses: AtomClass[];
  commonSolventResidueNames: string[];
  commonSolventThreshold: number;
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

export class PayloadBuilder {
  public static async buildInitPayload(
    dataset: NormalizedDataset,
    config: any,
    options: BuildInitPayloadOptions = {}
  ): Promise<ViewerPayload> {
    const providerMetadata = await dataset.trajectory.provider.getMetadata();
    const supportsFrameRequests = Boolean(options.enableFrameRequests && providerMetadata.supportsChunkRequests);
    const frameStride = Math.max(1, options.frameStride ?? 1);
    const rawFrameCount = providerMetadata.frameCount;
    const sampledFrameCount = Math.max(1, Math.ceil(rawFrameCount / frameStride));
    const chunkSizeHint = Math.max(1, options.chunkSizeHint ?? providerMetadata.defaultChunkSize ?? 24);

    let decimated = false;
    const requestedInitFrameCount = resolveRequestedInitFrameCount(
      sampledFrameCount,
      options.initialFrameOnly === true,
      supportsFrameRequests,
      chunkSizeHint
    );
    let initialChunk = await dataset.trajectory.provider.getFrameChunk(
      0,
      requestedInitFrameCount,
      frameStride
    );

    let finalFrames = initialChunk.frames;
    let initialFrameIndices = initialChunk.frameIndices.map((rawIndex) => Math.floor(rawIndex / frameStride));
    let initialFrameRawIndices = initialChunk.frameIndices.slice();

    if (!supportsFrameRequests) {
      const decimationThreshold = config?.maxFramesBeforeDecimation || 1000;
      if (decimationThreshold > 0 && finalFrames.length > decimationThreshold) {
        decimated = true;
        const step = Math.ceil(finalFrames.length / decimationThreshold);
        finalFrames = finalFrames.filter((_, i) => i % step === 0);
        initialFrameIndices = initialFrameIndices.filter((_, i) => i % step === 0);
        initialFrameRawIndices = initialFrameRawIndices.filter((_, i) => i % step === 0);
      }
      // For eager payloads, the viewer index space is local to the payload.
      initialFrameIndices = finalFrames.map((_, i) => i);
      initialFrameRawIndices = initialFrameIndices.map((virtualIndex) => virtualIndex * frameStride);
    }

    const displayFilter = buildDisplayFilter(dataset, {
      selectionPreset: options.selectionPreset,
      solventHandling: options.solventHandling,
    });
    if (options.emitOptionsCheckpoints) {
      emitCheckpoint('CHK_OPT_5_FILTERS_APPLIED', {
        selectionPreset: displayFilter.selectionPreset,
        solventHandling: displayFilter.solventHandling,
        functionalModel: displayFilter.functionalModel,
        allowedClasses: displayFilter.allowedClasses,
        functional: displayFilter.functional,
        applied: displayFilter.applied,
        reason: displayFilter.reason,
        visibleAtomCount: displayFilter.visibleAtomCount,
        hiddenAtomCount: displayFilter.hiddenAtomCount,
        visibleResidueCount: displayFilter.visibleResidueCount,
        hiddenResidueCount: displayFilter.hiddenResidueCount,
        hiddenAtomIndicesSample: displayFilter.hiddenAtomIndices.slice(0, 16),
        hiddenResidueIdsSample: displayFilter.hiddenResidueIds.slice(0, 16),
      });
    }

    const uniqueChains = Array.from(new Set(dataset.structure.residues.map((r) => r.chainIdentifier)));
    const atomToChain = dataset.structure.atoms.map((a) => {
      const idx = uniqueChains.indexOf(a.chainIdentifier);
      return idx !== -1 ? idx : 0;
    });

    const effectiveFrameCount = supportsFrameRequests ? sampledFrameCount : finalFrames.length;
    const atomCount = providerMetadata.atomCount;
    const initPayloadEstimatedFloatCount = finalFrames.length * atomCount * 3;
    const fullTrajectoryEstimatedFloatCount = rawFrameCount * atomCount * 3;

    return {
      data: {
        atomCount: dataset.structure.atomCount,
        atoms: dataset.structure.atoms,
        frames: finalFrames,
        sourceName: dataset.metadata.trajectorySource,
        trajectory: {
          atomCount,
          frameCount: effectiveFrameCount,
          rawFrameCount,
          sampledFrameCount,
          samplingFrameStride: frameStride,
          format: providerMetadata.format,
          accessMode: providerMetadata.accessMode,
          supportsFrameRequests,
          chunkSizeHint,
          initialFrameIndices,
          initialFrameRawIndices,
          initialFrameStride: frameStride,
        },
        displayFilter,
        topology: {
          hasTopology: dataset.structure.hasTopology,
          bondPairs: dataset.structure.bondPairs || [],
          caLinePairs: dataset.structure.bonds || [],
          caIndices: dataset.classification.caIndices,
          ligandIndices: dataset.classification.ligandIndices,
          ionIndices: dataset.classification.ionIndices,
          ligandIonIndices: [...dataset.classification.ligandIndices, ...dataset.classification.ionIndices].sort((a, b) => a - b),
          commonSolventIndices: dataset.classification.commonSolventIndices || [],
          commonSolventResidueNames: dataset.classification.commonSolventResidueNames || [],
          commonSolventThreshold: dataset.classification.commonSolventThreshold ?? 50,
          residueNameCounts: dataset.classification.residueNameCounts || {},
          chains: uniqueChains,
          atomToChain: atomToChain,
          residueEntries: dataset.structure.residues.map((r) => ({
            chainId: r.chainIdentifier,
            chainIndex: Math.max(0, uniqueChains.indexOf(r.chainIdentifier)),
            resSeq: r.seqNumber,
            resName: r.name,
            atomIndices: r.atomIndices,
            classification: r.classification,
            isLigand: r.classification === 'ligand',
            isIon: r.classification === 'ion',
            isSolvent: r.classification === 'solvent',
            isCommonSolvent: Boolean(r.isCommonSolvent),
          })),
          atomToResidue: dataset.structure.atoms.map((a) => a.residueId),
        },
      },
      stats: {
        originalFramesCount: dataset.trajectory.frameCount,
        decimated,
        initFrameCount: finalFrames.length,
        initPayloadEstimatedFloatCount,
      fullTrajectoryEstimatedFloatCount,
      initFrameStride: frameStride,
      initRequestedFrameCount: requestedInitFrameCount,
      rawFrameCount,
      sampledFrameCount,
        visibleAtomCount: displayFilter.visibleAtomCount,
        hiddenAtomCount: displayFilter.hiddenAtomCount,
      },
      config,
    };
  }
}

function resolveRequestedInitFrameCount(
  sampledFrameCount: number,
  initialFrameOnly: boolean,
  supportsFrameRequests: boolean,
  chunkSizeHint: number
): number {
  let requested = initialFrameOnly
    ? 1
    : (supportsFrameRequests ? Math.max(1, chunkSizeHint * 4) : sampledFrameCount);
  requested = Math.min(requested, sampledFrameCount);
  return Math.max(1, requested);
}

function buildDisplayFilter(
  dataset: NormalizedDataset,
  options: {
    selectionPreset?: SelectionPreset;
    solventHandling?: SolventHandling;
  }
): DisplayFilterResult {
  const selectionPreset: SelectionPreset = options.selectionPreset ?? 'everything';
  const solventHandling: SolventHandling = options.solventHandling ?? 'keep_all';
  const atoms = dataset.structure.atoms;

  if (!dataset.structure.hasTopology) {
    return {
      selectionPreset,
      solventHandling,
      functionalModel: 'base_classes_plus_solvent_visibility',
      allowedClasses: ['polymer', 'ligand', 'ion', 'solvent', 'unknown'],
      commonSolventResidueNames: dataset.classification.commonSolventResidueNames || [],
      commonSolventThreshold: dataset.classification.commonSolventThreshold ?? 50,
      hiddenAtomIndices: [],
      hiddenResidueIds: [],
      visibleAtomCount: atoms.length,
      hiddenAtomCount: 0,
      visibleResidueCount: dataset.structure.residues.length,
      hiddenResidueCount: 0,
      applied: false,
      reason: 'noTopology',
      functional: false,
    };
  }

  const allowedClasses = resolveVisibleClasses(selectionPreset, solventHandling);
  const commonSolventResidueNames = dataset.classification.commonSolventResidueNames || [];
  const commonSolventThreshold = dataset.classification.commonSolventThreshold ?? 50;
  const hiddenAtomIndices: number[] = [];
  const visibleResidueIds = new Set<number>();
  const hiddenResidueIds = new Set<number>();

  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i];
    const classification = atom.classification as AtomClass;
    let hidden = false;

    if (!allowedClasses.has(classification)) {
      hidden = true;
    }

    if (
      !hidden &&
      solventHandling === 'hide_common_solvent' &&
      classification === 'solvent' &&
      atom.isCommonSolvent === true
    ) {
      hidden = true;
    }

    if (hidden) {
      hiddenAtomIndices.push(i);
      hiddenResidueIds.add(atom.residueId);
    } else {
      visibleResidueIds.add(atom.residueId);
    }
  }

  const visibleAtomCount = atoms.length - hiddenAtomIndices.length;
  const hiddenAtomCount = hiddenAtomIndices.length;
  const applied = hiddenAtomCount > 0;

  return {
    selectionPreset,
    solventHandling,
    functionalModel: 'base_classes_plus_solvent_visibility',
    allowedClasses: Array.from(allowedClasses.values()),
    commonSolventResidueNames,
    commonSolventThreshold,
    hiddenAtomIndices,
    hiddenResidueIds: Array.from(hiddenResidueIds).sort((a, b) => a - b),
    visibleAtomCount,
    hiddenAtomCount,
    visibleResidueCount: visibleResidueIds.size,
    hiddenResidueCount: hiddenResidueIds.size,
    applied,
    reason: applied ? 'classificationFilterApplied' : 'noAtomsFiltered',
    functional: true,
  };
}

function baseClassesForSelection(selectionPreset: SelectionPreset): Set<AtomClass> {
  if (selectionPreset === 'protein_only') {
    return new Set<AtomClass>(['polymer']);
  }
  if (selectionPreset === 'protein_ligand') {
    return new Set<AtomClass>(['polymer', 'ligand']);
  }
  if (selectionPreset === 'protein_ligand_ions') {
    return new Set<AtomClass>(['polymer', 'ligand', 'ion']);
  }
  return new Set<AtomClass>(['polymer', 'ligand', 'ion', 'solvent', 'unknown']);
}

function resolveVisibleClasses(selectionPreset: SelectionPreset, solventHandling: SolventHandling): Set<AtomClass> {
  const classes = baseClassesForSelection(selectionPreset);
  // Solvent handling is an explicit override layer over base classes.
  // keep_all => show all solvent.
  // hide_common_solvent => keep non-common solvent visible while hiding bulk/common solvent via atom flags.
  if (solventHandling === 'keep_all' || solventHandling === 'hide_common_solvent') {
    classes.add('solvent');
  }
  return classes;
}
