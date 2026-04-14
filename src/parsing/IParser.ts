import { TrajectoryAccessMode, TrajectoryProvider } from '../trajectory/TrajectoryProvider';

export interface AtomRecord {
  element: string;
}

export interface TrajectoryData {
  atomCount: number;
  atoms: AtomRecord[];
  sourceName: string;
  frameCount: number;
  sourceFormat: string;
  accessMode: TrajectoryAccessMode;
  trajectoryProvider: TrajectoryProvider;
}

export interface ITrajectoryParser {
  canParse(ext: string): boolean;
  parse(filePath: string, topPath?: string): Promise<TrajectoryData>;
}

export interface ITopologyParser {
  canParse(ext: string): boolean;
  parse(filePath: string): Promise<any>; // returning 'any' for topology temporarily to match existing signature
}
