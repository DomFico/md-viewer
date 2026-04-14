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
  'NA', 'CL', 'K', 'MG', 'CA', 'ZN', 'FE', 'CU', 'MN', 'CO', 'NI', 'CD'
]);
const SOLVENT_RESIDUES = new Set(['HOH', 'WAT', 'SOL', 'TIP3P', 'TIP4P', 'SPC', 'SPCE']);

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
  
  // Track CA per chain for building lines
  // key: chainId (or empty string for no chain), value: list of { index, resSeq }
  const caByChain = new Map<string, Array<{ index: number, resSeq: number }>>();
  
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
      const isLigand = isHetatm && resName !== 'HOH' && !isIon;
      const isPolymer = !isHetatm && !isIon;

      if (atomName === 'CA' && !isHetatm) {
        caIndices.push(atomIndex);
        if (!caByChain.has(chainKey)) {
          caByChain.set(chainKey, []);
        }
        caByChain.get(chainKey)!.push({ index: atomIndex, resSeq });
      }

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

      atomIndex++;
    }
  }

  // Build CA connectivity lines by connecting consecutive CAs within identical chains
  const caLinePairs: number[] = [];
  for (const [_, chainCAs] of caByChain.entries()) {
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
