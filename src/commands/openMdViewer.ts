import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DatasetResolver, ResolveDatasetOptions } from '../parsing/DatasetResolver';
import { ITrajectoryParser, ITopologyParser, TrajectoryData } from '../parsing/IParser';
import { XyzParser } from '../parsing/xyz';
import { XtcParser, DcdParser, TrrParser, NcParser, Rst7Parser, BinaryTrajectoryFormat } from '../parsing/xtc';
import { PdbParser } from '../parsing/pdb';
import { GroParser } from '../parsing/gro';
import { Parm7Parser } from '../parsing/parm7';
import { getWebviewHtml } from '../webview/getHtml';
import { logDebug } from '../logger';
import { DatasetNormalizer } from '../normalization/DatasetNormalizer';
import { PayloadBuilder } from '../normalization/PayloadBuilder';
import { emitCheckpoint } from '../runtimeCheckpoint';
import { RUNTIME_BRIDGE_SCRIPTS, resolveRuntimeBridgePath } from '../runtime/bridgePaths';
import {
  MdDatasetLoadOptions,
  createDefaultLoadOptions,
  withLoadModeDefaults,
  computeEffectiveLoadBehavior,
  normalizeOptionsFromInput,
  SelectionPreset,
  SolventHandling,
  DatasetLoadMode,
} from '../options/LoadOptions';

const trajectoryParsers: ITrajectoryParser[] = [
  new XyzParser(),
  new XtcParser(),
  new DcdParser(),
  new TrrParser(),
  new NcParser(),
  new Rst7Parser(),
];

const topologyParsers: ITopologyParser[] = [
  new PdbParser(),
  new GroParser(),
  new Parm7Parser(),
];

const BINARY_TRAJECTORY_EXT_TO_FORMAT: Record<string, BinaryTrajectoryFormat> = {
  '.xtc': 'xtc',
  '.dcd': 'dcd',
  '.trr': 'trr',
  '.nc': 'nc',
  '.rst7': 'rst7',
};
const AMBER_TRAJECTORY_EXTS = new Set(['.nc', '.rst7']);
const AMBER_TOPOLOGY_EXTS = new Set(['.parm7']);

type BinaryFlowCheckpointPhase =
  | 'commandFired'
  | 'resolverStart'
  | 'resolverResult'
  | 'parserSelected'
  | 'topologyParsed'
  | 'normalizationDone'
  | 'payloadBuilt'
  | 'webviewPostmessage';

const BINARY_FLOW_CHECKPOINTS: Record<BinaryTrajectoryFormat, Record<BinaryFlowCheckpointPhase, string>> = {
  xtc: {
    commandFired: 'CHK_XTC_1_COMMAND_FIRED',
    resolverStart: 'CHK_XTC_2_RESOLVER_START',
    resolverResult: 'CHK_XTC_3_RESOLVER_RESULT',
    parserSelected: 'CHK_XTC_4_TRAJECTORY_PARSER_SELECTED',
    topologyParsed: 'CHK_XTC_8_TOPOLOGY_PARSED',
    normalizationDone: 'CHK_XTC_9_NORMALIZATION_DONE',
    payloadBuilt: 'CHK_XTC_10_PAYLOAD_BUILT',
    webviewPostmessage: 'CHK_XTC_11_WEBVIEW_POSTMESSAGE',
  },
  dcd: {
    commandFired: 'CHK_DCD_1_COMMAND_FIRED',
    resolverStart: 'CHK_DCD_2_RESOLVER_START',
    resolverResult: 'CHK_DCD_3_RESOLVER_RESULT',
    parserSelected: 'CHK_DCD_4_TRAJECTORY_PARSER_SELECTED',
    topologyParsed: 'CHK_DCD_8_TOPOLOGY_PARSED',
    normalizationDone: 'CHK_DCD_9_NORMALIZATION_DONE',
    payloadBuilt: 'CHK_DCD_10_PAYLOAD_BUILT',
    webviewPostmessage: 'CHK_DCD_11_WEBVIEW_POSTMESSAGE',
  },
  trr: {
    commandFired: 'CHK_TRR_1_COMMAND_FIRED',
    resolverStart: 'CHK_TRR_2_RESOLVER_START',
    resolverResult: 'CHK_TRR_3_RESOLVER_RESULT',
    parserSelected: 'CHK_TRR_4_TRAJECTORY_PARSER_SELECTED',
    topologyParsed: 'CHK_TRR_8_TOPOLOGY_PARSED',
    normalizationDone: 'CHK_TRR_9_NORMALIZATION_DONE',
    payloadBuilt: 'CHK_TRR_10_PAYLOAD_BUILT',
    webviewPostmessage: 'CHK_TRR_11_WEBVIEW_POSTMESSAGE',
  },
  nc: {
    commandFired: 'CHK_NC_1_COMMAND_FIRED',
    resolverStart: 'CHK_NC_2_RESOLVER_START',
    resolverResult: 'CHK_NC_3_RESOLVER_RESULT',
    parserSelected: 'CHK_NC_4_TRAJECTORY_PARSER_SELECTED',
    topologyParsed: 'CHK_NC_8_TOPOLOGY_PARSED',
    normalizationDone: 'CHK_NC_9_NORMALIZATION_DONE',
    payloadBuilt: 'CHK_NC_10_PAYLOAD_BUILT',
    webviewPostmessage: 'CHK_NC_11_WEBVIEW_POSTMESSAGE',
  },
  rst7: {
    commandFired: 'CHK_RST7_1_COMMAND_FIRED',
    resolverStart: 'CHK_RST7_2_RESOLVER_START',
    resolverResult: 'CHK_RST7_3_RESOLVER_RESULT',
    parserSelected: 'CHK_RST7_4_TRAJECTORY_PARSER_SELECTED',
    topologyParsed: 'CHK_RST7_8_TOPOLOGY_PARSED',
    normalizationDone: 'CHK_RST7_9_NORMALIZATION_DONE',
    payloadBuilt: 'CHK_RST7_10_PAYLOAD_BUILT',
    webviewPostmessage: 'CHK_RST7_11_WEBVIEW_POSTMESSAGE',
  },
};

const STREAM_CHECKPOINT_PREFIX: Record<BinaryTrajectoryFormat, string> = {
  xtc: 'CHK_STREAM_XTC',
  dcd: 'CHK_STREAM_DCD',
  trr: 'CHK_STREAM_TRR',
  nc: 'CHK_STREAM_NC',
  rst7: 'CHK_STREAM_RST7',
};

type StreamCheckpointStep = 3 | 4 | 5 | 6;
type StreamCheckpointSuffix =
  | 'INITIAL_FRAME_READY'
  | 'INIT_PAYLOAD_SENT'
  | 'FRAME_CHUNK_REQUEST'
  | 'FRAME_CHUNK_RETURNED';

function binaryFormatFromExt(ext: string): BinaryTrajectoryFormat | undefined {
  return BINARY_TRAJECTORY_EXT_TO_FORMAT[ext];
}

function isAmberFlow(trajectoryExt: string, topologyExt: string, clickedExt: string): boolean {
  return AMBER_TRAJECTORY_EXTS.has(trajectoryExt) || AMBER_TRAJECTORY_EXTS.has(clickedExt) || AMBER_TOPOLOGY_EXTS.has(topologyExt);
}

function emitBinaryCheckpoint(
  format: BinaryTrajectoryFormat | undefined,
  phase: BinaryFlowCheckpointPhase,
  payload: Record<string, unknown>
): void {
  if (!format) return;
  const checkpoint = BINARY_FLOW_CHECKPOINTS[format][phase];
  emitCheckpoint(checkpoint, payload);
}

function emitStreamCheckpoint(
  format: BinaryTrajectoryFormat | undefined,
  step: StreamCheckpointStep,
  suffix: StreamCheckpointSuffix,
  payload: Record<string, unknown>
): void {
  emitCheckpoint(`CHK_STREAM_${step}_${suffix}`, payload);
  if (!format) return;
  emitCheckpoint(`${STREAM_CHECKPOINT_PREFIX[format]}_${step}_${suffix}`, payload);
}

function arrayLengthOrNull(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function sampleArray(value: unknown, maxItems = 6): unknown[] {
  return Array.isArray(value) ? value.slice(0, maxItems) : [];
}

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

type DependencyErrorGuidance = {
  dependencyIssue: boolean;
  userMessage: string;
  actionableDetails: string[];
  extensionHost: string;
  actualCause: string | null;
};

function extractActualBridgeCause(errorMessage: string): string | null {
  const match = errorMessage.match(/actual bridge error:\s*(.+)$/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
}

function buildDependencyErrorGuidance(
  errorMessage: string,
  context: { trajectoryExt: string; topologyExt: string }
): DependencyErrorGuidance {
  const raw = errorMessage || '';
  const msg = raw.toLowerCase();
  const actualCause = extractActualBridgeCause(raw);
  const extensionHost = vscode.env.remoteName ? `remote (${vscode.env.remoteName})` : 'local';
  const actionableDetails: string[] = [];
  let dependencyIssue = false;

  const binaryBridgePath = resolveRuntimeBridgePath(RUNTIME_BRIDGE_SCRIPTS.binaryTrajectory);
  const parm7BridgePath = resolveRuntimeBridgePath(RUNTIME_BRIDGE_SCRIPTS.parm7Topology);
  const binaryBridgeExists = fs.existsSync(binaryBridgePath);
  const parm7BridgeExists = fs.existsSync(parm7BridgePath);

  const missingCorePackage =
    msg.includes('no module named mdtraj')
    || msg.includes('no module named numpy')
    || msg.includes('no module named scipy')
    || msg.includes('modulenotfounderror');
  const missingNetcdfPackage = msg.includes('no module named netcdf4') || msg.includes('netcdf4');
  const mpiRelatedIssue = msg.includes('mpi4py') || msg.includes('mpi');
  const parm7BridgeRuntimeError = context.topologyExt === '.parm7'
    && (
      msg.includes('notimplementederror')
      || msg.includes('is_protein')
      || msg.includes('is_nucleic')
      || msg.includes('.parm7 parser bridge failed')
      || msg.includes('failed to parse .parm7 bridge json')
    );
  const ncBackendFormatError = (context.trajectoryExt === '.nc' || context.trajectoryExt === '.rst7')
    && (
      msg.includes("unexpected keyword argument 'format'")
      || msg.includes('netcdf_file.__init__')
    );

  if (missingCorePackage) {
    dependencyIssue = true;
    actionableDetails.push('Core runtime packages are required: mdtraj, numpy, scipy');
    if (context.topologyExt === '.parm7') {
      actionableDetails.push('.parm7 topology support is blocked until mdtraj imports successfully');
    }
  }
  if ((context.trajectoryExt === '.nc' || context.trajectoryExt === '.rst7') && (missingNetcdfPackage || mpiRelatedIssue)) {
    dependencyIssue = true;
    actionableDetails.push('.nc/.rst7 capability is unavailable or degraded on the selected interpreter');
    actionableDetails.push('On HPC, netCDF4 may require cluster MPI/Python modules before import succeeds');
  }
  if (parm7BridgeRuntimeError) {
    dependencyIssue = true;
    actionableDetails.push('.parm7 topology bridge runtime failed on this interpreter');
    actionableDetails.push('This is often interpreter/runtime specific on HPC; switch interpreters and rerun diagnostics');
  }
  if (ncBackendFormatError) {
    dependencyIssue = true;
    actionableDetails.push('.nc runtime bridge is incompatible with this scipy/netcdf backend on the selected interpreter');
    if (actualCause) {
      actionableDetails.push(`Actual backend error: ${actualCause}`);
    }
    actionableDetails.push('Select another interpreter/venv and rerun diagnostics before retrying .nc');
  }
  if (msg.includes('no module named') || msg.includes('modulenotfounderror')) {
    dependencyIssue = true;
    actionableDetails.push('Install required Python packages in the selected interpreter');
  }
  if (msg.includes('failed to spawn') || msg.includes('enoent') || msg.includes('python')) {
    dependencyIssue = true;
    actionableDetails.push('Set mdViewer.pythonInterpreter to a valid Python executable');
  }
  if (msg.includes('bridge is missing') || msg.includes('binary_traj_bridge.py') || msg.includes('parm7_topology_bridge.py')) {
    dependencyIssue = true;
    if (!binaryBridgeExists || !parm7BridgeExists) {
      actionableDetails.push('Reinstall/update the extension so runtime bridge scripts are present');
      if (!binaryBridgeExists) {
        actionableDetails.push(`Missing bridge script: ${binaryBridgePath}`);
      }
      if (!parm7BridgeExists) {
        actionableDetails.push(`Missing bridge script: ${parm7BridgePath}`);
      }
    } else {
      actionableDetails.push('Bridge scripts are present; this looks like an interpreter/runtime dependency issue');
    }
  }

  if (!dependencyIssue) {
    return {
      dependencyIssue: false,
      userMessage: `MD Viewer: could not parse trajectory — ${errorMessage}`,
      actionableDetails: [],
      extensionHost,
      actualCause,
    };
  }

  actionableDetails.push(`Run "MD Viewer: Run Dependency Diagnostics" on the ${extensionHost} extension host`);
  actionableDetails.push('Try "MD Viewer: Select Python Interpreter" to switch to a validated venv');
  actionableDetails.push('Try "MD Viewer: Bootstrap Remote Python Runtime" to create ~/.venvs/mdviewer');
  const dedupedDetails = Array.from(new Set(actionableDetails));
  return {
    dependencyIssue: true,
    userMessage: `MD Viewer dependency/runtime issue on ${extensionHost}: ${dedupedDetails.join('; ')}.`,
    actionableDetails: dedupedDetails,
    extensionHost,
    actualCause,
  };
}

function isBinaryStreamingEnabled(format: BinaryTrajectoryFormat | undefined): boolean {
  if (!format) return false;
  if (process.env.MD_VIEWER_DISABLE_BINARY_STREAMING === '1') {
    return false;
  }
  const disableByFormatKey = `MD_VIEWER_DISABLE_${format.toUpperCase()}_STREAMING`;
  return process.env[disableByFormatKey] !== '1';
}

function safeJsonByteLength(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return null;
  }
}

function summarizeTopology(topology: any): Record<string, unknown> {
  return {
    hasTopologyFlag: Boolean(topology?.hasTopology),
    bondPairsLength: arrayLengthOrNull(topology?.bondPairs),
    residueEntriesLength: arrayLengthOrNull(topology?.residueEntries),
    atomToResidueLength: arrayLengthOrNull(topology?.atomToResidue),
    chainsLength: arrayLengthOrNull(topology?.chains),
    atomToChainLength: arrayLengthOrNull(topology?.atomToChain),
    caIndicesLength: arrayLengthOrNull(topology?.caIndices),
    caLinePairsLength: arrayLengthOrNull(topology?.caLinePairs),
    ligandIndicesLength: arrayLengthOrNull(topology?.ligandIndices),
    ionIndicesLength: arrayLengthOrNull(topology?.ionIndices),
    ligandIonIndicesLength: arrayLengthOrNull(topology?.ligandIonIndices),
    residueEntriesSample: sampleArray(topology?.residueEntries),
  };
}

function summarizeInitPayload(initPayload: any): Record<string, unknown> {
  const top = initPayload?.data?.topology;
  const trajectory = initPayload?.data?.trajectory;
  return {
    topologyPresent: Boolean(top),
    topologyKeys: top ? Object.keys(top) : [],
    topology_hasTopology_present: top ? Object.prototype.hasOwnProperty.call(top, 'hasTopology') : false,
    topology_residueEntries_present: top ? Object.prototype.hasOwnProperty.call(top, 'residueEntries') : false,
    topology_residueEntries_length: arrayLengthOrNull(top?.residueEntries),
    topology_atomToResidue_present: top ? Object.prototype.hasOwnProperty.call(top, 'atomToResidue') : false,
    topology_atomToResidue_length: arrayLengthOrNull(top?.atomToResidue),
    topology_chains_present: top ? Object.prototype.hasOwnProperty.call(top, 'chains') : false,
    topology_chains_length: arrayLengthOrNull(top?.chains),
    topology_atomToChain_present: top ? Object.prototype.hasOwnProperty.call(top, 'atomToChain') : false,
    topology_atomToChain_length: arrayLengthOrNull(top?.atomToChain),
    topology_caIndices_present: top ? Object.prototype.hasOwnProperty.call(top, 'caIndices') : false,
    topology_caIndices_length: arrayLengthOrNull(top?.caIndices),
    topology_bondPairs_present: top ? Object.prototype.hasOwnProperty.call(top, 'bondPairs') : false,
    topology_bondPairs_length: arrayLengthOrNull(top?.bondPairs),
    topology_backbonePairs_field: top && Object.prototype.hasOwnProperty.call(top, 'backbonePairs') ? 'backbonePairs' : 'caLinePairs',
    topology_backbonePairs_length: arrayLengthOrNull(top?.backbonePairs ?? top?.caLinePairs),
    topology_ligandIndices_present: top ? Object.prototype.hasOwnProperty.call(top, 'ligandIndices') : false,
    topology_ligandIndices_length: arrayLengthOrNull(top?.ligandIndices),
    topology_ionIndices_present: top ? Object.prototype.hasOwnProperty.call(top, 'ionIndices') : false,
    topology_ionIndices_length: arrayLengthOrNull(top?.ionIndices),
    topology_ligandIonIndices_present: top ? Object.prototype.hasOwnProperty.call(top, 'ligandIonIndices') : false,
    topology_ligandIonIndices_length: arrayLengthOrNull(top?.ligandIonIndices),
    topology_commonSolventIndices_present: top ? Object.prototype.hasOwnProperty.call(top, 'commonSolventIndices') : false,
    topology_commonSolventIndices_length: arrayLengthOrNull(top?.commonSolventIndices),
    topology_commonSolventResidueNames_length: arrayLengthOrNull(top?.commonSolventResidueNames),
    topology_commonSolventResidueNames_sample: sampleArray(top?.commonSolventResidueNames),
    topology_commonSolventThreshold: top?.commonSolventThreshold ?? null,
    topology_residueNameCounts_keys: top?.residueNameCounts ? Object.keys(top.residueNameCounts).length : null,
    trajectory_present: Boolean(trajectory),
    trajectory_accessMode: trajectory?.accessMode ?? null,
    trajectory_format: trajectory?.format ?? null,
    trajectory_frameCount: trajectory?.frameCount ?? null,
    trajectory_rawFrameCount: trajectory?.rawFrameCount ?? null,
    trajectory_sampledFrameCount: trajectory?.sampledFrameCount ?? null,
    trajectory_samplingFrameStride: trajectory?.samplingFrameStride ?? null,
    trajectory_supportsFrameRequests: trajectory?.supportsFrameRequests ?? null,
    trajectory_chunkSizeHint: trajectory?.chunkSizeHint ?? null,
    trajectory_initialFrameIndices_length: arrayLengthOrNull(trajectory?.initialFrameIndices),
    trajectory_initialFrameStride: trajectory?.initialFrameStride ?? null,
    displayFilter_present: Boolean(initPayload?.data?.displayFilter),
    displayFilter_selectionPreset: initPayload?.data?.displayFilter?.selectionPreset ?? null,
    displayFilter_solventHandling: initPayload?.data?.displayFilter?.solventHandling ?? null,
    displayFilter_commonSolventResidueNames_length: arrayLengthOrNull(initPayload?.data?.displayFilter?.commonSolventResidueNames),
    displayFilter_commonSolventResidueNames_sample: sampleArray(initPayload?.data?.displayFilter?.commonSolventResidueNames),
    displayFilter_commonSolventThreshold: initPayload?.data?.displayFilter?.commonSolventThreshold ?? null,
    displayFilter_hiddenAtomCount: initPayload?.data?.displayFilter?.hiddenAtomCount ?? null,
    displayFilter_visibleAtomCount: initPayload?.data?.displayFilter?.visibleAtomCount ?? null,
    displayFilter_hiddenResidueCount: initPayload?.data?.displayFilter?.hiddenResidueCount ?? null,
    displayFilter_visibleResidueCount: initPayload?.data?.displayFilter?.visibleResidueCount ?? null,
    data_frames_length: arrayLengthOrNull(initPayload?.data?.frames),
    data_atoms_length: arrayLengthOrNull(initPayload?.data?.atoms),
    stats_originalFramesCount: initPayload?.stats?.originalFramesCount ?? null,
    stats_decimated: initPayload?.stats?.decimated ?? null,
    stats_initFrameCount: initPayload?.stats?.initFrameCount ?? null,
    stats_initFrameStride: initPayload?.stats?.initFrameStride ?? null,
    stats_initRequestedFrameCount: initPayload?.stats?.initRequestedFrameCount ?? null,
    stats_hiddenAtomCount: initPayload?.stats?.hiddenAtomCount ?? null,
    stats_visibleAtomCount: initPayload?.stats?.visibleAtomCount ?? null,
    stats_initPayloadEstimatedFloatCount: initPayload?.stats?.initPayloadEstimatedFloatCount ?? null,
    stats_fullTrajectoryEstimatedFloatCount: initPayload?.stats?.fullTrajectoryEstimatedFloatCount ?? null,
  };
}

type AtomClassKey = 'polymer' | 'ligand' | 'ion' | 'solvent' | 'unknown';
const ATOM_CLASS_KEYS: AtomClassKey[] = ['polymer', 'ligand', 'ion', 'solvent', 'unknown'];

function normalizeAtomClass(value: unknown): AtomClassKey {
  if (value === 'polymer' || value === 'ligand' || value === 'ion' || value === 'solvent' || value === 'unknown') {
    return value;
  }
  return 'unknown';
}

function summarizeFilterClassVisibility(initPayload: any): {
  visibleClassCounts: Record<AtomClassKey, number>;
  hiddenClassCounts: Record<AtomClassKey, number>;
} {
  const visibleClassCounts = Object.fromEntries(ATOM_CLASS_KEYS.map((key) => [key, 0])) as Record<AtomClassKey, number>;
  const hiddenClassCounts = Object.fromEntries(ATOM_CLASS_KEYS.map((key) => [key, 0])) as Record<AtomClassKey, number>;
  const atoms = Array.isArray(initPayload?.data?.atoms) ? initPayload.data.atoms : [];
  const hiddenIndices = new Set<number>(
    Array.isArray(initPayload?.data?.displayFilter?.hiddenAtomIndices)
      ? initPayload.data.displayFilter.hiddenAtomIndices.map((idx: unknown) => Number(idx)).filter((idx: number) => Number.isInteger(idx) && idx >= 0)
      : []
  );

  for (let i = 0; i < atoms.length; i++) {
    const atomClass = normalizeAtomClass(atoms[i]?.classification);
    if (hiddenIndices.has(i)) {
      hiddenClassCounts[atomClass] += 1;
    } else {
      visibleClassCounts[atomClass] += 1;
    }
  }

  return { visibleClassCounts, hiddenClassCounts };
}

function buildReferencePayloadCapture(initPayload: any, context: {
  caseId: string | null;
  datasetName: string;
  trajectoryPath: string;
  trajectoryExt: string;
  topologyPath: string | null;
  topologyExt: string | null;
}): Record<string, unknown> {
  const data = initPayload?.data ?? {};
  const top = data?.topology ?? {};
  const residueEntries = Array.isArray(top?.residueEntries) ? top.residueEntries : [];
  const atomToResidue = Array.isArray(top?.atomToResidue) ? top.atomToResidue : [];
  const atomToChain = Array.isArray(top?.atomToChain) ? top.atomToChain : [];
  const chains = Array.isArray(top?.chains) ? top.chains : [];
  const caIndices = Array.isArray(top?.caIndices) ? top.caIndices : [];
  const caLinePairs = Array.isArray(top?.caLinePairs) ? top.caLinePairs : [];
  const ligandIndices = Array.isArray(top?.ligandIndices) ? top.ligandIndices : [];
  const ionIndices = Array.isArray(top?.ionIndices) ? top.ionIndices : [];
  const ligandIonIndices = Array.isArray(top?.ligandIonIndices) ? top.ligandIonIndices : [];
  const commonSolventIndices = Array.isArray(top?.commonSolventIndices) ? top.commonSolventIndices : [];
  const commonSolventResidueNames = Array.isArray(top?.commonSolventResidueNames) ? top.commonSolventResidueNames : [];
  const atoms = Array.isArray(data?.atoms) ? data.atoms : [];
  const frames = Array.isArray(data?.frames) ? data.frames : [];
  const trajectoryMeta = data?.trajectory ?? {};
  const displayFilter = data?.displayFilter ?? {};

  const ligandResidues = residueEntries
    .map((residue: any, id: number) => ({ id, residue }))
    .filter((entry: any) => Boolean(entry.residue?.isLigand))
    .map((entry: any) => ({
      id: entry.id,
      chainId: entry.residue?.chainId ?? '',
      resName: entry.residue?.resName ?? '',
      resSeq: entry.residue?.resSeq ?? null,
      label: `${entry.residue?.chainId ?? '_'}:${entry.residue?.resName ?? 'UNK'}${entry.residue?.resSeq ?? ''}`,
    }));

  const ionResidues = residueEntries
    .map((residue: any, id: number) => ({ id, residue }))
    .filter((entry: any) => Boolean(entry.residue?.isIon))
    .map((entry: any) => ({
      id: entry.id,
      chainId: entry.residue?.chainId ?? '',
      resName: entry.residue?.resName ?? '',
      resSeq: entry.residue?.resSeq ?? null,
      label: `${entry.residue?.chainId ?? '_'}:${entry.residue?.resName ?? 'UNK'}${entry.residue?.resSeq ?? ''}`,
    }));

  const sequenceResidueLabels = residueEntries.map((residue: any, id: number) => ({
    id,
    chainId: residue?.chainId ?? '',
    chainIndex: residue?.chainIndex ?? null,
    resName: residue?.resName ?? '',
    resSeq: residue?.resSeq ?? null,
    insertionCode: residue?.insertionCode ?? '',
    label: `${residue?.chainId ?? '_'}:${residue?.resName ?? 'UNK'}${residue?.resSeq ?? ''}${residue?.insertionCode ?? ''}`,
  }));

  const hasTopology = Boolean(top?.hasTopology);
  const capabilityFlags = {
    hasTopology,
    canResidueNavigate: hasTopology && residueEntries.length > 0,
    hasResidueEntries: residueEntries.length > 0,
    hasAtomToResidueMapping: atomToResidue.length === atoms.length && atomToResidue.length > 0,
    hasChainGrouping: chains.length > 0 && atomToChain.length === atoms.length,
    hasCaIndices: caIndices.length > 0,
    hasCaBackbonePairs: caLinePairs.length > 0,
    hasLigandResidues: ligandResidues.length > 0,
    hasIonResidues: ionResidues.length > 0,
    hasLigandAtomIndices: ligandIndices.length > 0,
    hasIonAtomIndices: ionIndices.length > 0,
    hasLigandIonAtomIndices: ligandIonIndices.length > 0,
    hasCommonSolventClass: commonSolventResidueNames.length > 0,
  };

  return {
    referenceCaseId: context.caseId,
    datasetName: context.datasetName,
    trajectoryPath: context.trajectoryPath,
    trajectoryExt: context.trajectoryExt,
    topologyPath: context.topologyPath,
    topologyExt: context.topologyExt,
    atomCount: data?.atomCount ?? atoms.length,
    frameCount: frames.length,
    trajectoryFrameCount: trajectoryMeta?.frameCount ?? null,
    trajectoryAccessMode: trajectoryMeta?.accessMode ?? null,
    trajectorySupportsFrameRequests: trajectoryMeta?.supportsFrameRequests ?? null,
    trajectoryInitialFrameStride: trajectoryMeta?.initialFrameStride ?? null,
    residueCount: residueEntries.length,
    chainCount: chains.length,
    hasTopology,
    residueEntriesLength: residueEntries.length,
    atomToResidueLength: atomToResidue.length,
    atomToChainLength: atomToChain.length,
    caIndicesLength: caIndices.length,
    caLinePairsLength: caLinePairs.length,
    ligandResidueCount: ligandResidues.length,
    ligandResidues,
    ionResidueCount: ionResidues.length,
    ionResidues,
    commonSolventAtomCount: commonSolventIndices.length,
    commonSolventResidueNames,
    commonSolventThreshold: top?.commonSolventThreshold ?? null,
    sequenceResidueLabels,
    displayFilter,
    topologyCapabilityFlagsUsedByViewer: capabilityFlags,
  };
}

type OptionsCommandInput = {
  uri?: vscode.Uri | string;
  options?: unknown;
};

type DatasetQuickPickItem = vscode.QuickPickItem & {
  absolutePath?: string;
  overrideValue?: string | null;
  loadMode?: DatasetLoadMode;
  selectionPreset?: SelectionPreset;
  solventHandling?: SolventHandling;
};

const TRAJECTORY_FILE_EXTS = ['.xyz', '.xtc', '.trr', '.dcd', '.nc', '.rst7', '.pdb'];
const TOPOLOGY_FILE_EXTS = ['.pdb', '.gro', '.parm7'];
const DATASET_FILE_FILTERS = ['xyz', 'xtc', 'trr', 'dcd', 'nc', 'rst7', 'pdb', 'gro', 'parm7'];

function resolveUriFromCommandInput(input: vscode.Uri | OptionsCommandInput | string | undefined): vscode.Uri | undefined {
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

function parsePresetOptions(): MdDatasetLoadOptions | undefined {
  const raw = process.env.MD_VIEWER_OPTIONS_PRESET_JSON;
  if (!raw || raw.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    return normalizeOptionsFromInput(parsed, 'with_options');
  } catch (err) {
    emitCheckpoint('CHK_OPT_4_LOAD_OPTIONS_FINALIZED', {
      parseOutcome: 'error',
      source: 'envPreset',
      error: err instanceof Error ? err.message : String(err),
      rawLength: raw.length,
    });
    return undefined;
  }
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

async function listDirectoryFiles(dirPath: string): Promise<string[]> {
  try {
    const siblings = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
    return siblings
      .filter(([_, type]) => type === vscode.FileType.File)
      .map(([name]) => name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function pickExtCandidates(files: string[], exts: string[]): string[] {
  return files.filter((name) => exts.includes(path.extname(name).toLowerCase()));
}

async function collectLoadOptionsViaQuickPick(
  targetUri: vscode.Uri,
  defaultResolution: { trajectoryPath: string; topologyPath?: string }
): Promise<MdDatasetLoadOptions | undefined> {
  const defaults = createDefaultLoadOptions('with_options');
  const dirPath = path.dirname(targetUri.fsPath);
  const files = await listDirectoryFiles(dirPath);
  const trajectoryCandidates = pickExtCandidates(files, TRAJECTORY_FILE_EXTS);
  const topologyCandidates = pickExtCandidates(files, TOPOLOGY_FILE_EXTS);
  const defaultTrajectoryName = path.basename(defaultResolution.trajectoryPath);
  const defaultTopologyName = defaultResolution.topologyPath ? path.basename(defaultResolution.topologyPath) : null;

  const trajectoryItems: DatasetQuickPickItem[] = trajectoryCandidates.map((name) => ({
    label: name === defaultTrajectoryName ? `${name} (Resolver Default)` : name,
    detail: path.join(dirPath, name),
    absolutePath: path.join(dirPath, name),
  }));
  if (trajectoryItems.length === 0) {
    trajectoryItems.push({
      label: defaultTrajectoryName,
      detail: defaultResolution.trajectoryPath,
      absolutePath: defaultResolution.trajectoryPath,
    });
  }
  const pickedTrajectory = await vscode.window.showQuickPick(trajectoryItems, {
    placeHolder: 'Select trajectory file for this dataset',
  });
  if (!pickedTrajectory?.absolutePath) return undefined;

  const topologyItems: DatasetQuickPickItem[] = [
    {
      label: 'None (trajectory only)',
      detail: 'Do not attach a topology sidecar file',
      overrideValue: null,
    },
    ...topologyCandidates.map((name) => ({
      label: name === defaultTopologyName ? `${name} (Resolver Default)` : name,
      detail: path.join(dirPath, name),
      absolutePath: path.join(dirPath, name),
      overrideValue: path.join(dirPath, name),
    })),
  ];
  const pickedTopology = await vscode.window.showQuickPick(topologyItems, {
    placeHolder: 'Select topology sidecar (if any)',
  });
  if (!pickedTopology) return undefined;

  const loadModeItems: DatasetQuickPickItem[] = [
    { label: 'Standard (Recommended)', description: 'Matches current default behavior', loadMode: 'standard' },
    { label: 'Fast preview', description: 'Sparse initial load for speed', loadMode: 'fast_preview' },
    { label: 'Fuller initial load', description: 'Larger initial frame set', loadMode: 'fuller_initial' },
  ];
  const pickedLoadMode = await vscode.window.showQuickPick(loadModeItems, {
    placeHolder: 'Select initial load behavior',
  });
  if (!pickedLoadMode?.loadMode) return undefined;
  const behaviorDefaults = withLoadModeDefaults(pickedLoadMode.loadMode);

  const strideInput = await vscode.window.showInputBox({
    title: 'Open MD Dataset With Options',
    prompt: 'Frame stride (sample every Nth frame)',
    value: String(behaviorDefaults.frameStride),
    validateInput: (value) => {
      const parsed = parseInt(value, 10);
      return Number.isFinite(parsed) && parsed > 0 ? null : 'Enter a positive integer';
    },
  });
  if (strideInput === undefined) return undefined;
  const frameStride = Math.max(1, parseInt(strideInput, 10));

  const selectionPresetItems: DatasetQuickPickItem[] = [
    { label: 'Everything (Recommended)', selectionPreset: 'everything' },
    { label: 'Protein + ligand + ions', selectionPreset: 'protein_ligand_ions' },
    { label: 'Protein + ligand', selectionPreset: 'protein_ligand' },
    { label: 'Protein only', selectionPreset: 'protein_only' },
  ];
  const pickedSelectionPreset = await vscode.window.showQuickPick(selectionPresetItems, {
    placeHolder: 'Select base visible classes',
  });
  if (!pickedSelectionPreset?.selectionPreset) return undefined;

  const solventHandlingItems: DatasetQuickPickItem[] = [
    { label: 'Keep all solvent (Recommended)', solventHandling: 'keep_all' },
    { label: 'Hide common solvent', solventHandling: 'hide_common_solvent' },
  ];
  const pickedSolventHandling = await vscode.window.showQuickPick(solventHandlingItems, {
    placeHolder: 'Select solvent visibility adjustment',
  });
  if (!pickedSolventHandling?.solventHandling) return undefined;

  const behavior = withLoadModeDefaults(pickedLoadMode.loadMode, {
    frameStride,
  });

  return {
    source: 'with_options',
    resolution: {
      trajectoryPathOverride: pickedTrajectory.absolutePath,
      topologyPathOverride: pickedTopology.overrideValue ?? pickedTopology.absolutePath ?? null,
    },
    behavior,
    filtering: {
      selectionPreset: pickedSelectionPreset.selectionPreset,
      solventHandling: pickedSolventHandling.solventHandling,
    },
  };
}

export async function openMdViewerWithOptions(
  context: vscode.ExtensionContext,
  input?: vscode.Uri | OptionsCommandInput | string
): Promise<void> {
  const targetUri = await pickTargetUri(
    resolveUriFromCommandInput(input),
    'Open MD Dataset With Options'
  );
  if (!targetUri) {
    return;
  }

  emitCheckpoint('CHK_OPT_1_OPTIONS_COMMAND_FIRED', {
    clickedPath: targetUri.fsPath,
    clickedExt: path.extname(targetUri.fsPath).toLowerCase(),
    clickedName: path.basename(targetUri.fsPath),
    clickedDir: path.dirname(targetUri.fsPath),
  });

  const defaultResolution = await DatasetResolver.resolveDataset(targetUri, { interactive: false });
  emitCheckpoint('CHK_OPT_2_DEFAULT_RESOLUTION', {
    clickedPath: targetUri.fsPath,
    hasDefaultResolution: Boolean(defaultResolution),
    defaultTrajectoryPath: defaultResolution?.trajectoryPath ?? null,
    defaultTopologyPath: defaultResolution?.topologyPath ?? null,
    datasetName: defaultResolution?.datasetName ?? null,
  });
  if (!defaultResolution) {
    void vscode.window.showWarningMessage('MD Viewer: could not resolve default dataset for options flow.');
    return;
  }

  const programmaticOptions = (typeof input === 'object' && input && !(input instanceof vscode.Uri))
    ? normalizeOptionsFromInput((input as OptionsCommandInput).options, 'with_options')
    : undefined;
  const presetOptions = parsePresetOptions();
  const userOptions = programmaticOptions
    ?? presetOptions
    ?? await collectLoadOptionsViaQuickPick(targetUri, defaultResolution);
  if (!userOptions) {
    return;
  }

  const trajectoryOverrideChanged = userOptions.resolution.trajectoryPathOverride
    ? path.resolve(userOptions.resolution.trajectoryPathOverride) !== path.resolve(defaultResolution.trajectoryPath)
    : false;
  const topologyOverrideChanged =
    userOptions.resolution.topologyPathOverride !== undefined
      ? (userOptions.resolution.topologyPathOverride ?? null) !== (defaultResolution.topologyPath ?? null)
      : false;

  emitCheckpoint('CHK_OPT_3_USER_OVERRIDE_APPLIED', {
    defaultTrajectoryPath: defaultResolution.trajectoryPath,
    defaultTopologyPath: defaultResolution.topologyPath ?? null,
    userTrajectoryOverride: userOptions.resolution.trajectoryPathOverride ?? null,
    userTopologyOverride: userOptions.resolution.topologyPathOverride ?? null,
    trajectoryOverrideChanged,
    topologyOverrideChanged,
  });
  emitCheckpoint('CHK_OPT_4_LOAD_OPTIONS_FINALIZED', {
    source: userOptions.source,
    resolution: userOptions.resolution,
    behavior: userOptions.behavior,
    filtering: userOptions.filtering,
  });

  await openMdViewer(context, targetUri, userOptions);
}

export async function openMdViewer(
  context: vscode.ExtensionContext,
  uri?: vscode.Uri,
  loadOptions?: MdDatasetLoadOptions
): Promise<void> {
  // If called from the command palette without a URI, ask the user to pick a file
  let targetUri = uri;
  if (!targetUri) {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'MD Dataset files': DATASET_FILE_FILTERS },
      title: 'Open MD Dataset',
    });
    if (!picked || picked.length === 0) {
      return;
    }
    targetUri = picked[0];
  }

  const clickedExt = path.extname(targetUri.fsPath).toLowerCase();
  const clickedDir = path.dirname(targetUri.fsPath);
  const clickedName = path.basename(targetUri.fsPath);
  const clickedBinaryFormat = binaryFormatFromExt(clickedExt);
  const referenceModeEnabled = process.env.MD_VIEWER_REFERENCE_MODE === '1';
  const referenceCaseId = process.env.MD_VIEWER_REFERENCE_CASE_ID ?? null;
  let groCommandLogged = false;
  if (clickedBinaryFormat) {
    emitBinaryCheckpoint(clickedBinaryFormat, 'commandFired', {
      clickedPath: targetUri.fsPath,
      clickedExt,
      clickedName,
      clickedDir,
    });
    emitBinaryCheckpoint(clickedBinaryFormat, 'resolverStart', {
      clickedPath: targetUri.fsPath,
      clickedExt,
      clickedName,
      clickedDir,
    });
  }
  if (clickedExt === '.gro') {
    groCommandLogged = true;
    emitCheckpoint('CHK_GRO_1_COMMAND_FIRED', {
      clickedPath: targetUri.fsPath,
      clickedExt,
      clickedName,
      clickedDir,
      trigger: 'clickedGroFile',
    });
  }

  // Resolve combining files
  logDebug('openMdViewer', 'Attempting to resolve dataset from URI', { fsPath: targetUri.fsPath });
  const resolveOptions: ResolveDatasetOptions = {
    interactive: (loadOptions?.source === 'with_options' || loadOptions?.source === 'setup_panel') ? false : true,
    trajectoryPathOverride: loadOptions?.resolution.trajectoryPathOverride,
    topologyPathOverride: loadOptions?.resolution.topologyPathOverride,
  };
  const dataset = await DatasetResolver.resolveDataset(targetUri, resolveOptions);
  if (!dataset) {
    emitBinaryCheckpoint(clickedBinaryFormat, 'resolverResult', {
      resolved: false,
      reason: 'DatasetResolver returned undefined',
    });
    logDebug('openMdViewer', 'Resolution cancelled or failed');
    return; // cancelled
  }
  
  logDebug('openMdViewer', 'Resolved dataset', { dataset });

  const fileName = dataset.datasetName;
  const trajectoryExt = path.extname(dataset.trajectoryPath).toLowerCase();
  const topologyExt = dataset.topologyPath ? path.extname(dataset.topologyPath).toLowerCase() : '';
  const binaryFlowFormat = binaryFormatFromExt(trajectoryExt);
  const isXtcFlow = binaryFlowFormat === 'xtc';
  const isGroBackedFlow = topologyExt === '.gro' || clickedExt === '.gro';
  const isAmberDatasetFlow = isAmberFlow(trajectoryExt, topologyExt, clickedExt);

  emitBinaryCheckpoint(binaryFlowFormat, 'resolverResult', {
    resolved: true,
    clickedPath: targetUri.fsPath,
    trajectoryPath: dataset.trajectoryPath,
    trajectoryExt,
    topologyPath: dataset.topologyPath ?? null,
    topologyExt: topologyExt || null,
    datasetName: dataset.datasetName,
  });
  if (isAmberDatasetFlow) {
    emitCheckpoint('CHK_AMBER_1_RESOLVER_MATCHED', {
      clickedPath: targetUri.fsPath,
      clickedExt,
      trajectoryPath: dataset.trajectoryPath,
      trajectoryExt,
      topologyPath: dataset.topologyPath ?? null,
      topologyExt: topologyExt || null,
      datasetName: dataset.datasetName,
    });
  }

  if (isGroBackedFlow && !groCommandLogged) {
    groCommandLogged = true;
    emitCheckpoint('CHK_GRO_1_COMMAND_FIRED', {
      clickedPath: targetUri.fsPath,
      clickedExt,
      clickedName,
      clickedDir,
      trigger: 'resolvedGroBackedDataset',
    });
  }

  if (isGroBackedFlow) {
    emitCheckpoint('CHK_GRO_2_RESOLVER_RESULT', {
      clickedPath: targetUri.fsPath,
      trajectoryPath: dataset.trajectoryPath,
      trajectoryExt,
      topologyPath: dataset.topologyPath ?? null,
      topologyExt: topologyExt || null,
      datasetName: dataset.datasetName,
    });
  }

  // Show progress while parsing (large trajectories can be slow)
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `MD Viewer: loading dataset ${fileName}…`,
      cancellable: false,
    },
    async () => {

      // Determine correct parsers
      const extTrajectory = path.extname(dataset.trajectoryPath).toLowerCase();
      const trajParser = trajectoryParsers.find(p => p.canParse(extTrajectory));
      emitBinaryCheckpoint(binaryFlowFormat, 'parserSelected', {
        extTrajectory,
        parserSelected: Boolean(trajParser),
        parserName: trajParser ? trajParser.constructor.name : null,
        availableTrajectoryParsers: trajectoryParsers.map((parser) => parser.constructor.name),
        topologyPathProvidedToParser: dataset.topologyPath ?? null,
      });
      if (extTrajectory === '.nc') {
        emitCheckpoint('CHK_AMBER_3_NC_PARSER_SELECTED', {
          extTrajectory,
          parserSelected: Boolean(trajParser),
          parserName: trajParser ? trajParser.constructor.name : null,
          topologyPathProvidedToParser: dataset.topologyPath ?? null,
          availableTrajectoryParsers: trajectoryParsers.map((parser) => parser.constructor.name),
        });
      }
      if (extTrajectory === '.rst7') {
        emitCheckpoint('CHK_AMBER_4_RST7_PARSER_SELECTED', {
          extTrajectory,
          parserSelected: Boolean(trajParser),
          parserName: trajParser ? trajParser.constructor.name : null,
          topologyPathProvidedToParser: dataset.topologyPath ?? null,
          availableTrajectoryParsers: trajectoryParsers.map((parser) => parser.constructor.name),
        });
      }
      
      let trajectory: TrajectoryData | undefined;
      let trajectoryProviderMetadata: {
        atomCount: number;
        frameCount: number;
        format: string;
        accessMode: string;
        supportsChunkRequests: boolean;
        defaultChunkSize?: number;
      } | null = null;
      if (trajParser) {
        logDebug('openMdViewer', `Selected trajectory parser: ${trajParser.constructor.name}`);
        try {
          trajectory = await trajParser.parse(dataset.trajectoryPath, dataset.topologyPath);
          const providerMeta = await trajectory.trajectoryProvider.getMetadata();
          trajectoryProviderMetadata = {
            atomCount: providerMeta.atomCount,
            frameCount: providerMeta.frameCount,
            format: providerMeta.format,
            accessMode: providerMeta.accessMode,
            supportsChunkRequests: providerMeta.supportsChunkRequests,
            defaultChunkSize: providerMeta.defaultChunkSize,
          };
          logDebug('openMdViewer', `Trajectory parsed`, {
            atomCount: trajectory.atomCount,
            frameCount: trajectory.frameCount,
            sourceFormat: trajectory.sourceFormat,
            accessMode: trajectory.accessMode,
            providerMetadata: trajectoryProviderMetadata,
          });
          if (isAmberDatasetFlow) {
            emitCheckpoint('CHK_AMBER_6_TRAJECTORY_METADATA_READY', {
              trajectoryPath: dataset.trajectoryPath,
              trajectoryExt: extTrajectory,
              topologyPath: dataset.topologyPath ?? null,
              topologyExt: topologyExt || null,
              atomCount: trajectory.atomCount,
              frameCount: trajectory.frameCount,
              sourceFormat: trajectory.sourceFormat,
              accessMode: trajectory.accessMode,
              providerMetadata: trajectoryProviderMetadata,
            });
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const guidance = buildDependencyErrorGuidance(msg, {
            trajectoryExt: extTrajectory,
            topologyExt: topologyExt || '',
          });
          emitBinaryCheckpoint(binaryFlowFormat, 'parserSelected', {
            extTrajectory,
            parserSelected: true,
            parserName: trajParser.constructor.name,
            parseOutcome: 'error',
            error: msg,
          });
          emitCheckpoint('CHK_DEP_5_RUNTIME_FAILURE_GUIDANCE', {
            trajectoryPath: dataset.trajectoryPath,
            topologyPath: dataset.topologyPath ?? null,
            trajectoryExt: extTrajectory,
            dependencyIssue: guidance.dependencyIssue,
            extensionHost: guidance.extensionHost,
            userMessage: guidance.userMessage,
            actualCause: guidance.actualCause,
            actionableDetails: guidance.actionableDetails,
            rawError: msg,
          });
          if (extTrajectory === '.nc') {
            emitCheckpoint('CHK_AMBER_3_NC_PARSER_SELECTED', {
              extTrajectory,
              parserSelected: true,
              parserName: trajParser.constructor.name,
              parseOutcome: 'error',
              error: msg,
            });
          }
          if (extTrajectory === '.rst7') {
            emitCheckpoint('CHK_AMBER_4_RST7_PARSER_SELECTED', {
              extTrajectory,
              parserSelected: true,
              parserName: trajParser.constructor.name,
              parseOutcome: 'error',
              error: msg,
            });
          }
          logDebug('openMdViewer', `Trajectory parsing failed: ${msg}`);
          if (guidance.dependencyIssue) {
            void vscode.window
              .showErrorMessage(
                guidance.userMessage,
                'Run Dependency Diagnostics',
                'Select Python Interpreter',
                'Bootstrap Remote Runtime'
              )
              .then((choice) => {
                if (choice === 'Run Dependency Diagnostics') {
                  void vscode.commands.executeCommand('md-viewer.runDependencyDiagnostics');
                } else if (choice === 'Select Python Interpreter') {
                  void vscode.commands.executeCommand('md-viewer.selectPythonInterpreter');
                } else if (choice === 'Bootstrap Remote Runtime') {
                  void vscode.commands.executeCommand('md-viewer.bootstrapRemoteRuntime');
                }
              });
          } else {
            void vscode.window.showErrorMessage(`MD Viewer: could not parse trajectory — ${msg}`);
          }
          return;
        }
      } else {
        logDebug('openMdViewer', `No parser matched for trajectory extension: ${extTrajectory}`);
        void vscode.window.showErrorMessage(`MD Viewer: unsupported trajectory format ${extTrajectory}`);
        return;
      }

      // ── Topology Loading ──────────────────────────────────────────
      let topology: any = undefined;
      let hasTopology = false;
      if (dataset.topologyPath) {
        const extTopology = path.extname(dataset.topologyPath).toLowerCase();
        const topParser = topologyParsers.find(p => p.canParse(extTopology));
        if (extTopology === '.parm7') {
          emitCheckpoint('CHK_AMBER_2_PARM7_PARSER_SELECTED', {
            topologyPath: dataset.topologyPath,
            topologyExt: extTopology,
            parserSelected: Boolean(topParser),
            parserName: topParser ? topParser.constructor.name : null,
            availableTopologyParsers: topologyParsers.map((parser) => parser.constructor.name),
          });
        }
        if (topParser) {
          logDebug('openMdViewer', `Selected topology parser: ${topParser.constructor.name}`);
          try {
            topology = await topParser.parse(dataset.topologyPath);
            hasTopology = topology.hasTopology;
            logDebug('openMdViewer', `Topology parsed successfully`, { hasTopology });
            emitBinaryCheckpoint(binaryFlowFormat, 'topologyParsed', {
              topologyPath: dataset.topologyPath,
              topologyExt: extTopology,
              parserName: topParser.constructor.name,
              trajectoryAtomCount: trajectory.atomCount,
              ...summarizeTopology(topology),
            });
            if (isGroBackedFlow) {
              emitCheckpoint('CHK_GRO_3_TOPOLOGY_PARSED', {
                topologyPath: dataset.topologyPath,
                topologyExt: extTopology,
                parserName: topParser.constructor.name,
                trajectoryAtomCount: trajectory.atomCount,
                ...summarizeTopology(topology),
              });
            }
            if (isAmberDatasetFlow) {
              emitCheckpoint('CHK_AMBER_5_TOPOLOGY_PARSED', {
                topologyPath: dataset.topologyPath,
                topologyExt: extTopology,
                parserName: topParser.constructor.name,
                trajectoryAtomCount: trajectory.atomCount,
                ...summarizeTopology(topology),
              });
              emitCheckpoint('CHK_AMBER_CHAIN_1_TOPOLOGY_CHAIN_COUNT', {
                topologyPath: dataset.topologyPath,
                topologyExt: extTopology,
                parserName: topParser.constructor.name,
                chainCount: Array.isArray(topology?.chains) ? topology.chains.length : 0,
                chainIdsSample: sampleArray(topology?.chains, 12),
                residueEntriesLength: arrayLengthOrNull(topology?.residueEntries),
                atomToChainLength: arrayLengthOrNull(topology?.atomToChain),
                atomToResidueLength: arrayLengthOrNull(topology?.atomToResidue),
                bondPairsLength: arrayLengthOrNull(topology?.bondPairs),
                chainInference: topology?.chainInference ?? null,
              });
            }
            // Add Validation Guard
            if (topology.hasTopology) {
              const topAtomCount = topology.atomToResidue.length;
              if (topAtomCount !== trajectory.atomCount) {
                const msg = `Topology atom count (${topAtomCount}) does not match trajectory atom count (${trajectory.atomCount}).`;
                logDebug('openMdViewer', `Validation Guard Failed: ${msg}`);
                void vscode.window.showErrorMessage(`MD Viewer Dataset Mismatch: ${msg}. Try modifying your pairing.`);
                return;
              }
            }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            emitBinaryCheckpoint(binaryFlowFormat, 'topologyParsed', {
              topologyPath: dataset.topologyPath,
              topologyExt: extTopology,
              parserName: topParser.constructor.name,
              parseOutcome: 'error',
              error: errorMsg,
            });
            if (isGroBackedFlow) {
              emitCheckpoint('CHK_GRO_3_TOPOLOGY_PARSED', {
                topologyPath: dataset.topologyPath,
                topologyExt: extTopology,
                parserName: topParser.constructor.name,
                parseOutcome: 'error',
                error: errorMsg,
              });
            }
            if (isAmberDatasetFlow) {
              emitCheckpoint('CHK_AMBER_5_TOPOLOGY_PARSED', {
                topologyPath: dataset.topologyPath,
                topologyExt: extTopology,
                parserName: topParser.constructor.name,
                parseOutcome: 'error',
                error: errorMsg,
              });
              emitCheckpoint('CHK_AMBER_CHAIN_1_TOPOLOGY_CHAIN_COUNT', {
                topologyPath: dataset.topologyPath,
                topologyExt: extTopology,
                parserName: topParser.constructor.name,
                parseOutcome: 'error',
                error: errorMsg,
              });
            }
            logDebug('openMdViewer', `Failed to parse topology`, { err });
            console.warn('Failed to parse sidecar topology:', err);
            void vscode.window.showWarningMessage('MD Viewer: Failed to parse topology, ignoring and continuing.');
          }
        } else {
          if (isGroBackedFlow) {
            emitCheckpoint('CHK_GRO_3_TOPOLOGY_PARSED', {
              topologyPath: dataset.topologyPath,
              topologyExt: extTopology,
              parserName: null,
              parseOutcome: 'noParserMatched',
            });
          }
          if (extTopology === '.parm7') {
            emitCheckpoint('CHK_AMBER_2_PARM7_PARSER_SELECTED', {
              topologyPath: dataset.topologyPath,
              topologyExt: extTopology,
              parserSelected: false,
              parserName: null,
              parseOutcome: 'noParserMatched',
              availableTopologyParsers: topologyParsers.map((parser) => parser.constructor.name),
            });
          }
          logDebug('openMdViewer', `No parser matched for topology extension: ${extTopology}`);
        }
      }

      // Add Validation Guard (Stage 5 Graceful Failures)
      if (hasTopology && topology && trajectory) {
          if (topology.atomToResidue.length !== trajectory.atomCount) {
              const errMsg = `Atom count severely mismatched: Topology (${topology.atomToResidue.length}) vs Trajectory (${trajectory.atomCount})`;
              console.error(`[Extension] ${errMsg}`);
              vscode.window.showErrorMessage(errMsg);
              return; // abort before attempting normalization/webview
          }
      }

      // ── Normalization Layer ──────────────────────────────────────────
      const normalizedDataset = DatasetNormalizer.normalize(
        fileName,
        dataset.trajectoryPath,
        trajectory,
        dataset.topologyPath,
        topology
      );
      emitBinaryCheckpoint(binaryFlowFormat, 'normalizationDone', {
        atomCount: normalizedDataset.structure.atomCount,
        frameCount: normalizedDataset.trajectory.frameCount,
        hasTopology: normalizedDataset.structure.hasTopology,
        residueCount: normalizedDataset.structure.residues.length,
        classificationSizes: {
          caIndices: normalizedDataset.classification.caIndices.length,
          ligandIndices: normalizedDataset.classification.ligandIndices.length,
          ionIndices: normalizedDataset.classification.ionIndices.length,
          solventIndices: normalizedDataset.classification.solventIndices.length,
          polymerIndices: normalizedDataset.classification.polymerIndices.length,
        },
      });
      if (isGroBackedFlow) {
        emitCheckpoint('CHK_GRO_4_NORMALIZATION_DONE', {
          atomCount: normalizedDataset.structure.atomCount,
          frameCount: normalizedDataset.trajectory.frameCount,
          hasTopology: normalizedDataset.structure.hasTopology,
          residueCount: normalizedDataset.structure.residues.length,
          classificationSizes: {
            caIndices: normalizedDataset.classification.caIndices.length,
            ligandIndices: normalizedDataset.classification.ligandIndices.length,
            ionIndices: normalizedDataset.classification.ionIndices.length,
            solventIndices: normalizedDataset.classification.solventIndices.length,
            polymerIndices: normalizedDataset.classification.polymerIndices.length,
          },
        });
      }
      if (isAmberDatasetFlow) {
        const normalizedChainIds = Array.from(new Set(
          normalizedDataset.structure.residues.map((residue) => residue.chainIdentifier || '')
        ));
        emitCheckpoint('CHK_AMBER_CHAIN_2_NORMALIZED_CHAIN_COUNT', {
          atomCount: normalizedDataset.structure.atomCount,
          frameCount: normalizedDataset.trajectory.frameCount,
          hasTopology: normalizedDataset.structure.hasTopology,
          residueCount: normalizedDataset.structure.residues.length,
          normalizedChainCount: normalizedChainIds.length,
          normalizedChainIdsSample: normalizedChainIds.slice(0, 12),
          classificationSizes: {
            caIndices: normalizedDataset.classification.caIndices.length,
            ligandIndices: normalizedDataset.classification.ligandIndices.length,
            ionIndices: normalizedDataset.classification.ionIndices.length,
            solventIndices: normalizedDataset.classification.solventIndices.length,
            polymerIndices: normalizedDataset.classification.polymerIndices.length,
          },
        });
      }

      console.log(`[Extension] Parsing finished: ${normalizedDataset.structure.atomCount} atoms, ${normalizedDataset.trajectory.frameCount} frames.`);

      // Read configuration
      console.log('[Extension] Reading configuration boundaries');
      const config = vscode.workspace.getConfiguration('mdViewer');
      const renderConfig = {
          renderMode: config.get<string>('renderMode', 'auto'),
          maxAtomsForBonds: config.get<number>('maxAtomsForBonds', 2000),
          maxFramesBeforeDecimation: config.get<number>('maxFramesBeforeDecimation', 1000),
          backgroundColor: config.get<string>('backgroundColor', 'black'),
          loadOptions: loadOptions ?? null,
      };

      const streamChunkSize = parseEnvInt('MD_VIEWER_STREAM_CHUNK_SIZE', 24);
      const binaryStreamingEnabled = isBinaryStreamingEnabled(binaryFlowFormat);
      const xtcStreamingEnabled = binaryFlowFormat === 'xtc' && binaryStreamingEnabled;
      const effectiveBehavior = computeEffectiveLoadBehavior(loadOptions, binaryStreamingEnabled);

      // ── Payload Builder ──────────────────────────────────────────
      const initPayload = await PayloadBuilder.buildInitPayload(normalizedDataset, renderConfig, {
        initialFrameOnly: effectiveBehavior.initialFrameOnly,
        enableFrameRequests: binaryStreamingEnabled,
        chunkSizeHint: streamChunkSize,
        frameStride: effectiveBehavior.frameStride,
        selectionPreset: loadOptions?.filtering.selectionPreset,
        solventHandling: loadOptions?.filtering.solventHandling,
        optionsSource: loadOptions?.source ?? 'default',
        emitOptionsCheckpoints: loadOptions?.source === 'with_options',
      });
      if (binaryStreamingEnabled) {
        const streamPayload = {
          trajectoryPath: dataset.trajectoryPath,
          topologyPath: dataset.topologyPath ?? null,
          format: binaryFlowFormat,
          accessMode: initPayload?.data?.trajectory?.accessMode ?? null,
          totalFrameCount: initPayload?.data?.trajectory?.frameCount ?? null,
          initialFrameCount: arrayLengthOrNull(initPayload?.data?.frames),
          initialFrameIndices: sampleArray(initPayload?.data?.trajectory?.initialFrameIndices, 8),
          atomCount: initPayload?.data?.atomCount ?? null,
          chunkSizeHint: initPayload?.data?.trajectory?.chunkSizeHint ?? null,
          initialFrameStride: initPayload?.data?.trajectory?.initialFrameStride ?? null,
          requestedInitFrameCount: initPayload?.stats?.initRequestedFrameCount ?? null,
          binaryStreamingEnabled,
        };
        emitStreamCheckpoint(binaryFlowFormat, 3, 'INITIAL_FRAME_READY', streamPayload);
      }
      const payloadSummary = summarizeInitPayload(initPayload);
      const filterClassVisibility = summarizeFilterClassVisibility(initPayload);
      const samplingFrameStride = Math.max(
        1,
        Number(initPayload?.data?.trajectory?.samplingFrameStride ?? initPayload?.data?.trajectory?.initialFrameStride ?? 1)
      );
      const sampledFrameCount = Math.max(
        1,
        Number(initPayload?.data?.trajectory?.sampledFrameCount ?? initPayload?.data?.trajectory?.frameCount ?? normalizedDataset.trajectory.frameCount)
      );
      const rawFrameCount = Math.max(
        sampledFrameCount,
        Number(initPayload?.data?.trajectory?.rawFrameCount ?? normalizedDataset.trajectory.frameCount)
      );
      emitCheckpoint('CHK_UX_1_STRIDE_APPLIED', {
        trajectoryPath: dataset.trajectoryPath,
        topologyPath: dataset.topologyPath ?? null,
        trajectoryExt,
        topologyExt: topologyExt || null,
        requestedFrameStride: effectiveBehavior.frameStride,
        samplingFrameStride,
        rawFrameCount,
        sampledFrameCount,
        initialFrameCount: arrayLengthOrNull(initPayload?.data?.frames),
        initialFrameIndicesSample: sampleArray(initPayload?.data?.trajectory?.initialFrameIndices, 12),
        initialFrameRawIndicesSample: sampleArray(initPayload?.data?.trajectory?.initialFrameRawIndices, 12),
      });
      emitCheckpoint('CHK_UX_2_EFFECTIVE_FRAME_COUNT', {
        trajectoryPath: dataset.trajectoryPath,
        trajectoryExt,
        rawFrameCount,
        sampledFrameCount,
        timelineFrameCount: Number(initPayload?.data?.trajectory?.frameCount ?? sampledFrameCount),
        supportsFrameRequests: Boolean(initPayload?.data?.trajectory?.supportsFrameRequests),
        initFrameCount: arrayLengthOrNull(initPayload?.data?.frames),
      });
      emitCheckpoint('CHK_UX_4_FILTER_MODEL_RESOLVED', {
        trajectoryPath: dataset.trajectoryPath,
        topologyPath: dataset.topologyPath ?? null,
        selectionPreset: initPayload?.data?.displayFilter?.selectionPreset ?? null,
        solventHandling: initPayload?.data?.displayFilter?.solventHandling ?? null,
        functionalModel: initPayload?.data?.displayFilter?.functionalModel ?? null,
        allowedClasses: initPayload?.data?.displayFilter?.allowedClasses ?? [],
        hiddenAtomCount: initPayload?.data?.displayFilter?.hiddenAtomCount ?? null,
        visibleAtomCount: initPayload?.data?.displayFilter?.visibleAtomCount ?? null,
        reason: initPayload?.data?.displayFilter?.reason ?? null,
      });
      emitCheckpoint('CHK_UX_5_VISIBLE_CLASS_COUNTS', {
        trajectoryPath: dataset.trajectoryPath,
        topologyPath: dataset.topologyPath ?? null,
        visibleClassCounts: filterClassVisibility.visibleClassCounts,
        hiddenClassCounts: filterClassVisibility.hiddenClassCounts,
      });
      emitCheckpoint('CHK_UX_6_SOLVENT_VISIBILITY_RESULT', {
        trajectoryPath: dataset.trajectoryPath,
        topologyPath: dataset.topologyPath ?? null,
        selectionPreset: initPayload?.data?.displayFilter?.selectionPreset ?? null,
        solventHandling: initPayload?.data?.displayFilter?.solventHandling ?? null,
        solventVisibleAtomCount: filterClassVisibility.visibleClassCounts.solvent,
        solventHiddenAtomCount: filterClassVisibility.hiddenClassCounts.solvent,
        solventVisible: filterClassVisibility.visibleClassCounts.solvent > 0,
      });
      const residueNameCounts = (initPayload?.data?.topology?.residueNameCounts && typeof initPayload.data.topology.residueNameCounts === 'object')
        ? initPayload.data.topology.residueNameCounts as Record<string, number>
        : {};
      const sortedResidueRepeatCounts = Object.entries(residueNameCounts)
        .map(([name, count]) => ({ name, count: Number(count) || 0 }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      const commonSolventResidueNames = Array.isArray(initPayload?.data?.topology?.commonSolventResidueNames)
        ? initPayload.data.topology.commonSolventResidueNames
        : [];
      emitCheckpoint('CHK_SOLV_5_RESIDUE_REPEAT_COUNTS', {
        trajectoryPath: dataset.trajectoryPath,
        topologyPath: dataset.topologyPath ?? null,
        residueNameCountKeys: sortedResidueRepeatCounts.length,
        topResidueRepeatCounts: sortedResidueRepeatCounts.slice(0, 20),
      });
      emitCheckpoint('CHK_SOLV_6_COMMON_SOLVENT_CLASSES', {
        trajectoryPath: dataset.trajectoryPath,
        topologyPath: dataset.topologyPath ?? null,
        commonSolventThreshold: initPayload?.data?.topology?.commonSolventThreshold ?? null,
        commonSolventResidueNames,
        commonSolventCount: commonSolventResidueNames.length,
      });
      emitBinaryCheckpoint(binaryFlowFormat, 'payloadBuilt', payloadSummary);
      if (isGroBackedFlow) {
        emitCheckpoint('CHK_GRO_5_PAYLOAD_BUILT', {
          data_frames_length: payloadSummary.data_frames_length,
          data_atoms_length: payloadSummary.data_atoms_length,
          topologyPresent: payloadSummary.topologyPresent,
        });
        emitCheckpoint('CHK_GRO_6_PAYLOAD_TOPOLOGY_KEYS', payloadSummary);
      }
      if (isAmberDatasetFlow) {
        emitCheckpoint('CHK_AMBER_CHAIN_3_PAYLOAD_CHAIN_COUNT', {
          trajectoryPath: dataset.trajectoryPath,
          topologyPath: dataset.topologyPath ?? null,
          trajectoryExt,
          topologyExt: topologyExt || null,
          payloadChainCount: payloadSummary.topology_chains_length ?? 0,
          payloadChainIdsSample: sampleArray(initPayload?.data?.topology?.chains, 12),
          payloadAtomToChainLength: payloadSummary.topology_atomToChain_length ?? null,
          payloadResidueEntriesLength: payloadSummary.topology_residueEntries_length ?? null,
          payloadAtomToResidueLength: payloadSummary.topology_atomToResidue_length ?? null,
          payloadCaLinePairsLength: payloadSummary.topology_backbonePairs_length ?? null,
        });
      }
      if (referenceModeEnabled) {
        emitCheckpoint('CHK_REF_PAYLOAD_CAPTURE', buildReferencePayloadCapture(initPayload, {
          caseId: referenceCaseId,
          datasetName: fileName,
          trajectoryPath: dataset.trajectoryPath,
          trajectoryExt,
          topologyPath: dataset.topologyPath ?? null,
          topologyExt: topologyExt || null,
        }));
      }

      // Create the webview panel
      console.log('[Extension] Creating Webview Panel');
      const panel = vscode.window.createWebviewPanel(
        'mdViewer',
        `MD Viewer: ${fileName}`,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
        }
      );

      panel.webview.html = getWebviewHtml(panel, fileName, context.extensionUri);

      const runtimeDebug = {
        isXtcFlow,
        binaryTrajectoryFormat: binaryFlowFormat ?? null,
        isAmberFlow: isAmberDatasetFlow,
        streaming: {
          binaryStreamingEnabled,
          xtcStreamingEnabled,
          chunkSize: streamChunkSize,
          accessMode: initPayload?.data?.trajectory?.accessMode ?? null,
          frameCount: initPayload?.data?.trajectory?.frameCount ?? null,
          supportsFrameRequests: initPayload?.data?.trajectory?.supportsFrameRequests ?? null,
        },
        isGroBackedFlow,
        clickedPath: targetUri.fsPath,
        trajectoryPath: dataset.trajectoryPath,
        topologyPath: dataset.topologyPath ?? null,
        trajectoryExt,
        topologyExt: topologyExt || null,
        amber: {
          trajectoryExt,
          topologyExt: topologyExt || null,
          trajectoryProviderMetadata,
        },
        referenceHarness: {
          enabled: referenceModeEnabled,
          caseId: referenceCaseId,
          captureInteractions: process.env.MD_VIEWER_REFERENCE_CAPTURE_INTERACTIONS !== '0',
          initCaptureDelayMs: parseEnvInt('MD_VIEWER_REFERENCE_INIT_CAPTURE_DELAY_MS', 250),
          interactionStepDelayMs: parseEnvInt('MD_VIEWER_REFERENCE_INTERACTION_STEP_DELAY_MS', 300),
          cameraSettleTimeoutMs: parseEnvInt('MD_VIEWER_REFERENCE_CAMERA_SETTLE_TIMEOUT_MS', 2600),
        },
        uxProbeAutodrive: process.env.MD_VIEWER_UX_AUTODRIVE === '1',
        uxProbeDeselectCycles: parseEnvInt('MD_VIEWER_UX_DESELECT_CYCLES', 2),
        uxProbeResidueName: process.env.MD_VIEWER_UX_PROBE_RESIDUE_NAME || '',
        dcdNcParityProbe: process.env.MD_VIEWER_DCD_NC_PARITY_PROBE === '1',
        loadOptions: loadOptions ? {
          source: loadOptions.source,
          resolution: loadOptions.resolution,
          behavior: loadOptions.behavior,
          filtering: loadOptions.filtering,
          effectiveBehavior,
        } : null,
      };

      // Listen for webview becoming ready
      panel.webview.onDidReceiveMessage((message) => {
        console.log('[Extension] Received IPC message from webview:', message);
        if (message?.type === 'checkpoint' && typeof message.checkpoint === 'string') {
          emitCheckpoint(message.checkpoint, {
            source: 'webview',
            ...message.payload,
          });
          return;
        }
        if (message?.type === 'trajectoryFrameChunkRequest') {
          const requestId = typeof message.requestId === 'string' ? message.requestId : `req-${Date.now()}`;
          const requestedVirtualStart = Number.isFinite(Number(message.start)) ? Number(message.start) : 0;
          const requestedVirtualCount = Number.isFinite(Number(message.count)) ? Number(message.count) : 1;
          const requestedVirtualStride = Number.isFinite(Number(message.stride)) ? Number(message.stride) : 1;
          const rawStart = Math.max(0, Math.floor(requestedVirtualStart)) * samplingFrameStride;
          const rawCount = Math.max(1, Math.floor(requestedVirtualCount));
          const rawStride = Math.max(1, Math.floor(requestedVirtualStride)) * samplingFrameStride;

          const chunkRequestPayload = {
            requestId,
            format: binaryFlowFormat ?? null,
            requestedVirtualStart,
            requestedVirtualCount,
            requestedVirtualStride,
            rawStart,
            rawCount,
            rawStride,
            samplingFrameStride,
            sampledFrameCount,
            rawFrameCount,
            binaryStreamingEnabled,
            xtcStreamingEnabled,
            trajectoryPath: dataset.trajectoryPath,
            topologyPath: dataset.topologyPath ?? null,
          };
          emitCheckpoint('CHK_UX_3_CHUNK_REQUEST_STRIDED', chunkRequestPayload);
          emitStreamCheckpoint(binaryFlowFormat, 5, 'FRAME_CHUNK_REQUEST', chunkRequestPayload);

          void normalizedDataset.trajectory.provider
            .getFrameChunk(rawStart, rawCount, rawStride)
            .then((chunk) => {
              const virtualFrameIndices = chunk.frameIndices.map((rawIndex) => Math.floor(rawIndex / samplingFrameStride));
              const frameResponse = {
                type: 'trajectoryFrameChunkResponse',
                requestId,
                start: Math.floor(chunk.start / samplingFrameStride),
                count: virtualFrameIndices.length,
                stride: Math.max(1, Math.floor(requestedVirtualStride)),
                frameIndices: virtualFrameIndices,
                rawFrameIndices: chunk.frameIndices,
                frames: chunk.frames,
                fromCache: chunk.fromCache,
              };
              void panel.webview.postMessage(frameResponse);
              emitStreamCheckpoint(binaryFlowFormat, 6, 'FRAME_CHUNK_RETURNED', {
                requestId,
                format: binaryFlowFormat ?? null,
                requestedVirtualStart,
                requestedVirtualCount,
                requestedVirtualStride,
                rawStart: chunk.start,
                rawCount: chunk.count,
                rawStride: chunk.stride,
                returnedVirtualFrameCount: virtualFrameIndices.length,
                returnedFrameCount: chunk.frames.length,
                returnedVirtualFrameIndicesSample: sampleArray(virtualFrameIndices, 10),
                returnedRawFrameIndicesSample: sampleArray(chunk.frameIndices, 10),
                cacheHit: chunk.fromCache,
              });
            })
            .catch((err: unknown) => {
              const errorMsg = err instanceof Error ? err.message : String(err);
              void panel.webview.postMessage({
                type: 'trajectoryFrameChunkError',
                requestId,
                error: errorMsg,
              });
              emitStreamCheckpoint(binaryFlowFormat, 6, 'FRAME_CHUNK_RETURNED', {
                requestId,
                format: binaryFlowFormat ?? null,
                requestedVirtualStart,
                requestedVirtualCount,
                requestedVirtualStride,
                rawStart,
                rawCount,
                rawStride,
                returnedFrameCount: 0,
                cacheHit: false,
                error: errorMsg,
              });
            });
          return;
        }
        if (message.command === 'ready' || message.type === 'ready') {
          console.log('[Extension] Received Ready state! Bootstrapping payload to Webview...');
          const payloadWithRuntime = {
            ...initPayload,
            runtimeDebug,
          };
          if (binaryStreamingEnabled) {
            emitStreamCheckpoint(binaryFlowFormat, 4, 'INIT_PAYLOAD_SENT', {
              format: binaryFlowFormat ?? null,
              trajectoryPath: dataset.trajectoryPath,
              topologyPath: dataset.topologyPath ?? null,
              totalFrameCount: initPayload?.data?.trajectory?.frameCount ?? null,
              initialFrameCount: arrayLengthOrNull(initPayload?.data?.frames),
              initFrameIndices: sampleArray(initPayload?.data?.trajectory?.initialFrameIndices, 8),
              accessMode: initPayload?.data?.trajectory?.accessMode ?? null,
              supportsFrameRequests: initPayload?.data?.trajectory?.supportsFrameRequests ?? null,
              stats_initPayloadEstimatedFloatCount: initPayload?.stats?.initPayloadEstimatedFloatCount ?? null,
              stats_fullTrajectoryEstimatedFloatCount: initPayload?.stats?.fullTrajectoryEstimatedFloatCount ?? null,
              initPayloadJsonBytes: safeJsonByteLength(payloadWithRuntime),
              binaryStreamingEnabled,
            });
          }
          if (loadOptions?.source === 'with_options') {
            emitCheckpoint('CHK_OPT_6_PAYLOAD_WITH_OPTIONS_SENT', {
              clickedPath: targetUri.fsPath,
              trajectoryPath: dataset.trajectoryPath,
              topologyPath: dataset.topologyPath ?? null,
              loadOptions,
              effectiveBehavior,
              payloadSummary,
              initPayloadFrameCount: arrayLengthOrNull(initPayload?.data?.frames),
              trajectoryFrameCount: initPayload?.data?.trajectory?.frameCount ?? null,
              trajectoryInitialFrameStride: initPayload?.data?.trajectory?.initialFrameStride ?? null,
              hiddenAtomCount: initPayload?.data?.displayFilter?.hiddenAtomCount ?? null,
              visibleAtomCount: initPayload?.data?.displayFilter?.visibleAtomCount ?? null,
              initPayloadJsonBytes: safeJsonByteLength(payloadWithRuntime),
            });
          }
          if (loadOptions?.source === 'setup_panel') {
            emitCheckpoint('CHK_SETUP_8_PAYLOAD_SENT', {
              clickedPath: targetUri.fsPath,
              trajectoryPath: dataset.trajectoryPath,
              topologyPath: dataset.topologyPath ?? null,
              loadOptions,
              effectiveBehavior,
              payloadSummary,
              initPayloadFrameCount: arrayLengthOrNull(initPayload?.data?.frames),
              trajectoryFrameCount: initPayload?.data?.trajectory?.frameCount ?? null,
              trajectoryInitialFrameStride: initPayload?.data?.trajectory?.initialFrameStride ?? null,
              hiddenAtomCount: initPayload?.data?.displayFilter?.hiddenAtomCount ?? null,
              visibleAtomCount: initPayload?.data?.displayFilter?.visibleAtomCount ?? null,
              initPayloadJsonBytes: safeJsonByteLength(payloadWithRuntime),
            });
          }
          if (isAmberDatasetFlow) {
            emitCheckpoint('CHK_AMBER_7_PAYLOAD_SENT', {
              clickedPath: targetUri.fsPath,
              trajectoryPath: dataset.trajectoryPath,
              trajectoryExt,
              topologyPath: dataset.topologyPath ?? null,
              topologyExt: topologyExt || null,
              payloadSummary,
              initPayloadFrameCount: arrayLengthOrNull(initPayload?.data?.frames),
              trajectoryFrameCount: initPayload?.data?.trajectory?.frameCount ?? null,
              trajectorySupportsFrameRequests: initPayload?.data?.trajectory?.supportsFrameRequests ?? null,
              trajectoryInitialFrameStride: initPayload?.data?.trajectory?.initialFrameStride ?? null,
              stats_initPayloadEstimatedFloatCount: initPayload?.stats?.initPayloadEstimatedFloatCount ?? null,
              stats_fullTrajectoryEstimatedFloatCount: initPayload?.stats?.fullTrajectoryEstimatedFloatCount ?? null,
              initPayloadJsonBytes: safeJsonByteLength(payloadWithRuntime),
            });
          }
          const posted = panel.webview.postMessage({
            type: 'init',
            payload: payloadWithRuntime,
          });
          void posted
            .then((accepted) => {
              console.log('[Extension] postMessage resolved:', accepted);
              emitBinaryCheckpoint(binaryFlowFormat, 'webviewPostmessage', {
                postMessageAccepted: accepted,
                messageType: 'init',
                runtimeDebug,
              });
            }, (err: unknown) => {
              const errorMsg = err instanceof Error ? err.message : String(err);
              console.error('[Extension] postMessage rejected:', errorMsg);
              emitBinaryCheckpoint(binaryFlowFormat, 'webviewPostmessage', {
                postMessageAccepted: false,
                postMessageError: errorMsg,
                messageType: 'init',
                runtimeDebug,
              });
            });
        }
      });

      vscode.window.setStatusBarMessage(
        `MD Viewer: ${trajectory.frameCount} frames, ${trajectory.atomCount} atoms`,
        5000
      );
    }
  );
}
