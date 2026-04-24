import * as vscode from 'vscode';
import * as path from 'path';
import { logDebug } from '../logger';

export interface Dataset {
  trajectoryPath: string;
  topologyPath?: string;
  datasetName: string;
}

export interface ResolveDatasetOptions {
  interactive?: boolean;
  trajectoryPathOverride?: string;
  topologyPathOverride?: string | null;
}

export interface DatasetResolutionInspection {
  clickedPath: string;
  clickedExt: string;
  clickedName: string;
  clickedDir: string;
  trajectoryCandidates: string[];
  topologyCandidates: string[];
}

export const SELF_CONTAINED_STRUCTURE_EXTS = ['.pdb', '.gro'];
export const TOPOLOGY_ONLY_EXTS = ['.parm7', '.prmtop'];
export const COORDINATE_ONLY_TRAJECTORY_EXTS = ['.xtc', '.trr', '.dcd', '.nc', '.rst7', '.inpcrd', '.mdcrd'];

export const TRAJECTORY_EXTS = ['.xyz', '.xtc', '.trr', '.dcd', '.nc', '.rst7', '.inpcrd', '.mdcrd', '.pdb', '.gro'];
export const TOPOLOGY_EXTS = ['.pdb', '.gro', '.parm7', '.prmtop'];

const TOPOLOGY_PREFERENCE_BY_TRAJECTORY: Record<string, string[]> = {
  '.xtc': ['.gro', '.pdb'],
  '.trr': ['.gro', '.pdb'],
  '.dcd': ['.pdb', '.gro'],
  '.xyz': ['.pdb', '.gro'],
  '.nc': ['.parm7', '.prmtop', '.pdb', '.gro'],
  '.rst7': ['.parm7', '.prmtop', '.pdb', '.gro'],
  '.inpcrd': ['.prmtop', '.parm7', '.pdb', '.gro'],
  '.mdcrd': ['.prmtop', '.parm7', '.pdb', '.gro'],
};

const TRAJECTORY_PREFERENCE_BY_TOPOLOGY: Record<string, string[]> = {
  '.pdb': ['.xtc', '.trr', '.dcd', '.xyz', '.nc', '.mdcrd', '.inpcrd', '.pdb'],
  '.gro': ['.xtc', '.trr', '.dcd', '.xyz', '.nc', '.mdcrd', '.inpcrd', '.pdb'],
  '.parm7': ['.nc', '.mdcrd', '.rst7', '.inpcrd', '.dcd', '.xtc', '.trr', '.xyz'],
  '.prmtop': ['.nc', '.mdcrd', '.rst7', '.inpcrd', '.dcd', '.xtc', '.trr', '.xyz'],
};

const STAGE_TOKEN_GROUPS = [
  ['em', 'min', 'minimization'],
  ['nvt'],
  ['npt'],
  ['md', 'prod', 'production'],
  ['nosol', 'non', 'non_solvent'],
  ['nojump'],
  ['pbcfixed', 'centered', 'rect'],
];

function normalizeExt(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) return undefined;
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function normalizeFileName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePath(pathValue: string): string {
  return path.resolve(pathValue);
}

function baseNameNoExt(name: string): string {
  return path.parse(name.toLowerCase()).name;
}

function tokenizeStem(name: string): string[] {
  return baseNameNoExt(name)
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function stageGroupIndex(token: string): number {
  for (let i = 0; i < STAGE_TOKEN_GROUPS.length; i++) {
    if (STAGE_TOKEN_GROUPS[i].includes(token)) {
      return i;
    }
  }
  return -1;
}

function scoreNameSimilarity(anchorFile: string, candidateFile: string): number {
  const anchorStem = baseNameNoExt(anchorFile);
  const candidateStem = baseNameNoExt(candidateFile);
  if (anchorStem === candidateStem) {
    return 240;
  }

  let score = 0;
  if (anchorStem.startsWith(candidateStem) || candidateStem.startsWith(anchorStem)) {
    score += 110;
  }

  const anchorTokens = tokenizeStem(anchorFile);
  const candidateTokens = tokenizeStem(candidateFile);
  const anchorSet = new Set(anchorTokens);
  const candidateSet = new Set(candidateTokens);

  let overlap = 0;
  for (const token of anchorSet) {
    if (candidateSet.has(token)) overlap++;
  }
  score += overlap * 18;

  if (anchorTokens.length > 0 && candidateTokens.length > 0 && anchorTokens[0] === candidateTokens[0]) {
    score += 8;
  }

  const anchorGroups = new Set(anchorTokens.map(stageGroupIndex).filter((idx) => idx >= 0));
  const candidateGroups = new Set(candidateTokens.map(stageGroupIndex).filter((idx) => idx >= 0));

  if (anchorGroups.size > 0 && candidateGroups.size > 0) {
    let sharedGroups = 0;
    for (const group of anchorGroups) {
      if (candidateGroups.has(group)) sharedGroups++;
    }
    score += sharedGroups * 12;
    if (sharedGroups === 0) {
      score -= 14;
    }
  }

  if (anchorSet.has('nosol') !== candidateSet.has('nosol')) {
    score -= 8;
  }
  if (anchorSet.has('nojump') !== candidateSet.has('nojump')) {
    score -= 6;
  }

  return score;
}

function scoreExtPreference(candidateFile: string, preferredExtOrder: string[]): number {
  const ext = path.extname(candidateFile).toLowerCase();
  const index = preferredExtOrder.indexOf(ext);
  if (index === -1) return 0;
  return (preferredExtOrder.length - index) * 30;
}

function choosePreferredCandidate(candidates: string[], preferredFile?: string, preferredExt?: string): string | undefined {
  if (candidates.length === 0) return undefined;
  if (preferredFile) {
    const matchByFile = candidates.find((candidate) => candidate.toLowerCase() === preferredFile);
    if (matchByFile) return matchByFile;
  }
  if (preferredExt) {
    const matchByExt = candidates.find((candidate) => path.extname(candidate).toLowerCase() === preferredExt);
    if (matchByExt) return matchByExt;
  }
  return undefined;
}

function chooseRankedCandidate(
  candidates: string[],
  opts: {
    anchorFile: string;
    preferredExtOrder: string[];
  }
): string | undefined {
  if (candidates.length === 0) return undefined;

  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreExtPreference(candidate, opts.preferredExtOrder) + scoreNameSimilarity(opts.anchorFile, candidate),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.candidate.localeCompare(b.candidate);
    });

  return scored[0]?.candidate;
}

function sortCandidatesByScore(candidates: string[], anchorFile: string, preferredExtOrder: string[]): string[] {
  return candidates
    .slice()
    .sort((a, b) => {
      const scoreA = scoreExtPreference(a, preferredExtOrder) + scoreNameSimilarity(anchorFile, a);
      const scoreB = scoreExtPreference(b, preferredExtOrder) + scoreNameSimilarity(anchorFile, b);
      if (scoreA !== scoreB) return scoreB - scoreA;
      return a.localeCompare(b);
    });
}

function chooseByTopologyPreference(candidates: string[], trajectoryExt: string): string | undefined {
  const preference = TOPOLOGY_PREFERENCE_BY_TRAJECTORY[trajectoryExt] ?? ['.parm7', '.prmtop', '.pdb', '.gro'];
  for (const topExt of preference) {
    const match = candidates.find((candidate) => path.extname(candidate).toLowerCase() === topExt);
    if (match) {
      return match;
    }
  }
  return undefined;
}

function chooseByTrajectoryPreference(candidates: string[], topologyExt: string): string | undefined {
  const preference = TRAJECTORY_PREFERENCE_BY_TOPOLOGY[topologyExt] ?? ['.nc', '.mdcrd', '.rst7', '.inpcrd', '.xtc', '.trr', '.dcd', '.xyz', '.pdb'];
  for (const trajExt of preference) {
    const match = candidates.find((candidate) => path.extname(candidate).toLowerCase() === trajExt);
    if (match) {
      return match;
    }
  }
  return undefined;
}

export class DatasetResolver {
  public static isTrajectoryExt(ext: string): boolean {
    return TRAJECTORY_EXTS.includes(ext.toLowerCase());
  }

  public static isTopologyExt(ext: string): boolean {
    return TOPOLOGY_EXTS.includes(ext.toLowerCase());
  }

  public static isSelfContainedStructureExt(ext: string): boolean {
    return SELF_CONTAINED_STRUCTURE_EXTS.includes(ext.toLowerCase());
  }

  public static isTopologyOnlyExt(ext: string): boolean {
    return TOPOLOGY_ONLY_EXTS.includes(ext.toLowerCase());
  }

  public static isCoordinateOnlyTrajectoryExt(ext: string): boolean {
    return COORDINATE_ONLY_TRAJECTORY_EXTS.includes(ext.toLowerCase());
  }

  public static async inspect(uri: vscode.Uri): Promise<DatasetResolutionInspection> {
    const clickedPath = uri.fsPath;
    const clickedExt = path.extname(clickedPath).toLowerCase();
    const clickedDir = path.dirname(clickedPath);
    const clickedName = path.basename(clickedPath);

    let siblingFiles: [string, vscode.FileType][] = [];
    try {
      siblingFiles = await vscode.workspace.fs.readDirectory(vscode.Uri.file(clickedDir));
    } catch (err) {
      console.warn('Could not read directory during dataset inspection', err);
    }

    const files = siblingFiles
      .filter(([_, type]) => type === vscode.FileType.File)
      .map(([name]) => name);

    const trajectoryCandidates = files.filter((candidate) => TRAJECTORY_EXTS.includes(path.extname(candidate).toLowerCase()));
    const topologyCandidates = files.filter((candidate) => TOPOLOGY_EXTS.includes(path.extname(candidate).toLowerCase()));

    return {
      clickedPath,
      clickedExt,
      clickedName,
      clickedDir,
      trajectoryCandidates,
      topologyCandidates,
    };
  }

  public static async resolveDataset(uri: vscode.Uri, options: ResolveDatasetOptions = {}): Promise<Dataset | undefined> {
    const interactive = options.interactive !== false;
    const inspection = await DatasetResolver.inspect(uri);
    const fsPath = options.trajectoryPathOverride ? normalizePath(options.trajectoryPathOverride) : inspection.clickedPath;
    const ext = path.extname(fsPath).toLowerCase();
    const dir = path.dirname(fsPath);
    const fileName = path.basename(fsPath);

    logDebug('DatasetResolver', 'Resolving clicked file', { fileName, ext, dir });

    let files = [...inspection.trajectoryCandidates, ...inspection.topologyCandidates];
    if (dir !== inspection.clickedDir) {
      const overrideInspection = await DatasetResolver.inspect(vscode.Uri.file(fsPath));
      files = [...overrideInspection.trajectoryCandidates, ...overrideInspection.topologyCandidates];
    }
    const uniqueFiles = Array.from(new Set(files));

    let trajectoryPath = fsPath;
    let topologyPath: string | undefined = undefined;
    const preferredTrajectoryFile = normalizeFileName(process.env.MD_VIEWER_PREFERRED_TRAJECTORY_FILE);
    const preferredTrajectoryExt = normalizeExt(process.env.MD_VIEWER_PREFERRED_TRAJECTORY_EXT);
    const preferredTopologyFile = normalizeFileName(process.env.MD_VIEWER_PREFERRED_TOPOLOGY_FILE);
    const preferredTopologyExt = normalizeExt(process.env.MD_VIEWER_PREFERRED_TOPOLOGY_EXT);

    if (DatasetResolver.isTopologyExt(ext) || ext === '.tpr') {
      if (DatasetResolver.isSelfContainedStructureExt(ext)) {
        const siblingTrajs = uniqueFiles.filter((candidate) => {
          const candidateExt = path.extname(candidate).toLowerCase();
          return TRAJECTORY_EXTS.includes(candidateExt) && candidate !== fileName;
        });
        const preferredTrajectory = choosePreferredCandidate(
          siblingTrajs,
          preferredTrajectoryFile,
          preferredTrajectoryExt
        );

        if (preferredTrajectory) {
          trajectoryPath = path.join(dir, preferredTrajectory);
          topologyPath = fsPath;
          logDebug('DatasetResolver', 'Selected preferred companion trajectory for self-contained structure file', {
            clickedPath: fsPath,
            preferredTrajectory,
            preferredTrajectoryFile,
            preferredTrajectoryExt,
          });
        } else {
          trajectoryPath = fsPath;
          topologyPath = fsPath;
          logDebug('DatasetResolver', 'Using self-contained static default for structure file', {
            clickedPath: fsPath,
            ext,
          });
        }
      } else {
        const siblingTrajs = uniqueFiles.filter((candidate) => {
          const candidateExt = path.extname(candidate).toLowerCase();
          return TRAJECTORY_EXTS.includes(candidateExt) && candidate !== fileName;
        });

        logDebug('DatasetResolver', 'Found trajectory candidates for topology', { candidates: siblingTrajs });

        if (siblingTrajs.length === 1) {
          trajectoryPath = path.join(dir, siblingTrajs[0]);
          topologyPath = fsPath;
        } else if (siblingTrajs.length > 1) {
          const preferredTrajectory = choosePreferredCandidate(siblingTrajs, preferredTrajectoryFile, preferredTrajectoryExt);
          const rankedTrajectory = chooseRankedCandidate(siblingTrajs, {
            anchorFile: fileName,
            preferredExtOrder: TRAJECTORY_PREFERENCE_BY_TOPOLOGY[ext] ?? ['.nc', '.mdcrd', '.rst7', '.inpcrd', '.xtc', '.trr', '.dcd', '.xyz', '.pdb'],
          }) ?? chooseByTrajectoryPreference(siblingTrajs, ext);

          const recommendedTrajectory = preferredTrajectory ?? rankedTrajectory;

          if (preferredTrajectory) {
            trajectoryPath = path.join(dir, preferredTrajectory);
            topologyPath = fsPath;
            logDebug('DatasetResolver', 'Selected preferred trajectory candidate', {
              preferredTrajectory,
              preferredTrajectoryFile,
              preferredTrajectoryExt,
            });
            return {
              trajectoryPath,
              topologyPath,
              datasetName: path.basename(trajectoryPath),
            };
          }

          if (interactive) {
            const sortedTrajs = sortCandidatesByScore(
              siblingTrajs,
              fileName,
              TRAJECTORY_PREFERENCE_BY_TOPOLOGY[ext] ?? []
            );
            const picked = await vscode.window.showQuickPick(
              sortedTrajs.map((candidate) => ({
                label: recommendedTrajectory && candidate === recommendedTrajectory ? `${candidate} (Recommended)` : candidate,
                detail: path.join(dir, candidate),
              })),
              { placeHolder: `Select companion trajectory for ${fileName}` }
            );
            if (!picked) return undefined;
            trajectoryPath = picked.detail ?? path.join(dir, picked.label);
            topologyPath = fsPath;
          } else {
            const autoPicked = recommendedTrajectory ?? siblingTrajs.slice().sort((a, b) => a.localeCompare(b))[0];
            trajectoryPath = path.join(dir, autoPicked);
            topologyPath = fsPath;
          }
        }
      }
    } else {
      const siblingTops = uniqueFiles.filter((candidate) => {
        const candidateExt = path.extname(candidate).toLowerCase();
        return TOPOLOGY_EXTS.includes(candidateExt) && candidate !== fileName;
      });

      logDebug('DatasetResolver', 'Found topology candidates for trajectory', { candidates: siblingTops });

      if (siblingTops.length === 1) {
        topologyPath = path.join(dir, siblingTops[0]);
      } else if (siblingTops.length > 1) {
        const preferredTopology = choosePreferredCandidate(siblingTops, preferredTopologyFile, preferredTopologyExt);
        const rankedTopology = chooseRankedCandidate(siblingTops, {
          anchorFile: fileName,
          preferredExtOrder: TOPOLOGY_PREFERENCE_BY_TRAJECTORY[ext] ?? ['.parm7', '.prmtop', '.pdb', '.gro'],
        }) ?? chooseByTopologyPreference(siblingTops, ext);

        if (preferredTopology) {
          topologyPath = path.join(dir, preferredTopology);
          logDebug('DatasetResolver', 'Selected preferred topology candidate', {
            preferredTopology,
            preferredTopologyFile,
            preferredTopologyExt,
          });
        } else if (rankedTopology) {
          topologyPath = path.join(dir, rankedTopology);
        }

        if (!topologyPath && interactive) {
          const sortedTops = sortCandidatesByScore(
            siblingTops,
            fileName,
            TOPOLOGY_PREFERENCE_BY_TRAJECTORY[ext] ?? []
          );
          const picked = await vscode.window.showQuickPick(
            [
              { label: 'None (Trajectory Only)', detail: '' },
              ...sortedTops.map((candidate) => ({
                label: rankedTopology && candidate === rankedTopology ? `${candidate} (Recommended)` : candidate,
                detail: path.join(dir, candidate),
              })),
            ],
            { placeHolder: `Select companion topology for ${fileName}` }
          );
          if (!picked) return undefined;
          if (picked.detail && picked.detail.length > 0) {
            topologyPath = picked.detail;
          }
        }

        if (!topologyPath && !interactive) {
          const autoPicked = rankedTopology ?? siblingTops.slice().sort((a, b) => a.localeCompare(b))[0];
          topologyPath = autoPicked ? path.join(dir, autoPicked) : undefined;
        }
      }
    }

    if (options.topologyPathOverride !== undefined) {
      topologyPath = options.topologyPathOverride ? normalizePath(options.topologyPathOverride) : undefined;
    }
    if (options.trajectoryPathOverride) {
      trajectoryPath = normalizePath(options.trajectoryPathOverride);
    }

    logDebug('DatasetResolver', 'Resolution finalized', { trajectoryPath, topologyPath });
    return {
      trajectoryPath,
      topologyPath,
      datasetName: path.basename(trajectoryPath),
    };
  }
}
