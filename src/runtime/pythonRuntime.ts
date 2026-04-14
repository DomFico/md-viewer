import * as fs from 'fs';
import * as path from 'path';

export function preferredPythonExecutable(): string {
  const envCandidates = [
    process.env.MD_VIEWER_PYTHON,
    process.env.PYTHON,
    process.env.PYTHON3,
  ];

  for (const candidate of envCandidates) {
    if (candidate && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return 'python';
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
