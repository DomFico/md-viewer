import { ITrajectoryParser, TrajectoryData } from './IParser';
import { emitCheckpoint } from '../runtimeCheckpoint';
import { BinaryBridgeTrajectoryProvider } from '../trajectory/BinaryBridgeTrajectoryProvider';
import { RUNTIME_BRIDGE_SCRIPTS, resolveRuntimeBridgePath } from '../runtime/bridgePaths';

export type BinaryTrajectoryFormat = 'xtc' | 'dcd' | 'trr' | 'nc' | 'rst7' | 'mdcrd';

type BinaryParserCheckpoints = {
  launch: string;
  exit: string;
  parsed: string;
};

const BINARY_PARSER_CHECKPOINTS: Record<BinaryTrajectoryFormat, BinaryParserCheckpoints> = {
  xtc: {
    launch: 'CHK_XTC_5_XTC_SUBPROCESS_LAUNCH',
    exit: 'CHK_XTC_6_XTC_SUBPROCESS_EXIT',
    parsed: 'CHK_XTC_7_XTC_JSON_PARSED',
  },
  dcd: {
    launch: 'CHK_DCD_5_DCD_SUBPROCESS_LAUNCH',
    exit: 'CHK_DCD_6_DCD_SUBPROCESS_EXIT',
    parsed: 'CHK_DCD_7_DCD_JSON_PARSED',
  },
  trr: {
    launch: 'CHK_TRR_5_TRR_SUBPROCESS_LAUNCH',
    exit: 'CHK_TRR_6_TRR_SUBPROCESS_EXIT',
    parsed: 'CHK_TRR_7_TRR_JSON_PARSED',
  },
  nc: {
    launch: 'CHK_NC_5_NC_SUBPROCESS_LAUNCH',
    exit: 'CHK_NC_6_NC_SUBPROCESS_EXIT',
    parsed: 'CHK_NC_7_NC_JSON_PARSED',
  },
  rst7: {
    launch: 'CHK_RST7_5_RST7_SUBPROCESS_LAUNCH',
    exit: 'CHK_RST7_6_RST7_SUBPROCESS_EXIT',
    parsed: 'CHK_RST7_7_RST7_JSON_PARSED',
  },
  mdcrd: {
    launch: 'CHK_MDCRD_5_MDCRD_SUBPROCESS_LAUNCH',
    exit: 'CHK_MDCRD_6_MDCRD_SUBPROCESS_EXIT',
    parsed: 'CHK_MDCRD_7_MDCRD_JSON_PARSED',
  },
};

const STREAM_CHECKPOINT_PREFIX: Record<BinaryTrajectoryFormat, string> = {
  xtc: 'CHK_STREAM_XTC',
  dcd: 'CHK_STREAM_DCD',
  trr: 'CHK_STREAM_TRR',
  nc: 'CHK_STREAM_NC',
  rst7: 'CHK_STREAM_RST7',
  mdcrd: 'CHK_STREAM_MDCRD',
};

function emitFormatStreamCheckpoint(
  format: BinaryTrajectoryFormat,
  index: 1 | 2,
  suffix: 'PROVIDER_CREATED' | 'METADATA_READY',
  payload: Record<string, unknown>
): void {
  emitCheckpoint(`CHK_STREAM_${index}_${suffix}`, payload);
  emitCheckpoint(`${STREAM_CHECKPOINT_PREFIX[format]}_${index}_${suffix}`, payload);
}

class BinaryBridgeTrajectoryParser implements ITrajectoryParser {
  constructor(
    private readonly extension: string,
    private readonly format: BinaryTrajectoryFormat,
    private readonly accessMode: 'chunked' | 'eager'
  ) {}

  canParse(ext: string): boolean {
    return ext === this.extension;
  }

  async parse(filePath: string, topPath?: string): Promise<TrajectoryData> {
    if (!topPath) {
      throw new Error(`${this.format.toUpperCase()} trajectory parser requires a companion topology path. Missing topology.`);
    }

    const bridgePath = resolveRuntimeBridgePath(RUNTIME_BRIDGE_SCRIPTS.binaryTrajectory);
    const defaultChunkSize = parseEnvInt('MD_VIEWER_STREAM_CHUNK_SIZE', 24);
    const provider = new BinaryBridgeTrajectoryProvider({
      trajectoryPath: filePath,
      topologyPath: topPath,
      format: this.format,
      sourceName: `${this.format}_bridge_subprocess`,
      bridgePath,
      checkpoints: BINARY_PARSER_CHECKPOINTS[this.format],
      accessMode: this.accessMode,
      defaultChunkSize,
    });

    if (this.accessMode === 'chunked') {
      emitFormatStreamCheckpoint(this.format, 1, 'PROVIDER_CREATED', {
        trajectoryPath: filePath,
        topologyPath: topPath,
        format: this.format,
        providerClass: 'BinaryBridgeTrajectoryProvider',
        accessMode: this.accessMode,
        defaultChunkSize,
      });
    }

    if (this.accessMode === 'eager') {
      await provider.loadAllFramesEagerly();
    }

    const metadata = await provider.getMetadata();

    if (this.accessMode === 'chunked') {
      emitFormatStreamCheckpoint(this.format, 2, 'METADATA_READY', {
        trajectoryPath: filePath,
        topologyPath: topPath,
        format: this.format,
        atomCount: metadata.atomCount,
        frameCount: metadata.frameCount,
        accessMode: metadata.accessMode,
        supportsChunkRequests: metadata.supportsChunkRequests,
        defaultChunkSize: metadata.defaultChunkSize ?? null,
      });
    }

    return {
      atomCount: metadata.atomCount,
      atoms: [],
      sourceName: metadata.sourceName,
      frameCount: metadata.frameCount,
      sourceFormat: this.format,
      accessMode: metadata.accessMode,
      trajectoryProvider: provider,
    };
  }
}

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class XtcParser implements ITrajectoryParser {
  private readonly delegate = new BinaryBridgeTrajectoryParser('.xtc', 'xtc', 'chunked');

  canParse(ext: string): boolean {
    return this.delegate.canParse(ext);
  }

  async parse(filePath: string, topPath?: string): Promise<TrajectoryData> {
    return this.delegate.parse(filePath, topPath);
  }
}

export class DcdParser implements ITrajectoryParser {
  private readonly delegate = new BinaryBridgeTrajectoryParser('.dcd', 'dcd', 'chunked');

  canParse(ext: string): boolean {
    return this.delegate.canParse(ext);
  }

  async parse(filePath: string, topPath?: string): Promise<TrajectoryData> {
    return this.delegate.parse(filePath, topPath);
  }
}

export class TrrParser implements ITrajectoryParser {
  private readonly delegate = new BinaryBridgeTrajectoryParser('.trr', 'trr', 'chunked');

  canParse(ext: string): boolean {
    return this.delegate.canParse(ext);
  }

  async parse(filePath: string, topPath?: string): Promise<TrajectoryData> {
    return this.delegate.parse(filePath, topPath);
  }
}

export class NcParser implements ITrajectoryParser {
  private readonly delegate = new BinaryBridgeTrajectoryParser('.nc', 'nc', 'chunked');

  canParse(ext: string): boolean {
    return this.delegate.canParse(ext);
  }

  async parse(filePath: string, topPath?: string): Promise<TrajectoryData> {
    return this.delegate.parse(filePath, topPath);
  }
}

export class Rst7Parser implements ITrajectoryParser {
  private readonly delegate = new BinaryBridgeTrajectoryParser('.rst7', 'rst7', 'chunked');

  canParse(ext: string): boolean {
    return this.delegate.canParse(ext);
  }

  async parse(filePath: string, topPath?: string): Promise<TrajectoryData> {
    return this.delegate.parse(filePath, topPath);
  }
}

export class InpcrdParser implements ITrajectoryParser {
  private readonly delegate = new BinaryBridgeTrajectoryParser('.inpcrd', 'rst7', 'chunked');

  canParse(ext: string): boolean {
    return this.delegate.canParse(ext);
  }

  async parse(filePath: string, topPath?: string): Promise<TrajectoryData> {
    return this.delegate.parse(filePath, topPath);
  }
}

export class MdcrdParser implements ITrajectoryParser {
  private readonly delegate = new BinaryBridgeTrajectoryParser('.mdcrd', 'mdcrd', 'chunked');

  canParse(ext: string): boolean {
    return this.delegate.canParse(ext);
  }

  async parse(filePath: string, topPath?: string): Promise<TrajectoryData> {
    return this.delegate.parse(filePath, topPath);
  }
}
