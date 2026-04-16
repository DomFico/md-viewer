import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

export type InterpreterCandidateSource = 'setting' | 'cached' | 'venv' | 'env' | 'default';

export type InterpreterCandidate = {
  executable: string;
  source: InterpreterCandidateSource;
  detail: string;
};

export type RejectedInterpreterCandidate = {
  executable: string;
  source: InterpreterCandidateSource;
  detail: string;
  reason: string;
};

export type InterpreterCandidateBuildResult = {
  candidates: InterpreterCandidate[];
  rejected: RejectedInterpreterCandidate[];
};

export type PythonImportStatus = {
  ok: boolean;
  error?: string;
};

export type PythonImportDiagnosticsResult = {
  pythonVersion: string | null;
  pythonImports: Record<string, PythonImportStatus>;
  diagnosticsError?: string;
};

const DEFAULT_IMPORT_CHECKS = ['mdtraj', 'numpy', 'scipy', 'netCDF4'];

const COMMON_VENV_RELATIVE_PYTHONS = [
  '.venv/bin/python',
  'venv/bin/python',
];

const COMMON_USER_VENV_PYTHONS = [
  '~/.venvs/mdviewer/bin/python',
  '~/.local/venvs/mdviewer/bin/python',
  '~/miniconda3/envs/mdviewer/bin/python',
  '~/mambaforge/envs/mdviewer/bin/python',
  '~/micromamba/envs/mdviewer/bin/python',
  '~/.conda/envs/mdviewer/bin/python',
];

export function preferredPythonExecutable(): string {
  const activeHostKey = (process.env.MD_VIEWER_ACTIVE_HOST_KEY || '').trim() || null;
  const currentHomeDir = (process.env.MD_VIEWER_ACTIVE_HOME_DIR || '').trim() || null;
  const selectedInterpreter = preferredSelectedInterpreter(activeHostKey, currentHomeDir);
  const lastGoodInterpreter = preferredLastKnownInterpreter(activeHostKey, currentHomeDir);
  const candidates = [
    selectedInterpreter,
    lastGoodInterpreter,
    ...defaultVenvPythonCandidates(),
    process.env.PYTHON,
    process.env.PYTHON3,
    'python',
    'python3',
  ];

  for (const candidate of candidates) {
    const normalized = (candidate || '').trim();
    if (!normalized) continue;
    if (path.isAbsolute(normalized) && !fs.existsSync(normalized)) continue;
    return normalized;
  }

  return 'python';
}

export function buildInterpreterCandidates(input: {
  configuredInterpreter?: string | null;
  lastKnownGoodInterpreter?: string | null;
  currentHostKey?: string | null;
  currentHomeDir?: string | null;
  lastKnownGoodInterpreterHostKey?: string | null;
  workspaceRoots?: string[];
  includeDefaultCommands?: boolean;
}): InterpreterCandidate[] {
  return buildInterpreterCandidateSet(input).candidates;
}

export function buildInterpreterCandidateSet(input: {
  configuredInterpreter?: string | null;
  lastKnownGoodInterpreter?: string | null;
  currentHostKey?: string | null;
  currentHomeDir?: string | null;
  lastKnownGoodInterpreterHostKey?: string | null;
  workspaceRoots?: string[];
  includeDefaultCommands?: boolean;
}): InterpreterCandidateBuildResult {
  const includeDefaultCommands = input.includeDefaultCommands !== false;
  const workspaceRoots = (input.workspaceRoots || []).filter((value) => value.trim().length > 0);
  const out: InterpreterCandidate[] = [];
  const rejected: RejectedInterpreterCandidate[] = [];
  const seen = new Set<string>();

  const addCandidate = (
    executable: string | null | undefined,
    source: InterpreterCandidateSource,
    detail: string
  ) => {
    const normalized = (executable || '').trim();
    if (!normalized) return;
    if (seen.has(normalized)) return;
    if (source === 'cached') {
      const hostKeyRejection = staleHostKeyReason({
        candidateHostKey: input.lastKnownGoodInterpreterHostKey || null,
        currentHostKey: input.currentHostKey || null,
      });
      if (hostKeyRejection) {
        rejected.push({ executable: normalized, source, detail, reason: hostKeyRejection });
        return;
      }
    }
    const homeMismatchReason = differentHomePathReason(normalized, input.currentHomeDir || null);
    if (homeMismatchReason && source === 'cached') {
      rejected.push({ executable: normalized, source, detail, reason: homeMismatchReason });
      return;
    }
    if (path.isAbsolute(normalized) && !fs.existsSync(normalized)) {
      rejected.push({ executable: normalized, source, detail, reason: 'Absolute interpreter path does not exist on this host.' });
      return;
    }
    seen.add(normalized);
    out.push({ executable: normalized, source, detail });
  };

  addCandidate(input.configuredInterpreter, 'setting', 'Configured mdViewer.pythonInterpreter');
  addCandidate(input.lastKnownGoodInterpreter, 'cached', 'Last-known-good interpreter for this host/workspace');

  for (const workspaceRoot of workspaceRoots) {
    for (const relativePython of COMMON_VENV_RELATIVE_PYTHONS) {
      addCandidate(path.join(workspaceRoot, relativePython), 'venv', `Workspace virtual environment (${relativePython})`);
    }
  }
  for (const userPython of defaultVenvPythonCandidates()) {
    addCandidate(userPython, 'venv', 'Common user virtual environment');
  }

  addCandidate(process.env.MD_VIEWER_PYTHON, 'env', 'MD_VIEWER_PYTHON');
  addCandidate(process.env.PYTHON, 'env', 'PYTHON');
  addCandidate(process.env.PYTHON3, 'env', 'PYTHON3');

  if (includeDefaultCommands) {
    addCandidate('python', 'default', 'Default python executable');
    addCandidate('python3', 'default', 'Default python3 executable');
  }

  return {
    candidates: out,
    rejected,
  };
}

export function runPythonImportDiagnostics(
  pythonExecutable: string,
  modules = DEFAULT_IMPORT_CHECKS
): PythonImportDiagnosticsResult {
  const moduleListLiteral = JSON.stringify(modules);
  const snippet = `
import importlib, json, sys
mods = ${moduleListLiteral}
status = {}
for name in mods:
    try:
        importlib.import_module(name)
        status[name] = {"ok": True}
    except Exception as exc:
        status[name] = {"ok": False, "error": str(exc)}
print(json.dumps({
    "pythonVersion": sys.version.split()[0],
    "imports": status
}))
`.trim();

  const result = spawnSync(pythonExecutable, ['-c', snippet], {
    encoding: 'utf8',
    timeout: 15000,
  });

  if (result.error) {
    return {
      pythonVersion: null,
      pythonImports: {},
      diagnosticsError: result.error.message,
    };
  }

  if (result.status !== 0) {
    return {
      pythonVersion: null,
      pythonImports: {},
      diagnosticsError: (result.stderr || result.stdout || `python exited with code ${result.status}`).trim(),
    };
  }

  try {
    const parsed = parseJsonFromMixedStdout(result.stdout || '');
    return {
      pythonVersion: typeof parsed?.pythonVersion === 'string' ? parsed.pythonVersion : null,
      pythonImports: parsed?.imports && typeof parsed.imports === 'object'
        ? parsed.imports
        : {},
    };
  } catch (err) {
    return {
      pythonVersion: null,
      pythonImports: {},
      diagnosticsError: err instanceof Error ? err.message : String(err),
    };
  }
}

export function coreRuntimeReady(imports: Record<string, PythonImportStatus>): boolean {
  return ['mdtraj', 'numpy', 'scipy'].every((name) => imports?.[name]?.ok === true);
}

export function amberTopologyReady(imports: Record<string, PythonImportStatus>): boolean {
  return imports?.mdtraj?.ok === true;
}

export function netcdfImportReady(imports: Record<string, PythonImportStatus>): boolean {
  return imports?.netCDF4?.ok === true;
}

export function workspaceRootsFromFolders(folders: readonly { uri: { fsPath: string } }[] | undefined): string[] {
  if (!folders || folders.length === 0) return [];
  return folders
    .map((folder) => folder.uri.fsPath)
    .filter((value) => value && value.trim().length > 0);
}

export function interpreterPriorityScore(source: InterpreterCandidateSource): number {
  switch (source) {
    case 'setting':
      return 500;
    case 'cached':
      return 400;
    case 'venv':
      return 300;
    case 'env':
      return 200;
    case 'default':
      return 100;
    default:
      return 0;
  }
}

export function selectBestInterpreterCandidate<T extends {
  candidate: InterpreterCandidate;
  coreReady: boolean;
  resolvedPythonPath?: string | null;
  diagnosticsError?: string;
}>(
  evaluations: T[]
): T | null {
  if (evaluations.length === 0) return null;

  const configured = evaluations.find((evaluation) => (
    evaluation.candidate.source === 'setting' && interpreterCandidateUsable(evaluation)
  ));
  if (configured) {
    return configured;
  }

  const sorted = [...evaluations].sort((a, b) => {
    const aScore = (a.coreReady ? 10000 : 0) + interpreterPriorityScore(a.candidate.source);
    const bScore = (b.coreReady ? 10000 : 0) + interpreterPriorityScore(b.candidate.source);
    if (aScore !== bScore) return bScore - aScore;

    const aResolved = resolveExecutablePath(a.candidate.executable);
    const bResolved = resolveExecutablePath(b.candidate.executable);
    if (aResolved && !bResolved) return -1;
    if (!aResolved && bResolved) return 1;
    return 0;
  });

  return sorted[0] || null;
}

export function interpreterSelectionReason(input: {
  chosenSource: InterpreterCandidateSource;
  chosenExecutable: string;
  chosenCoreReady: boolean;
  fallbackReason?: string;
}): string {
  if (input.chosenSource === 'setting' && !input.chosenCoreReady) {
    return `Using configured interpreter (${input.chosenExecutable}) because it was explicitly selected; diagnostics are reporting failures against that interpreter instead of masking them with cached fallback state.`;
  }
  if (input.chosenCoreReady) {
    switch (input.chosenSource) {
      case 'setting':
        return `Using configured interpreter (${input.chosenExecutable}) because core runtime checks passed.`;
      case 'cached':
        return `Using last-known-good interpreter (${input.chosenExecutable}) for this host/workspace.`;
      case 'venv':
        return `Using discovered virtual environment interpreter (${input.chosenExecutable}) with passing core checks.`;
      case 'env':
        return `Using environment-provided interpreter (${input.chosenExecutable}) with passing core checks.`;
      case 'default':
        return `Using default interpreter (${input.chosenExecutable}) with passing core checks.`;
      default:
        return `Using interpreter (${input.chosenExecutable}) with passing core checks.`;
    }
  }
  return input.fallbackReason || `Selected interpreter (${input.chosenExecutable}) as best available fallback; core checks are currently blocked.`;
}

export function resolveExecutablePath(executable: string): string | null {
  if (!executable) return null;
  if (path.isAbsolute(executable)) {
    return fs.existsSync(executable) ? executable : null;
  }

  const pathEnv = process.env.PATH ?? '';
  const pathSegments = pathEnv.split(path.delimiter).filter((segment) => segment.length > 0);
  for (const segment of pathSegments) {
    const candidate = path.join(segment, executable);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function parseJsonFromMixedStdout(stdout: string): any {
  const firstBrace = stdout.indexOf('{');
  const lastBrace = stdout.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('No JSON object found in python diagnostics output.');
  }
  return JSON.parse(stdout.slice(firstBrace, lastBrace + 1));
}

export function staleHostKeyReason(input: {
  candidateHostKey?: string | null;
  currentHostKey?: string | null;
}): string | null {
  const candidateHostKey = (input.candidateHostKey || '').trim();
  const currentHostKey = (input.currentHostKey || '').trim();
  if (!candidateHostKey) return null;
  if (!currentHostKey) return null;
  if (candidateHostKey === currentHostKey) return null;
  return `Cached interpreter belongs to a different host/workspace context (${candidateHostKey}) than the active context (${currentHostKey}).`;
}

export function differentHomePathReason(executable: string, currentHomeDir: string | null): string | null {
  const normalized = executable.trim();
  const homeDir = (currentHomeDir || '').trim();
  if (!normalized || !path.isAbsolute(normalized) || !homeDir) {
    return null;
  }

  const resolvedExecutable = path.resolve(normalized);
  const resolvedHome = path.resolve(homeDir);
  const parentHome = path.dirname(resolvedHome);
  if (parentHome === resolvedHome) {
    return null;
  }

  if (!resolvedExecutable.startsWith(parentHome + path.sep)) {
    return null;
  }
  if (resolvedExecutable === resolvedHome || resolvedExecutable.startsWith(resolvedHome + path.sep)) {
    return null;
  }
  return `Absolute interpreter path (${resolvedExecutable}) belongs to a different home prefix than the active host home (${resolvedHome}).`;
}

function interpreterCandidateUsable<T extends {
  resolvedPythonPath?: string | null;
  diagnosticsError?: string;
}>(evaluation: T): boolean {
  if (evaluation.resolvedPythonPath) {
    return true;
  }
  const errorText = (evaluation.diagnosticsError || '').trim().toLowerCase();
  if (!errorText) {
    return true;
  }
  return !(
    errorText.includes('enoent')
    || errorText.includes('not found')
    || errorText.includes('no such file')
    || errorText.includes('cannot find')
  );
}

function defaultVenvPythonCandidates(): string[] {
  const home = os.homedir();
  return COMMON_USER_VENV_PYTHONS
    .map((candidate) => expandHome(candidate, home))
    .filter((candidate) => fs.existsSync(candidate));
}

function preferredSelectedInterpreter(activeHostKey: string | null, currentHomeDir: string | null): string | null {
  const executable = (process.env.MD_VIEWER_PYTHON || '').trim() || null;
  if (!executable) return null;
  const source = (process.env.MD_VIEWER_PYTHON_SOURCE || '').trim();
  const candidateHostKey = (process.env.MD_VIEWER_PYTHON_HOST_KEY || '').trim() || null;

  if (source === 'cached') {
    if (staleHostKeyReason({ candidateHostKey, currentHostKey: activeHostKey })) {
      return null;
    }
    if (differentHomePathReason(executable, currentHomeDir)) {
      return null;
    }
  }

  return executable;
}

function preferredLastKnownInterpreter(activeHostKey: string | null, currentHomeDir: string | null): string | null {
  const executable = (process.env.MD_VIEWER_LAST_GOOD_PYTHON || '').trim() || null;
  if (!executable) return null;
  const candidateHostKey = (process.env.MD_VIEWER_LAST_GOOD_PYTHON_HOST_KEY || '').trim() || null;
  if (staleHostKeyReason({ candidateHostKey, currentHostKey: activeHostKey })) {
    return null;
  }
  if (differentHomePathReason(executable, currentHomeDir)) {
    return null;
  }
  return executable;
}

function expandHome(value: string, home: string): string {
  if (value.startsWith('~/')) {
    return path.join(home, value.slice(2));
  }
  if (value === '~') {
    return home;
  }
  return value;
}
