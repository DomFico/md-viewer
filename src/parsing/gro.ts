import * as fs from 'fs';
import { ITopologyParser } from './IParser';
import { TopologyMetadata, createEmptyTopology, ResidueMetadata } from './pdb';
import { guessElementFromAtomName } from './elements';

const ION_RESIDUES = new Set(['NA', 'NA+', 'CL', 'CL-', 'K', 'K+', 'MG', 'CA', 'ZN', 'FE', 'CU', 'MN', 'CO', 'NI', 'CD']);
const SOLVENT_RESIDUES = new Set(['HOH', 'WAT', 'SOL', 'TIP3P', 'TIP4P']);
const POLYMER_RESIDUES = new Set([
  'ALA','ARG','ASN','ASP','CYS','GLN','GLU','GLY','HIS','ILE','LEU','LYS','MET','PHE','PRO','SER','THR','TRP','TYR','VAL',
  'ASH','AS4','GLH','GL4','CYM','CYX','LYN','HIP','HID','HIE',
  'A','C','G','T','U','DA','DC','DG','DT','RA','RC','RG','RU'
]);
const NUCLEIC_RESIDUES = new Set(['A', 'C', 'G', 'T', 'U', 'DA', 'DC', 'DG', 'DT', 'RA', 'RC', 'RG', 'RU']);

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

function chainIdFromIndex(index: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (index < alphabet.length) {
    return alphabet[index];
  }

  let value = index;
  let result = '';
  while (value >= 0) {
    result = alphabet[value % alphabet.length] + result;
    value = Math.floor(value / alphabet.length) - 1;
  }
  return result;
}

export class GroParser implements ITopologyParser {
  canParse(ext: string): boolean {
    return ext === '.gro';
  }

  async parse(filePath: string): Promise<TopologyMetadata> {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    const top = createEmptyTopology();
    top.hasTopology = true;

    if (lines.length < 3) return top;

    const atomCount = parseInt(lines[1].trim(), 10);
    if (isNaN(atomCount)) {
        console.warn('GroParser: Atom count missing or invalid.');
        return top;
    }

    const traceByChain = new Map<number, Array<{ index: number; resSeq: number }>>();
    const traceAnchorByResidue = new Map<number, TraceAnchor>();
    let currentResidueId = -1;
    let currentChainIndex = 0;
    let previousResidueSeq: number | null = null;
    let previousResidueName: string | null = null;
    let atomIndex = 0;

    // GRO parsing respects fixed width mostly:
    // 1-5: res number, 6-10: res name, 11-15: atom name, 16-20: atom number
    for (let i = 2; i < 2 + atomCount && i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().length === 0) continue;

        const resSeqStr = line.length >= 5 ? line.substring(0, 5).trim() : '';
        const resName = line.length >= 10 ? line.substring(5, 10).trim() : '';
        const atomName = line.length >= 15 ? line.substring(10, 15).trim() : '';
        const resSeq = parseInt(resSeqStr, 10) || 0;
        const residueChanged = previousResidueSeq === null
          || resSeq !== previousResidueSeq
          || resName !== previousResidueName;

        const element = guessElementFromAtomName(atomName, resName);
        top.atomNames.push(atomName);
        top.elements.push(element);

        const upperRes = resName.toUpperCase();
        const isIon = ION_RESIDUES.has(upperRes);
        const isSolvent = SOLVENT_RESIDUES.has(upperRes);
        const isPolymer = POLYMER_RESIDUES.has(upperRes);
        const isLigand = !isIon && !isSolvent && !isPolymer;

        if (residueChanged) {
            if (previousResidueSeq !== null) {
                // GRO lacks explicit chain IDs. Residue-number resets/non-increasing transitions
                // are the most reliable separators between polymer chains and standalone hetero groups.
                if (resSeq <= previousResidueSeq) {
                    currentChainIndex += 1;
                }
            }

            const chainId = chainIdFromIndex(currentChainIndex);
            while (top.chains.length <= currentChainIndex) {
                top.chains.push(chainIdFromIndex(top.chains.length));
            }

            currentResidueId = top.residueEntries.length;
            top.residueEntries.push({
                chainId,
                chainIndex: currentChainIndex,
                resSeq,
                insertionCode: '',
                resName,
                atomIndices: [],
                isLigand,
                isIon,
                isPolymer,
                isSolvent,
            });
            previousResidueSeq = resSeq;
            previousResidueName = resName;
        } else if (currentResidueId >= 0) {
            // Preserve any hetero hints encountered later within the same residue block.
            top.residueEntries[currentResidueId].isLigand ||= isLigand;
            top.residueEntries[currentResidueId].isIon ||= isIon;
            top.residueEntries[currentResidueId].isPolymer ||= isPolymer;
            top.residueEntries[currentResidueId].isSolvent ||= isSolvent;
        }

        if (currentResidueId < 0) {
            continue;
        }

        top.residueEntries[currentResidueId].atomIndices.push(atomIndex);
        top.atomToResidue.push(currentResidueId);
        top.atomToChain.push(currentChainIndex);

        if (isIon) {
            top.ionIndices.push(atomIndex);
            top.ligandIonIndices.push(atomIndex);
        } else if (isLigand) {
            top.ligandIndices.push(atomIndex);
            top.ligandIonIndices.push(atomIndex);
        }

        const anchorPriority = traceAnchorPriority(atomName, upperRes, isPolymer);
        if (anchorPriority > 0) {
            const existing = traceAnchorByResidue.get(currentResidueId);
            if (!existing || anchorPriority > existing.priority) {
                traceAnchorByResidue.set(currentResidueId, { index: atomIndex, resSeq, priority: anchorPriority });
            }
        }

        atomIndex++;
    }

    for (const [residueId, anchor] of traceAnchorByResidue.entries()) {
        top.caIndices.push(anchor.index);
        const chainIndex = top.residueEntries[residueId]?.chainIndex ?? 0;
        if (!traceByChain.has(chainIndex)) {
            traceByChain.set(chainIndex, []);
        }
        traceByChain.get(chainIndex)!.push({ index: anchor.index, resSeq: anchor.resSeq });
    }

    for (const [, chainCAs] of traceByChain.entries()) {
        chainCAs.sort((a, b) => a.resSeq - b.resSeq);
        for (let i = 0; i < chainCAs.length - 1; i++) {
            top.caLinePairs.push(chainCAs[i].index, chainCAs[i + 1].index);
        }
    }

    if (top.residueEntries.length > 0 && top.chains.length === 0) {
        top.chains.push('A');
    }

    return top;
  }
}
