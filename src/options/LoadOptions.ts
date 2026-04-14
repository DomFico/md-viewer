import * as path from 'path';

export type DatasetLoadMode = 'fast_preview' | 'standard' | 'fuller_initial';
export type SelectionPreset =
  | 'protein_only'
  | 'protein_ligand'
  | 'protein_ligand_ions'
  | 'everything';
export type SolventHandling = 'hide_common_solvent' | 'keep_all';

export interface DatasetResolutionOptions {
  trajectoryPathOverride?: string;
  topologyPathOverride?: string | null;
}

export interface DatasetLoadBehaviorOptions {
  loadMode: DatasetLoadMode;
  initialFrameOnly?: boolean;
  frameStride: number;
}

export interface DatasetFilteringOptions {
  selectionPreset: SelectionPreset;
  solventHandling: SolventHandling;
}

export interface MdDatasetLoadOptions {
  source: 'default' | 'with_options' | 'setup_panel';
  resolution: DatasetResolutionOptions;
  behavior: DatasetLoadBehaviorOptions;
  filtering: DatasetFilteringOptions;
}

export interface EffectiveLoadBehavior {
  initialFrameOnly: boolean;
  frameStride: number;
}

const MODE_DEFAULTS: Record<DatasetLoadMode, { initialFrameOnly?: boolean; frameStride: number }> = {
  fast_preview: {
    initialFrameOnly: true,
    frameStride: 4,
  },
  standard: {
    frameStride: 1,
  },
  fuller_initial: {
    initialFrameOnly: false,
    frameStride: 1,
  },
};

export function createDefaultLoadOptions(source: MdDatasetLoadOptions['source'] = 'default'): MdDatasetLoadOptions {
  return {
    source,
    resolution: {},
    behavior: {
      loadMode: 'standard',
      frameStride: MODE_DEFAULTS.standard.frameStride,
      initialFrameOnly: MODE_DEFAULTS.standard.initialFrameOnly,
    },
    filtering: {
      selectionPreset: 'everything',
      solventHandling: 'keep_all',
    },
  };
}

export function withLoadModeDefaults(
  loadMode: DatasetLoadMode,
  overrides: Partial<DatasetLoadBehaviorOptions> = {}
): DatasetLoadBehaviorOptions {
  const defaults = MODE_DEFAULTS[loadMode];
  return {
    loadMode,
    initialFrameOnly: overrides.initialFrameOnly ?? defaults.initialFrameOnly,
    frameStride: sanitizePositiveInt(overrides.frameStride, defaults.frameStride),
  };
}

export function computeEffectiveLoadBehavior(
  options: MdDatasetLoadOptions | undefined,
  fallbackInitialFrameOnly: boolean
): EffectiveLoadBehavior {
  const behavior = options?.behavior;
  return {
    initialFrameOnly: behavior?.initialFrameOnly ?? fallbackInitialFrameOnly,
    frameStride: sanitizePositiveInt(behavior?.frameStride, 1),
  };
}

export function normalizeOptionsFromInput(
  input: unknown,
  defaultSource: MdDatasetLoadOptions['source'] = 'with_options'
): MdDatasetLoadOptions {
  const fallback = createDefaultLoadOptions(defaultSource);
  if (!input || typeof input !== 'object') {
    return fallback;
  }

  const obj = input as Record<string, unknown>;
  const behaviorRaw = (obj.behavior && typeof obj.behavior === 'object') ? (obj.behavior as Record<string, unknown>) : {};
  const filteringRaw = (obj.filtering && typeof obj.filtering === 'object') ? (obj.filtering as Record<string, unknown>) : {};
  const resolutionRaw = (obj.resolution && typeof obj.resolution === 'object') ? (obj.resolution as Record<string, unknown>) : {};

  const loadMode = parseLoadMode(behaviorRaw.loadMode) ?? fallback.behavior.loadMode;
  const behavior = withLoadModeDefaults(loadMode, {
    initialFrameOnly: parseOptionalBoolean(behaviorRaw.initialFrameOnly),
    frameStride: parseOptionalNumber(behaviorRaw.frameStride),
  });

  const selectionPreset = parseSelectionPreset(filteringRaw.selectionPreset) ?? fallback.filtering.selectionPreset;
  const solventHandling = parseSolventHandling(filteringRaw.solventHandling) ?? fallback.filtering.solventHandling;

  const trajectoryPathOverride = parsePathOverride(resolutionRaw.trajectoryPathOverride);
  const topologyPathOverride = parseOptionalNullPathOverride(resolutionRaw.topologyPathOverride);

  return {
    source: obj.source === 'default' ? 'default' : (
      obj.source === 'setup_panel' ? 'setup_panel' : defaultSource
    ),
    resolution: {
      trajectoryPathOverride,
      topologyPathOverride,
    },
    behavior,
    filtering: {
      selectionPreset,
      solventHandling,
    },
  };
}

function parseLoadMode(value: unknown): DatasetLoadMode | undefined {
  if (value === 'fast_preview' || value === 'standard' || value === 'fuller_initial') {
    return value;
  }
  return undefined;
}

function parseSelectionPreset(value: unknown): SelectionPreset | undefined {
  if (
    value === 'protein_only' ||
    value === 'protein_ligand' ||
    value === 'protein_ligand_ions' ||
    value === 'everything'
  ) {
    return value;
  }
  return undefined;
}

function parseSolventHandling(value: unknown): SolventHandling | undefined {
  if (value === 'hide_common_solvent' || value === 'keep_all') {
    return value;
  }
  return undefined;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function parsePathOverride(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return path.resolve(trimmed);
}

function parseOptionalNullPathOverride(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return parsePathOverride(value);
}

function sanitizePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : fallback;
}
