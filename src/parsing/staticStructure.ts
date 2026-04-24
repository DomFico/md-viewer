import * as fs from 'fs';
import { ITrajectoryParser, TrajectoryData, AtomRecord } from './IParser';
import { InMemoryTrajectoryProvider } from '../trajectory/TrajectoryProvider';
import { guessElementFromAtomName } from './elements';

function firstModelLines(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const selected: string[] = [];
  let hasAtoms = false;

  for (const line of lines) {
    if (line.startsWith('MODEL') && hasAtoms) {
      break;
    }
    if (line.startsWith('ENDMDL') || line.startsWith('END')) {
      if (hasAtoms) break;
    }
    selected.push(line);
    if (line.startsWith('ATOM  ') || line.startsWith('HETATM')) {
      hasAtoms = true;
    }
  }

  return selected;
}

export function parseSingleFramePdb(raw: string, sourceName: string): TrajectoryData {
  const lines = firstModelLines(raw);
  const atoms: AtomRecord[] = [];
  const positions: number[] = [];

  for (const line of lines) {
    if (!(line.startsWith('ATOM  ') || line.startsWith('HETATM'))) {
      continue;
    }
    const atomName = line.substring(12, 16).trim();
    const resName = line.substring(17, 20).trim();
    const x = parseFloat(line.substring(30, 38).trim());
    const y = parseFloat(line.substring(38, 46).trim());
    const z = parseFloat(line.substring(46, 54).trim());

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }

    const parsedElement = line.substring(76, 78).trim();
    const element = parsedElement || guessElementFromAtomName(atomName, resName);
    atoms.push({ element });
    positions.push(x, y, z);
  }

  if (atoms.length === 0) {
    throw new Error('PDB static parse error: no coordinate records found in first model.');
  }

  const frame = Float32Array.from(positions);
  const provider = new InMemoryTrajectoryProvider([frame], {
    atomCount: atoms.length,
    format: 'pdb_static',
    sourceName,
  });

  return {
    atomCount: atoms.length,
    atoms,
    sourceName,
    frameCount: 1,
    sourceFormat: 'pdb',
    accessMode: 'eager',
    trajectoryProvider: provider,
  };
}

export function parseSingleFrameGro(raw: string, sourceName: string): TrajectoryData {
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 3) {
    throw new Error('GRO static parse error: file is too short.');
  }

  const atomCount = parseInt(lines[1].trim(), 10);
  if (!Number.isFinite(atomCount) || atomCount <= 0) {
    throw new Error(`GRO static parse error: invalid atom count header "${lines[1].trim()}".`);
  }

  const atoms: AtomRecord[] = [];
  const positions = new Float32Array(atomCount * 3);
  let parsedAtoms = 0;

  for (let lineIndex = 2; lineIndex < lines.length && parsedAtoms < atomCount; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line || line.trim().length === 0) continue;

    const resName = line.length >= 10 ? line.substring(5, 10).trim() : '';
    const atomName = line.length >= 15 ? line.substring(10, 15).trim() : '';
    const xNm = parseFloat(line.substring(20, 28).trim());
    const yNm = parseFloat(line.substring(28, 36).trim());
    const zNm = parseFloat(line.substring(36, 44).trim());

    if (!Number.isFinite(xNm) || !Number.isFinite(yNm) || !Number.isFinite(zNm)) {
      continue;
    }

    // GRO coordinates are stored in nanometers; the viewer runtime and other
    // bridge paths operate in Angstrom units for framing/radii behavior.
    const x = xNm * 10.0;
    const y = yNm * 10.0;
    const z = zNm * 10.0;

    const element = guessElementFromAtomName(atomName, resName);
    atoms.push({ element });
    const offset = parsedAtoms * 3;
    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = z;
    parsedAtoms += 1;
  }

  if (parsedAtoms !== atomCount) {
    throw new Error(
      `GRO static parse error: parsed ${parsedAtoms} coordinates but header declares ${atomCount} atoms.`
    );
  }

  const provider = new InMemoryTrajectoryProvider([positions], {
    atomCount: atomCount,
    format: 'gro_static',
    sourceName,
  });

  return {
    atomCount: atomCount,
    atoms,
    sourceName,
    frameCount: 1,
    sourceFormat: 'gro',
    accessMode: 'eager',
    trajectoryProvider: provider,
  };
}

export class PdbStaticParser implements ITrajectoryParser {
  canParse(ext: string): boolean {
    return ext === '.pdb';
  }

  async parse(filePath: string): Promise<TrajectoryData> {
    const raw = fs.readFileSync(filePath, 'utf8');
    const sourceName = filePath.split(/[\\/]/).pop() ?? filePath;
    return parseSingleFramePdb(raw, sourceName);
  }
}

export class GroStaticParser implements ITrajectoryParser {
  canParse(ext: string): boolean {
    return ext === '.gro';
  }

  async parse(filePath: string): Promise<TrajectoryData> {
    const raw = fs.readFileSync(filePath, 'utf8');
    const sourceName = filePath.split(/[\\/]/).pop() ?? filePath;
    return parseSingleFrameGro(raw, sourceName);
  }
}
