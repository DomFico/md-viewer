import * as fs from 'fs';
import { ITrajectoryParser, TrajectoryData, AtomRecord } from './IParser';
import { InMemoryTrajectoryProvider } from '../trajectory/TrajectoryProvider';

export class XyzParser implements ITrajectoryParser {
  canParse(ext: string): boolean {
    return ext === '.xyz';
  }

  async parse(filePath: string, topPath?: string): Promise<TrajectoryData> {
    const raw = fs.readFileSync(filePath, 'utf8');
    const sourceName = filePath.split(/[\\/]/).pop() ?? filePath;
    return parseXyz(raw, sourceName);
  }
}

export function parseXyz(raw: string, sourceName: string): TrajectoryData {
  // Normalise line endings and split
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const frames: Float32Array[] = [];
  let atomCount: number | null = null;
  let atoms: AtomRecord[] | null = null;

  let i = 0;
  while (i < lines.length) {
    // Skip blank lines between frames
    const countLine = lines[i].trim();
    if (countLine === '') {
      i++;
      continue;
    }

    // Parse atom count
    const n = parseInt(countLine, 10);
    if (isNaN(n) || n <= 0) {
      throw new Error(`XYZ parse error at line ${i + 1}: expected atom count, got "${countLine}"`);
    }

    if (atomCount === null) {
      atomCount = n;
    } else if (n !== atomCount) {
      throw new Error(
        `XYZ parse error: frame ${frames.length + 1} has ${n} atoms but frame 0 had ${atomCount}`
      );
    }

    // Skip comment line
    i += 2;

    // Parse atom lines
    const positions = new Float32Array(n * 3);
    const frameAtoms: AtomRecord[] = [];

    for (let a = 0; a < n; a++) {
      if (i >= lines.length) {
        throw new Error(`XYZ parse error: unexpected end of file in frame ${frames.length + 1}`);
      }
      const parts = lines[i].trim().split(/\s+/);
      if (parts.length < 4) {
        throw new Error(`XYZ parse error at line ${i + 1}: expected "element x y z", got "${lines[i]}"`);
      }
      frameAtoms.push({ element: parts[0] });
      positions[a * 3]     = parseFloat(parts[1]);
      positions[a * 3 + 1] = parseFloat(parts[2]);
      positions[a * 3 + 2] = parseFloat(parts[3]);
      i++;
    }

    if (atoms === null) {
      atoms = frameAtoms;
    }

    frames.push(positions);
  }

  if (frames.length === 0 || atomCount === null || atoms === null) {
    throw new Error('XYZ parse error: file contains no valid frames');
  }

  const provider = new InMemoryTrajectoryProvider(frames, {
    atomCount,
    format: 'xyz',
    sourceName,
  });

  return {
    atomCount,
    atoms,
    sourceName,
    frameCount: frames.length,
    sourceFormat: 'xyz',
    accessMode: 'eager',
    trajectoryProvider: provider,
  };
}
