import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import {
  Dataset,
  DatasetResolver,
  TRAJECTORY_EXTS,
  TOPOLOGY_EXTS,
} from '../parsing/DatasetResolver';
import {
  MdDatasetLoadOptions,
  createDefaultLoadOptions,
  normalizeOptionsFromInput,
  withLoadModeDefaults,
  DatasetLoadMode,
  SelectionPreset,
  SolventHandling,
} from '../options/LoadOptions';
import { emitCheckpoint } from '../runtimeCheckpoint';
import { getSetupPanelHtml } from '../webview/getSetupPanelHtml';
import { openMdViewer } from './openMdViewer';

const DATASET_FILE_FILTERS = ['xyz', 'xtc', 'trr', 'dcd', 'nc', 'rst7', 'pdb', 'gro', 'parm7'];
const SUPPORTED_TRAJECTORY_PARSE_EXTS = new Set(['.xyz', '.xtc', '.trr', '.dcd', '.nc', '.rst7', '.pdb']);
const SUPPORTED_TOPOLOGY_PARSE_EXTS = new Set(['.pdb', '.gro', '.parm7']);
const BINARY_METADATA_EXTS = new Set(['.xtc', '.trr', '.dcd', '.nc', '.rst7']);
const TRAJECTORY_REQUIRES_TOPOLOGY_EXTS = new Set(['.xtc', '.trr', '.dcd', '.nc', '.rst7']);

interface SetupPanelCandidate {
  label: string;
  path: string;
  recommended: boolean;
}

interface SetupValidationMessage {
  level: 'info' | 'warning' | 'error';
  message: string;
}

interface SetupValidation {
  status: 'supported' | 'partial' | 'unresolved';
  blocking: boolean;
  messages: SetupValidationMessage[];
  atomCount: number | null;
  frameCount: number | null;
}

interface SetupPanelState {
  targetUri: vscode.Uri;
  defaults: {
    trajectoryPath: string;
    topologyPath: string | null;
  };
  options: MdDatasetLoadOptions;
  candidates: {
    trajectory: SetupPanelCandidate[];
    topology: SetupPanelCandidate[];
  };
  validation: SetupValidation;
}

type SetupCommandInput = {
  uri?: vscode.Uri | string;
  options?: unknown;
  autoConfirm?: boolean;
};

function parseEnvBool(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  return raw === '1' || raw.toLowerCase() === 'true';
}

function resolveUriFromInput(input: vscode.Uri | SetupCommandInput | string | undefined): vscode.Uri | undefined {
  if (!input) return undefined;
  if (input instanceof vscode.Uri) return input;
  if (typeof input === 'string') return vscode.Uri.file(path.resolve(input));
  if (typeof input === 'object') {
    const raw = input.uri;
    if (!raw) return undefined;
    if (raw instanceof vscode.Uri) return raw;
    if (typeof raw === 'string') return vscode.Uri.file(path.resolve(raw));
  }
  return undefined;
}

function parseInputOptions(
  input: vscode.Uri | SetupCommandInput | string | undefined,
  defaultSource: MdDatasetLoadOptions['source']
): MdDatasetLoadOptions | undefined {
  if (!input || input instanceof vscode.Uri || typeof input === 'string') {
    return undefined;
  }
  return normalizeOptionsFromInput(input.options, defaultSource);
}

function parseInputAutoConfirm(input: vscode.Uri | SetupCommandInput | string | undefined): boolean {
  if (!input || input instanceof vscode.Uri || typeof input === 'string') {
    return false;
  }
  return input.autoConfirm === true;
}

async function pickTargetUri(initialUri: vscode.Uri | undefined, title: string): Promise<vscode.Uri | undefined> {
  if (initialUri) return initialUri;
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'MD Dataset files': DATASET_FILE_FILTERS },
    title,
  });
  if (!picked || picked.length === 0) {
    return undefined;
  }
  return picked[0];
}

function mergeLoadOptions(
  baseOptions: MdDatasetLoadOptions,
  source: MdDatasetLoadOptions['source'],
  incoming?: MdDatasetLoadOptions
): MdDatasetLoadOptions {
  if (!incoming) {
    return baseOptions;
  }

  return {
    source,
    resolution: {
      trajectoryPathOverride: incoming.resolution.trajectoryPathOverride ?? baseOptions.resolution.trajectoryPathOverride,
      topologyPathOverride: incoming.resolution.topologyPathOverride ?? baseOptions.resolution.topologyPathOverride,
    },
    behavior: {
      ...baseOptions.behavior,
      ...incoming.behavior,
    },
    filtering: {
      ...baseOptions.filtering,
      ...incoming.filtering,
    },
  };
}

async function listFilesForDirectory(dirPath: string): Promise<string[]> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
    return entries
      .filter(([_, type]) => type === vscode.FileType.File)
      .map(([name]) => path.join(dirPath, name));
  } catch {
    return [];
  }
}

async function buildCandidates(
  clickedDir: string,
  options: MdDatasetLoadOptions,
  defaults: { trajectoryPath: string; topologyPath: string | null }
): Promise<{ trajectory: SetupPanelCandidate[]; topology: SetupPanelCandidate[] }> {
  const dirs = new Set<string>([clickedDir]);
  if (options.resolution.trajectoryPathOverride) {
    dirs.add(path.dirname(options.resolution.trajectoryPathOverride));
  }
  if (options.resolution.topologyPathOverride) {
    dirs.add(path.dirname(options.resolution.topologyPathOverride));
  }
  dirs.add(path.dirname(defaults.trajectoryPath));
  if (defaults.topologyPath) {
    dirs.add(path.dirname(defaults.topologyPath));
  }

  const allFiles = new Set<string>();
  for (const dir of dirs) {
    const files = await listFilesForDirectory(dir);
    for (const filePath of files) {
      allFiles.add(path.resolve(filePath));
    }
  }

  const trajectoryPaths = Array.from(allFiles)
    .filter((filePath) => TRAJECTORY_EXTS.includes(path.extname(filePath).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  const topologyPaths = Array.from(allFiles)
    .filter((filePath) => TOPOLOGY_EXTS.includes(path.extname(filePath).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  if (options.resolution.trajectoryPathOverride && !trajectoryPaths.includes(options.resolution.trajectoryPathOverride)) {
    trajectoryPaths.push(options.resolution.trajectoryPathOverride);
  }
  if (options.resolution.topologyPathOverride && !topologyPaths.includes(options.resolution.topologyPathOverride)) {
    topologyPaths.push(options.resolution.topologyPathOverride);
  }

  const trajectory = trajectoryPaths
    .sort((a, b) => a.localeCompare(b))
    .map((absolutePath) => ({
      label: path.basename(absolutePath),
      path: absolutePath,
      recommended: path.resolve(absolutePath) === path.resolve(defaults.trajectoryPath),
    }));

  const topology = topologyPaths
    .sort((a, b) => a.localeCompare(b))
    .map((absolutePath) => ({
      label: path.basename(absolutePath),
      path: absolutePath,
      recommended: defaults.topologyPath ? path.resolve(absolutePath) === path.resolve(defaults.topologyPath) : false,
    }));

  return { trajectory, topology };
}

function countPdbAtoms(filePath: string): number | null {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    let count = 0;
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('ATOM') || line.startsWith('HETATM')) {
        count += 1;
      }
    }
    return count;
  } catch {
    return null;
  }
}

function preferredPythonExecutable(): string {
  const envCandidates = [
    process.env.MD_VIEWER_PYTHON,
    process.env.PYTHON,
    process.env.PYTHON3,
  ];

  for (const candidate of envCandidates) {
    if (candidate && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return 'python';
}

async function probeBinaryMetadata(
  trajectoryPath: string,
  topologyPath: string,
  trajectoryExt: string
): Promise<{ atomCount: number | null; frameCount: number | null }> {
  const bridgePath = path.resolve(__dirname, '../../../scripts/binary_traj_bridge.py');
  if (!fs.existsSync(bridgePath)) {
    return { atomCount: null, frameCount: null };
  }

  const format = trajectoryExt.replace('.', '');
  const spawnArgs = [
    bridgePath,
    '--mode',
    'metadata',
    '--traj',
    trajectoryPath,
    '--top',
    topologyPath,
    '--format',
    format,
  ];

  return await new Promise((resolve) => {
    const child = spawn(preferredPythonExecutable(), spawnArgs);
    const stdoutChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.on('close', (code: number | null) => {
      if (code !== 0) {
        resolve({ atomCount: null, frameCount: null });
        return;
      }
      const raw = Buffer.concat(stdoutChunks).toString('utf8');
      try {
        const parsed = JSON.parse(raw);
        const atomCount = Number.isFinite(Number(parsed?.atomCount)) ? Number(parsed.atomCount) : null;
        const frameCount = Number.isFinite(Number(parsed?.frameCount)) ? Number(parsed.frameCount) : null;
        resolve({ atomCount, frameCount });
      } catch {
        resolve({ atomCount: null, frameCount: null });
      }
    });

    child.on('error', () => {
      resolve({ atomCount: null, frameCount: null });
    });
  });
}

async function inferKnownCounts(
  trajectoryPath: string,
  topologyPath: string | null
): Promise<{ atomCount: number | null; frameCount: number | null }> {
  const trajectoryExt = path.extname(trajectoryPath).toLowerCase();
  if (trajectoryExt === '.pdb') {
    return { atomCount: countPdbAtoms(trajectoryPath), frameCount: 1 };
  }

  if (topologyPath && BINARY_METADATA_EXTS.has(trajectoryExt)) {
    return probeBinaryMetadata(trajectoryPath, topologyPath, trajectoryExt);
  }

  return { atomCount: null, frameCount: null };
}

function classifyStatus(messages: SetupValidationMessage[], blocking: boolean): 'supported' | 'partial' | 'unresolved' {
  if (blocking) return 'unresolved';
  return messages.some((message) => message.level === 'warning') ? 'partial' : 'supported';
}

async function buildValidation(
  options: MdDatasetLoadOptions,
  candidates: { trajectory: SetupPanelCandidate[]; topology: SetupPanelCandidate[] }
): Promise<SetupValidation> {
  const messages: SetupValidationMessage[] = [];
  const trajectoryPath = options.resolution.trajectoryPathOverride;
  const topologyPath = options.resolution.topologyPathOverride ?? null;
  let blocking = false;

  if (!trajectoryPath) {
    return {
      status: 'unresolved',
      blocking: true,
      atomCount: null,
      frameCount: null,
      messages: [{ level: 'error', message: 'No trajectory selected.' }],
    };
  }

  if (!fs.existsSync(trajectoryPath)) {
    messages.push({ level: 'error', message: `Trajectory file does not exist: ${trajectoryPath}` });
    blocking = true;
  }

  const trajectoryExt = path.extname(trajectoryPath).toLowerCase();
  const topologyExt = topologyPath ? path.extname(topologyPath).toLowerCase() : null;

  if (!TRAJECTORY_EXTS.includes(trajectoryExt)) {
    messages.push({ level: 'error', message: `Trajectory format ${trajectoryExt || '(none)'} is not recognized.` });
    blocking = true;
  } else if (!SUPPORTED_TRAJECTORY_PARSE_EXTS.has(trajectoryExt)) {
    messages.push({
      level: 'warning',
      message: `Trajectory format ${trajectoryExt} is recognized but parser support is not available in this build.`,
    });
    blocking = true;
  }

  if (topologyPath) {
    if (!fs.existsSync(topologyPath)) {
      messages.push({ level: 'error', message: `Topology file does not exist: ${topologyPath}` });
      blocking = true;
    }
    if (!TOPOLOGY_EXTS.includes(topologyExt ?? '')) {
      messages.push({ level: 'warning', message: `Topology format ${topologyExt || '(none)'} is not recognized.` });
    } else if (!SUPPORTED_TOPOLOGY_PARSE_EXTS.has(topologyExt ?? '')) {
      messages.push({
        level: 'warning',
        message: `Topology format ${topologyExt} is recognized but parser support is not available in this build.`,
      });
      blocking = true;
    }
  } else {
    if (TRAJECTORY_REQUIRES_TOPOLOGY_EXTS.has(trajectoryExt)) {
      messages.push({
        level: 'error',
        message: `Trajectory format ${trajectoryExt} requires a companion topology (recommended: .parm7/.pdb/.gro depending on source).`,
      });
      blocking = true;
    } else {
      messages.push({
        level: 'warning',
        message: 'No topology selected. Residue-aware navigation and semantics may be limited.',
      });
    }
  }

  if (candidates.topology.length > 1) {
    messages.push({
      level: 'info',
      message: `Multiple topology candidates detected (${candidates.topology.length}). Verify the selected companion.`,
    });
  }
  if (candidates.trajectory.length > 1) {
    messages.push({
      level: 'info',
      message: `Multiple trajectory candidates detected (${candidates.trajectory.length}).`,
    });
  }

  const counts = await inferKnownCounts(trajectoryPath, topologyPath);
  if (counts.frameCount !== null && counts.frameCount > 5000) {
    messages.push({
      level: 'info',
      message: `Large trajectory detected (${counts.frameCount} frames). Fast preview is recommended.`,
    });
  }
  if (counts.atomCount !== null && counts.atomCount > 120000) {
    messages.push({
      level: 'info',
      message: `Large atom count detected (${counts.atomCount}). Consider filtering and higher stride.`,
    });
  }

  if (messages.length === 0) {
    messages.push({ level: 'info', message: 'Dataset appears fully supported.' });
  }

  return {
    status: classifyStatus(messages, blocking),
    blocking,
    messages,
    atomCount: counts.atomCount,
    frameCount: counts.frameCount,
  };
}

function summarizeState(state: SetupPanelState): Record<string, unknown> {
  const trajectoryPath = state.options.resolution.trajectoryPathOverride;
  const topologyPath = state.options.resolution.topologyPathOverride ?? null;
  const trajectoryExt = trajectoryPath ? path.extname(trajectoryPath).toLowerCase() : null;
  const topologyExt = topologyPath ? path.extname(topologyPath).toLowerCase() : null;
  return {
    trajectoryPath,
    topologyPath,
    trajectoryExt,
    topologyExt,
    status: state.validation.status,
    blocking: state.validation.blocking,
    atomCount: state.validation.atomCount,
    frameCount: state.validation.frameCount,
    candidateCounts: {
      trajectory: state.candidates.trajectory.length,
      topology: state.candidates.topology.length,
    },
  };
}

async function stateToViewModel(state: SetupPanelState): Promise<Record<string, unknown>> {
  const trajectoryPath = state.options.resolution.trajectoryPathOverride;
  const topologyPath = state.options.resolution.topologyPathOverride ?? null;
  const trajectoryFormat = trajectoryPath ? path.extname(trajectoryPath).toLowerCase() : 'unknown';
  const topologyFormat = topologyPath ? path.extname(topologyPath).toLowerCase() : 'none';

  const overview = state.validation.status === 'supported'
    ? 'Dataset is supported and ready to load.'
    : state.validation.status === 'partial'
      ? 'Dataset has warnings; review setup before loading.'
      : 'Dataset has blocking issues; fix selections before loading.';

  return {
    summary: {
      overview,
      trajectoryPath,
      topologyPath,
      trajectoryFormat,
      topologyFormat,
      status: state.validation.status,
      atomCount: state.validation.atomCount,
      frameCount: state.validation.frameCount,
    },
    options: state.options,
    candidates: state.candidates,
    validation: state.validation,
  };
}

async function recalcState(
  state: SetupPanelState,
  clickedDir: string
): Promise<void> {
  state.candidates = await buildCandidates(clickedDir, state.options, state.defaults);
  state.validation = await buildValidation(state.options, state.candidates);
}

function sanitizeFrameStride(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : fallback;
}

function ensureLoadMode(value: unknown, fallback: DatasetLoadMode): DatasetLoadMode {
  if (value === 'fast_preview' || value === 'standard' || value === 'fuller_initial') {
    return value;
  }
  return fallback;
}

function ensureSelectionPreset(value: unknown, fallback: SelectionPreset): SelectionPreset {
  if (value === 'protein_only' || value === 'protein_ligand' || value === 'protein_ligand_ions' || value === 'everything') {
    return value;
  }
  return fallback;
}

function ensureSolventHandling(value: unknown, fallback: SolventHandling): SolventHandling {
  if (value === 'hide_common_solvent' || value === 'keep_all') {
    return value;
  }
  return fallback;
}

function buildBaseSetupOptions(defaultResolution: Dataset, source: MdDatasetLoadOptions['source']): MdDatasetLoadOptions {
  const options = createDefaultLoadOptions(source);
  return {
    ...options,
    source,
    resolution: {
      trajectoryPathOverride: path.resolve(defaultResolution.trajectoryPath),
      topologyPathOverride: defaultResolution.topologyPath ? path.resolve(defaultResolution.topologyPath) : null,
    },
  };
}

async function postSetupState(panel: vscode.WebviewPanel, state: SetupPanelState): Promise<void> {
  const viewModel = await stateToViewModel(state);
  await panel.webview.postMessage({
    type: 'setupPanelState',
    state: viewModel,
  });
  emitCheckpoint('CHK_SETUP_6_VALIDATION_UPDATED', {
    ...summarizeState(state),
    validationMessages: state.validation.messages,
    behavior: state.options.behavior,
    filtering: state.options.filtering,
  });
}

export async function openMdDatasetSetupPanel(
  context: vscode.ExtensionContext,
  input?: vscode.Uri | SetupCommandInput | string,
  source: 'default' | 'with_options' = 'default'
): Promise<void> {
  const targetUri = await pickTargetUri(
    resolveUriFromInput(input),
    source === 'with_options' ? 'Launch MD Viewer (With Options Compatibility)' : 'Launch MD Viewer'
  );
  if (!targetUri) {
    return;
  }

  emitCheckpoint('CHK_SETUP_1_PANEL_OPENED', {
    source,
    clickedPath: targetUri.fsPath,
    clickedExt: path.extname(targetUri.fsPath).toLowerCase(),
    clickedName: path.basename(targetUri.fsPath),
    clickedDir: path.dirname(targetUri.fsPath),
  });
  if (source === 'with_options') {
    emitCheckpoint('CHK_OPT_1_OPTIONS_COMMAND_FIRED', {
      clickedPath: targetUri.fsPath,
      clickedExt: path.extname(targetUri.fsPath).toLowerCase(),
      clickedName: path.basename(targetUri.fsPath),
      clickedDir: path.dirname(targetUri.fsPath),
    });
  }

  const clickedDir = path.dirname(targetUri.fsPath);
  const optionsSource: MdDatasetLoadOptions['source'] = source === 'with_options' ? 'with_options' : 'setup_panel';
  const defaultResolution = await DatasetResolver.resolveDataset(targetUri, { interactive: false });
  if (!defaultResolution) {
    void vscode.window.showWarningMessage('MD Viewer: could not resolve dataset defaults for setup panel.');
    return;
  }

  const inspection = await DatasetResolver.inspect(targetUri);
  const baseOptions = buildBaseSetupOptions(defaultResolution, optionsSource);
  const incomingOptions = parseInputOptions(input, optionsSource);
  const mergedOptions = mergeLoadOptions(baseOptions, optionsSource, incomingOptions);

  const state: SetupPanelState = {
    targetUri,
    defaults: {
      trajectoryPath: path.resolve(defaultResolution.trajectoryPath),
      topologyPath: defaultResolution.topologyPath ? path.resolve(defaultResolution.topologyPath) : null,
    },
    options: {
      ...mergedOptions,
      source: optionsSource,
    },
    candidates: {
      trajectory: [],
      topology: [],
    },
    validation: {
      status: 'partial',
      blocking: false,
      messages: [],
      atomCount: null,
      frameCount: null,
    },
  };

  await recalcState(state, clickedDir);

  const initialTrajectoryOverrideChanged = state.options.resolution.trajectoryPathOverride
    ? path.resolve(state.options.resolution.trajectoryPathOverride) !== path.resolve(state.defaults.trajectoryPath)
    : false;
  const initialTopologyOverrideChanged =
    state.options.resolution.topologyPathOverride !== undefined
      ? (state.options.resolution.topologyPathOverride ?? null) !== (state.defaults.topologyPath ?? null)
      : false;
  if (initialTrajectoryOverrideChanged) {
    emitCheckpoint('CHK_SETUP_4_TRAJECTORY_OVERRIDE_SELECTED', {
      selectedTrajectoryPath: state.options.resolution.trajectoryPathOverride,
      defaultTrajectoryPath: state.defaults.trajectoryPath,
      overrideChanged: true,
      source: 'initialOptions',
    });
  }
  if (initialTopologyOverrideChanged) {
    emitCheckpoint('CHK_SETUP_5_TOPOLOGY_OVERRIDE_SELECTED', {
      selectedTopologyPath: state.options.resolution.topologyPathOverride,
      defaultTopologyPath: state.defaults.topologyPath,
      overrideChanged: true,
      source: 'initialOptions',
    });
  }

  emitCheckpoint('CHK_SETUP_2_DEFAULTS_POPULATED', {
    source,
    clickedPath: targetUri.fsPath,
    defaultTrajectoryPath: state.defaults.trajectoryPath,
    defaultTopologyPath: state.defaults.topologyPath,
    inspection: {
      trajectoryCandidates: inspection.trajectoryCandidates,
      topologyCandidates: inspection.topologyCandidates,
    },
    initialOptions: state.options,
  });
  if (source === 'with_options') {
    emitCheckpoint('CHK_OPT_2_DEFAULT_RESOLUTION', {
      clickedPath: targetUri.fsPath,
      hasDefaultResolution: true,
      defaultTrajectoryPath: state.defaults.trajectoryPath,
      defaultTopologyPath: state.defaults.topologyPath,
      datasetName: path.basename(state.defaults.trajectoryPath),
    });
  }

  emitCheckpoint('CHK_SETUP_3_CANDIDATES_LISTED', {
    clickedPath: targetUri.fsPath,
    candidateCounts: {
      trajectory: state.candidates.trajectory.length,
      topology: state.candidates.topology.length,
    },
    trajectoryCandidates: state.candidates.trajectory.map((candidate) => candidate.path),
    topologyCandidates: state.candidates.topology.map((candidate) => candidate.path),
  });

  const panel = vscode.window.createWebviewPanel(
    'mdDatasetSetup',
    `MD Dataset Setup: ${path.basename(targetUri.fsPath)}`,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    }
  );
  panel.webview.html = getSetupPanelHtml(panel, path.basename(targetUri.fsPath), context.extensionUri);

  const inputAutoConfirm = parseInputAutoConfirm(input);
  const autoConfirm = inputAutoConfirm || parseEnvBool('MD_VIEWER_SETUP_PANEL_AUTO_CONFIRM');
  let autoConfirmConsumed = false;
  let disposed = false;

  panel.onDidDispose(() => {
    disposed = true;
  });

  const confirmAndLoad = async (): Promise<void> => {
    if (state.validation.blocking) {
      await panel.webview.postMessage({
        type: 'setupPanelError',
        error: 'Dataset setup has blocking validation errors. Adjust selections before loading.',
      });
      return;
    }

    emitCheckpoint('CHK_SETUP_7_LOAD_CONFIRMED', {
      clickedPath: targetUri.fsPath,
      finalOptions: state.options,
      validation: state.validation,
      summary: summarizeState(state),
    });
    if (source === 'with_options') {
      const trajectoryOverrideChanged = state.options.resolution.trajectoryPathOverride
        ? path.resolve(state.options.resolution.trajectoryPathOverride) !== path.resolve(state.defaults.trajectoryPath)
        : false;
      const topologyOverrideChanged =
        state.options.resolution.topologyPathOverride !== undefined
          ? (state.options.resolution.topologyPathOverride ?? null) !== (state.defaults.topologyPath ?? null)
          : false;
      emitCheckpoint('CHK_OPT_3_USER_OVERRIDE_APPLIED', {
        defaultTrajectoryPath: state.defaults.trajectoryPath,
        defaultTopologyPath: state.defaults.topologyPath,
        userTrajectoryOverride: state.options.resolution.trajectoryPathOverride ?? null,
        userTopologyOverride: state.options.resolution.topologyPathOverride ?? null,
        trajectoryOverrideChanged,
        topologyOverrideChanged,
      });
      emitCheckpoint('CHK_OPT_4_LOAD_OPTIONS_FINALIZED', {
        source: state.options.source,
        resolution: state.options.resolution,
        behavior: state.options.behavior,
        filtering: state.options.filtering,
      });
    }

    panel.dispose();
    await openMdViewer(context, targetUri, state.options);
  };

  panel.webview.onDidReceiveMessage(async (message) => {
    if (!message || typeof message.type !== 'string') {
      return;
    }

    if (message.type === 'setupPanelReady') {
      await postSetupState(panel, state);
      if (autoConfirm && !autoConfirmConsumed && !disposed) {
        autoConfirmConsumed = true;
        await confirmAndLoad();
      }
      return;
    }

    if (message.type === 'setupPanelSelectTrajectory') {
      const rawPath = typeof message.trajectoryPath === 'string' ? message.trajectoryPath : '';
      if (rawPath.trim().length === 0) return;
      state.options.resolution.trajectoryPathOverride = path.resolve(rawPath);
      emitCheckpoint('CHK_SETUP_4_TRAJECTORY_OVERRIDE_SELECTED', {
        selectedTrajectoryPath: state.options.resolution.trajectoryPathOverride,
        defaultTrajectoryPath: state.defaults.trajectoryPath,
        overrideChanged: path.resolve(state.options.resolution.trajectoryPathOverride) !== path.resolve(state.defaults.trajectoryPath),
      });
      await recalcState(state, clickedDir);
      await postSetupState(panel, state);
      return;
    }

    if (message.type === 'setupPanelSelectTopology') {
      const hasTopology = typeof message.topologyPath === 'string' && message.topologyPath.trim().length > 0;
      state.options.resolution.topologyPathOverride = hasTopology ? path.resolve(String(message.topologyPath)) : null;
      emitCheckpoint('CHK_SETUP_5_TOPOLOGY_OVERRIDE_SELECTED', {
        selectedTopologyPath: state.options.resolution.topologyPathOverride,
        defaultTopologyPath: state.defaults.topologyPath,
        overrideChanged: (state.options.resolution.topologyPathOverride ?? null) !== (state.defaults.topologyPath ?? null),
      });
      await recalcState(state, clickedDir);
      await postSetupState(panel, state);
      return;
    }

    if (message.type === 'setupPanelBrowseTrajectory') {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'Trajectory files': DATASET_FILE_FILTERS },
        title: 'Select trajectory file',
      });
      if (!picked || picked.length === 0) return;
      state.options.resolution.trajectoryPathOverride = path.resolve(picked[0].fsPath);
      emitCheckpoint('CHK_SETUP_4_TRAJECTORY_OVERRIDE_SELECTED', {
        selectedTrajectoryPath: state.options.resolution.trajectoryPathOverride,
        defaultTrajectoryPath: state.defaults.trajectoryPath,
        overrideChanged: path.resolve(state.options.resolution.trajectoryPathOverride) !== path.resolve(state.defaults.trajectoryPath),
        source: 'browseDialog',
      });
      await recalcState(state, clickedDir);
      await postSetupState(panel, state);
      return;
    }

    if (message.type === 'setupPanelBrowseTopology') {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'Topology files': ['pdb', 'gro', 'parm7'] },
        title: 'Select topology file',
      });
      if (!picked || picked.length === 0) return;
      state.options.resolution.topologyPathOverride = path.resolve(picked[0].fsPath);
      emitCheckpoint('CHK_SETUP_5_TOPOLOGY_OVERRIDE_SELECTED', {
        selectedTopologyPath: state.options.resolution.topologyPathOverride,
        defaultTopologyPath: state.defaults.topologyPath,
        overrideChanged: (state.options.resolution.topologyPathOverride ?? null) !== (state.defaults.topologyPath ?? null),
        source: 'browseDialog',
      });
      await recalcState(state, clickedDir);
      await postSetupState(panel, state);
      return;
    }

    if (message.type === 'setupPanelUpdateBehavior') {
      const current = state.options.behavior;
      const nextLoadMode = ensureLoadMode(message.loadMode, current.loadMode);
      const modeDefaults = withLoadModeDefaults(nextLoadMode, {
        initialFrameOnly: current.initialFrameOnly,
        frameStride: current.frameStride,
      });
      state.options.behavior = {
        ...modeDefaults,
        frameStride: sanitizeFrameStride(message.frameStride ?? modeDefaults.frameStride, modeDefaults.frameStride),
      };
      await recalcState(state, clickedDir);
      await postSetupState(panel, state);
      return;
    }

    if (message.type === 'setupPanelUpdateFiltering') {
      state.options.filtering = {
        selectionPreset: ensureSelectionPreset(message.selectionPreset, state.options.filtering.selectionPreset),
        solventHandling: ensureSolventHandling(message.solventHandling, state.options.filtering.solventHandling),
      };
      await recalcState(state, clickedDir);
      await postSetupState(panel, state);
      return;
    }

    if (message.type === 'setupPanelResetDefaults') {
      state.options = buildBaseSetupOptions(defaultResolution, optionsSource);
      emitCheckpoint('CHK_SETUP_2_DEFAULTS_POPULATED', {
        reset: true,
        clickedPath: targetUri.fsPath,
        defaultTrajectoryPath: state.defaults.trajectoryPath,
        defaultTopologyPath: state.defaults.topologyPath,
        initialOptions: state.options,
      });
      await recalcState(state, clickedDir);
      await postSetupState(panel, state);
      return;
    }

    if (message.type === 'setupPanelConfirmLoad') {
      await confirmAndLoad();
      return;
    }

    if (message.type === 'setupPanelCancel') {
      panel.dispose();
      return;
    }
  });
}

export async function openMdDatasetDefault(
  context: vscode.ExtensionContext,
  input?: vscode.Uri | SetupCommandInput | string
): Promise<void> {
  await openMdDatasetSetupPanel(context, input, 'default');
}

export async function openMdDatasetWithOptionsPanel(
  context: vscode.ExtensionContext,
  input?: vscode.Uri | SetupCommandInput | string
): Promise<void> {
  await openMdDatasetSetupPanel(context, input, 'with_options');
}
