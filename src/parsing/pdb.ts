import * as fs from 'fs';
import { ITopologyParser } from './IParser';
import { guessElementFromAtomName } from './elements';

export class PdbParser implements ITopologyParser {
  canParse(ext: string): boolean {
    return ext === '.pdb';
  }

  async parse(filePath: string): Promise<TopologyMetadata> {
    const raw = fs.readFileSync(filePath, 'utf8');
    return parsePdbTopology(raw);
  }
}

export interface ResidueMetadata {
  chainId: string;
  chainIndex: number;
  resSeq: number;
  insertionCode: string;
  resName: string;
  atomIndices: number[];
  isLigand: boolean;
  isIon: boolean;
  isPolymer?: boolean;
  isSolvent?: boolean;
}

export interface TopologyMetadata {
  bondPairs?: number[];
  chainInference?: {
    mode?: string;
    topologyChainCount?: number;
    componentCount?: number;
    componentSizes?: number[];
  };
  caIndices: number[];
  caLinePairs: number[];
  ligandIonIndices: number[];
  ligandIndices: number[];
  ionIndices: number[];
  chains: string[];
  atomToChain: number[];
  residueEntries: ResidueMetadata[];
  atomToResidue: number[];    // Mapping from global atom index to index in residueEntries
  atomNames: string[];        // New: Track explicit names
  elements: string[];         // New: Track explicit elements safely parsed
  hasTopology: boolean;
}

const ION_RESIDUES = new Set([
  'NA', 'NA+', 'CL', 'CL-', 'K', 'K+', 'MG', 'CA', 'ZN', 'FE', 'CU', 'MN', 'CO', 'NI', 'CD'
]);
const SOLVENT_RESIDUES = new Set(['HOH', 'WAT', 'SOL', 'TIP3P', 'TIP4P', 'SPC', 'SPCE']);
const NUCLEIC_RESIDUES = new Set(['A', 'C', 'G', 'T', 'U', 'DA', 'DC', 'DG', 'DT', 'RA', 'RC', 'RG', 'RU']);
const POLYMER_RESIDUES = new Set([
  'ALA','ARG','ASN','ASP','CYS','GLN','GLU','GLY','HIS','ILE','LEU','LYS','MET','PHE','PRO','SER','THR','TRP','TYR','VAL',
  'ASH','AS4','GLH','GL4','CYM','CYX','LYN','HIP','HID','HIE',
  ...NUCLEIC_RESIDUES,
]);

type TraceAnchor = {
  index: number;
  resSeq: number;
  priority: number;
};

function normalizeAtomNameForTrace(atomName: string): string {
  return atomName.trim().toUpperCase().replace(/\*/g, "'");
}

function traceAnchorPriority(atomName: string, resNameUpper: string, isPolymer: boolean): number {
  if (!isPolymer) return 0;

  const normalized = normalizeAtomNameForTrace(atomName);
  if (NUCLEIC_RESIDUES.has(resNameUpper)) {
    if (normalized === 'P') return 100;
    if (normalized === "C4'") return 90;
    if (normalized === "C3'") return 85;
    if (normalized === "O3'") return 80;
    if (normalized === "C5'") return 75;
    if (normalized === "O5'") return 70;
    if (normalized === "C1'") return 60;
    return 0;
  }

  return normalized === 'CA' ? 100 : 0;
}

export function parsePdbTopology(raw: string): TopologyMetadata {
  const caIndices: number[] = [];
  const ligandIonIndices: number[] = [];
  const ligandIndices: number[] = [];
  const ionIndices: number[] = [];
  const chains: string[] = [];
  const atomToChain: number[] = [];
  const residueEntries: ResidueMetadata[] = [];
  const atomToResidue: number[] = [];
  const atomNames: string[] = [];
  const elements: string[] = [];
  
  // Trace anchors are protein CA atoms plus nucleic-acid backbone/sugar anchors.
  // The field remains named caLinePairs for payload compatibility.
  const traceByChain = new Map<string, Array<{ index: number, resSeq: number }>>();
  const traceAnchorByResidue = new Map<number, TraceAnchor>();
  
  // Track continuous residues
  const resKeyMap = new Map<string, number>();
  const chainIndexById = new Map<string, number>();

  const lines = raw.split(/\r?\n/);
  let atomIndex = 0; // Align with the 0-indexed XYZ trajectory

  for (const line of lines) {
    if (line.startsWith('MODEL')) {
      // If there are multiple frames in the PDB, we only need to parse the first one for topology.
      // E.g. we can reset atomIndex or just break after ENDMDL, but many PDBs don't use MODEL.
      // Best to only count atoms up to the first ENDMDL or just do it once.
      // For safety, we only process until atom index jumps down or we hit an END/ENDMDL if we wanted.
      // But standard PDB atom lines are strictly what we look at. 
      // If we see a second MODEL we should safely exit to avoid duplicating the atoms.
      if (atomIndex > 0) {
          break; // Stop parsing after completing the first model/frame
      }
    }

    if (line.startsWith('ENDMDL') || line.startsWith('END')) {
      if (atomIndex > 0) {
        break; // Stop after first frame
      }
    }

    if (line.startsWith('ATOM  ') || line.startsWith('HETATM')) {
      const atomName = line.substring(12, 16).trim();
      const resName = line.substring(17, 20).trim();
      const chainId = line.substring(21, 22).trim();
      const chainKey = chainId || '_';
      
      const resSeqStr = line.substring(22, 26).trim();
      const resSeq = parseInt(resSeqStr, 10) || 0;
      const insertionCode = line.substring(26, 27).trim();

      const isHetatm = line.startsWith('HETATM');
      let element = line.substring(76, 78).trim();
      if (!element) {
        element = guessElementFromAtomName(atomName, resName);
      }
      
      atomNames.push(atomName);
      elements.push(element);

      const resNameUpper = resName.toUpperCase();
      const isIon = ION_RESIDUES.has(resNameUpper);
      const isSolvent = SOLVENT_RESIDUES.has(resNameUpper);
      const isPolymer = !isIon && !isSolvent && POLYMER_RESIDUES.has(resNameUpper);
      const isLigand = !isIon && !isSolvent && !isPolymer;

      if (isIon || isLigand) {
        ligandIonIndices.push(atomIndex);
        if (isIon) {
          ionIndices.push(atomIndex);
        } else {
          ligandIndices.push(atomIndex);
        }
      }

      let chainIndex = chainIndexById.get(chainKey);
      if (chainIndex === undefined) {
        chainIndex = chains.length;
        chainIndexById.set(chainKey, chainIndex);
        chains.push(chainId);
      }
      atomToChain.push(chainIndex);

      // Group into residues
      const resKey = `${chainKey}_${resSeq}_${insertionCode}`;
      let resId = resKeyMap.get(resKey);
      if (resId === undefined) {
        resId = residueEntries.length;
        resKeyMap.set(resKey, resId);
        residueEntries.push({
          chainId,
          chainIndex,
          resSeq,
          insertionCode,
          resName,
          atomIndices: [],
          isLigand,
          isIon,
          isPolymer,
          isSolvent,
        });
      } else {
        residueEntries[resId].isLigand ||= isLigand;
        residueEntries[resId].isIon ||= isIon;
        residueEntries[resId].isPolymer ||= isPolymer;
        residueEntries[resId].isSolvent ||= isSolvent;
      }
      residueEntries[resId].atomIndices.push(atomIndex);
      atomToResidue.push(resId);

      const anchorPriority = traceAnchorPriority(atomName, resNameUpper, isPolymer);
      if (anchorPriority > 0) {
        const existing = traceAnchorByResidue.get(resId);
        if (!existing || anchorPriority > existing.priority) {
          traceAnchorByResidue.set(resId, { index: atomIndex, resSeq, priority: anchorPriority });
        }
      }

      atomIndex++;
    }
  }

  for (const [resId, anchor] of traceAnchorByResidue.entries()) {
    caIndices.push(anchor.index);
    const residue = residueEntries[resId];
    const chainKey = residue?.chainId || '_';
    if (!traceByChain.has(chainKey)) {
      traceByChain.set(chainKey, []);
    }
    traceByChain.get(chainKey)!.push({ index: anchor.index, resSeq: anchor.resSeq });
  }

  // Build polymer trace lines by connecting consecutive anchors within identical chains.
  const caLinePairs: number[] = [];
  for (const [_, chainCAs] of traceByChain.entries()) {
    // Sort by residue sequence number just in case
    chainCAs.sort((a, b) => a.resSeq - b.resSeq);
    
    for (let i = 0; i < chainCAs.length - 1; i++) {
        caLinePairs.push(chainCAs[i].index, chainCAs[i + 1].index);
    }
  }

  return {
    bondPairs: [],
    caIndices,
    caLinePairs,
    ligandIonIndices,
    ligandIndices,
    ionIndices,
    chains,
    atomToChain,
    residueEntries,
    atomToResidue,
    atomNames,
    elements,
    hasTopology: true
  };
}

export function createEmptyTopology(): TopologyMetadata {
  return {
    bondPairs: [],
    caIndices: [],
    caLinePairs: [],
    ligandIonIndices: [],
    ligandIndices: [],
    ionIndices: [],
    chains: [],
    atomToChain: [],
    residueEntries: [],
    atomToResidue: [],
    atomNames: [],
    elements: [],
    hasTopology: false
  };
}
