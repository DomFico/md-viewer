import { TrajectoryData } from '../parsing/IParser';
import { TopologyMetadata } from '../parsing/pdb';
import { 
  NormalizedDataset, 
  AtomRecordNormalized, 
  ResidueRecordNormalized, 
  ClassificationBucket 
} from '../types/NormalizedDataset';

const ION_RESIDUES = new Set(['NA', 'NA+', 'CL', 'CL-', 'K', 'K+', 'MG', 'CA', 'ZN', 'FE', 'CU', 'MN', 'CO', 'NI', 'CD', 'BR', 'I']);
const SOLVENT_RESIDUES = new Set(['HOH', 'WAT', 'SOL', 'TIP3P', 'TIP4P', 'SPC', 'SPCE']);
const POLYMER_RESIDUES = new Set([
  'ALA','ARG','ASN','ASP','CYS','GLN','GLU','GLY','HIS','ILE','LEU','LYS','MET','PHE','PRO','SER','THR','TRP','TYR','VAL',
  'ASH','AS4','GLH','GL4','CYM','CYX','LYN','HIP','HID','HIE',
  'A','C','G','T','U','DA','DC','DG','DT','RA','RC','RG','RU'
]);
const COMMON_SOLVENT_RESIDUE_COUNT_THRESHOLD = 50;

function normalizeResidueName(name: string): string {
  return String(name || '').trim().toUpperCase();
}

export class DatasetNormalizer {
  public static normalize(
    datasetId: string,
    trajectoryPath: string,
    trajectory: TrajectoryData,
    topologyPath?: string,
    topology?: TopologyMetadata
  ): NormalizedDataset {
    
    const atoms: AtomRecordNormalized[] = [];
    const residues: ResidueRecordNormalized[] = [];
    
    const caIndices: number[] = [];
    const ligandIndices: number[] = [];
    const ionIndices: number[] = [];
    const solventIndices: number[] = [];
    const commonSolventIndices: number[] = [];
    const polymerIndices: number[] = [];
    const residueNameCounts: Record<string, number> = {};
    let commonSolventResidueNames: string[] = [];
    
    const hasTopology = !!(topology && topology.hasTopology);

    if (hasTopology && topology) {
      for (const resEntry of topology.residueEntries) {
        const residueKey = normalizeResidueName(resEntry.resName);
        residueNameCounts[residueKey] = (residueNameCounts[residueKey] ?? 0) + 1;
      }
      const isCommonSolventName = (resNameUpper: string): boolean => {
        const count = residueNameCounts[resNameUpper] ?? 0;
        if (count < COMMON_SOLVENT_RESIDUE_COUNT_THRESHOLD) return false;
        if (ION_RESIDUES.has(resNameUpper)) return false;
        if (POLYMER_RESIDUES.has(resNameUpper)) return false;
        return true;
      };
      commonSolventResidueNames = Object.keys(residueNameCounts)
        .filter((name) => {
          if (isCommonSolventName(name)) return true;
          if (SOLVENT_RESIDUES.has(name)) {
            const count = residueNameCounts[name] ?? 0;
            return count >= COMMON_SOLVENT_RESIDUE_COUNT_THRESHOLD;
          }
          return false;
        })
        .sort((a, b) => a.localeCompare(b));
      const commonSolventNameSet = new Set(commonSolventResidueNames);

      // 1. Build Residues exactly
      for (const resEntry of topology.residueEntries) {
        let classification: ClassificationBucket = 'unknown';
        const resUpper = normalizeResidueName(resEntry.resName);
        const parserPolymerHint = typeof resEntry.isPolymer === 'boolean' ? resEntry.isPolymer : undefined;
        const parserSolventHint = typeof resEntry.isSolvent === 'boolean' ? resEntry.isSolvent : false;
        const isCommonSolvent = commonSolventNameSet.has(resUpper);
        const isNamedSolvent = SOLVENT_RESIDUES.has(resUpper);
        const inferSolventFromRepeat = isCommonSolvent && !ION_RESIDUES.has(resUpper) && !POLYMER_RESIDUES.has(resUpper);

        // Safe deterministic fallback sequence
        if (resEntry.isIon || ION_RESIDUES.has(resUpper)) classification = 'ion';
        else if (parserSolventHint || isNamedSolvent || inferSolventFromRepeat) classification = 'solvent';
        else if (parserPolymerHint === true || POLYMER_RESIDUES.has(resUpper)) classification = 'polymer';
        else if (resEntry.isLigand) classification = 'ligand';
        else classification = 'ligand'; // Unrecognized stuff usually ligands in MD

        const nRes: ResidueRecordNormalized = {
          id: residues.length,
          name: resEntry.resName,
          seqNumber: resEntry.resSeq,
          chainIdentifier: resEntry.chainId,
          atomIndices: resEntry.atomIndices,
          classification,
          isCommonSolvent: classification === 'solvent' && isCommonSolvent,
        };
        residues.push(nRes);
      }

      // 2. Build Atoms linking back to Residues
      for (let i = 0; i < trajectory.atomCount; i++) {
        const resId = topology.atomToResidue[i];
        const resEntry = residues[resId];
        
        if (!resEntry) {
           throw new Error(`Normalization failure: Atom index ${i} has no mapped residue!`);
        }

        const isSolvent = resEntry.classification === 'solvent';
        const isCa = topology.caIndices.includes(i);
        const isCommonSolvent = Boolean(resEntry.isCommonSolvent);
        
        atoms.push({
          index: i,
          name: topology.atomNames[i] || '', // grab explicit atom name if present 
          element: topology.elements[i] || trajectory.atoms[i]?.element || 'C',
          residueId: resEntry.id,
          residueName: resEntry.name,
          chainIdentifier: resEntry.chainIdentifier,
          isHetero: isSolvent || resEntry.classification === 'ligand' || resEntry.classification === 'ion',
          classification: resEntry.classification,
          isCommonSolvent,
        });

        // 3. Classify
        if (resEntry.classification === 'polymer') polymerIndices.push(i);
        if (resEntry.classification === 'ligand') ligandIndices.push(i);
        if (resEntry.classification === 'ion') ionIndices.push(i);
        if (resEntry.classification === 'solvent') solventIndices.push(i);
        if (isCommonSolvent) commonSolventIndices.push(i);
        if (isCa) caIndices.push(i);
      }
    } else {
      // Dummy mapping for bare Trajectory (e.g. .xyz with no topology)
      const dummyRes: ResidueRecordNormalized = {
        id: 0, name: 'UNK', seqNumber: 1, chainIdentifier: 'A', atomIndices: [], classification: 'unknown', isCommonSolvent: false,
      };
      
      for (let i = 0; i < trajectory.atomCount; i++) {
        dummyRes.atomIndices.push(i);
        atoms.push({
          index: i,
          name: trajectory.atoms[i]?.element || 'C',
          element: trajectory.atoms[i]?.element || 'C',
          residueId: 0,
          residueName: 'UNK',
          chainIdentifier: 'A',
          isHetero: false,
          classification: 'unknown',
          isCommonSolvent: false,
        });
        polymerIndices.push(i); // default to polymer backbone
      }
      residues.push(dummyRes);
    }

    if (!hasTopology) {
      residueNameCounts.UNK = 1;
      commonSolventResidueNames = [];
    }

    return {
      metadata: {
        id: datasetId,
        trajectorySource: trajectoryPath,
        topologySource: topologyPath
      },
      structure: {
        atomCount: trajectory.atomCount,
        atoms,
        residues,
        bonds: topology?.caLinePairs || [], // Backbone/trace pairs
        bondPairs: topology?.bondPairs || [],
        hasTopology
      },
      classification: {
        caIndices,
        ligandIndices,
        ionIndices,
        solventIndices,
        commonSolventIndices,
        polymerIndices,
        residueNameCounts,
        commonSolventResidueNames,
        commonSolventThreshold: COMMON_SOLVENT_RESIDUE_COUNT_THRESHOLD,
      },
      trajectory: {
        frameCount: trajectory.frameCount,
        provider: trajectory.trajectoryProvider,
        sourceFormat: trajectory.sourceFormat,
        accessMode: trajectory.accessMode,
      }
    };
  }
}
