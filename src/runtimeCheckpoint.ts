import * as fs from 'fs';
import * as path from 'path';

type CheckpointPayload = Record<string, unknown>;

interface CheckpointEntry {
  timestamp: string;
  checkpoint: string;
  payload: CheckpointPayload;
}

function normalizeError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }
  return String(err);
}

export function emitCheckpoint(checkpoint: string, payload: CheckpointPayload): void {
  const entry: CheckpointEntry = {
    timestamp: new Date().toISOString(),
    checkpoint,
    payload,
  };
  const line = `[MDV_CHECKPOINT] ${JSON.stringify(entry)}`;
  console.log(line);

  const outputPath = process.env.MD_VIEWER_CHECKPOINT_LOG;
  if (!outputPath) {
    return;
  }

  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.appendFileSync(outputPath, `${line}\n`, 'utf8');
  } catch (err) {
    console.error(`[MDV_CHECKPOINT_WRITE_FAILED] ${normalizeError(err)}`);
  }
}
