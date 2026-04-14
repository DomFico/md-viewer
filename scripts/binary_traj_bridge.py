import json
import os
import sys
import warnings
from typing import Any, Dict, List, Optional

# mdtraj's scipy-backed NetCDF warning can precede JSON output and pollute bridge stdout parsing.
warnings.filterwarnings(
    'ignore',
    message="Warning: The 'netCDF4' Python package is not installed.*",
    category=UserWarning,
)

import mdtraj as md

HANDLE_RETURNS_ANGSTROM_FORMATS = {'dcd', 'nc', 'rst7'}


def infer_source_format(traj_path: str, explicit_format: Optional[str] = None) -> str:
    if explicit_format:
        return explicit_format.lower()
    _, ext = os.path.splitext(traj_path)
    return ext.lower().lstrip('.')


def normalize_legacy_args(argv: List[str]) -> Dict[str, Any]:
    # Backward compatible path: binary_traj_bridge.py <traj_path> <top_path> [format]
    if len(argv) >= 3 and not argv[1].startswith('--'):
        return {
            'mode': 'full',
            'traj': argv[1],
            'top': argv[2],
            'format': argv[3] if len(argv) > 3 else None,
            'start': 0,
            'count': None,
            'stride': 1,
        }

    args: Dict[str, Any] = {
        'mode': 'full',
        'traj': None,
        'top': None,
        'format': None,
        'start': 0,
        'count': None,
        'stride': 1,
    }

    i = 1
    while i < len(argv):
        token = argv[i]
        if token == '--mode' and i + 1 < len(argv):
            args['mode'] = argv[i + 1]
            i += 2
            continue
        if token == '--traj' and i + 1 < len(argv):
            args['traj'] = argv[i + 1]
            i += 2
            continue
        if token == '--top' and i + 1 < len(argv):
            args['top'] = argv[i + 1]
            i += 2
            continue
        if token == '--format' and i + 1 < len(argv):
            args['format'] = argv[i + 1]
            i += 2
            continue
        if token == '--start' and i + 1 < len(argv):
            args['start'] = int(argv[i + 1])
            i += 2
            continue
        if token == '--count' and i + 1 < len(argv):
            args['count'] = int(argv[i + 1])
            i += 2
            continue
        if token == '--stride' and i + 1 < len(argv):
            args['stride'] = int(argv[i + 1])
            i += 2
            continue
        i += 1

    return args


def read_metadata(traj_path: str, top_path: str, source_format: str) -> Dict[str, Any]:
    frame_count = 0
    xyz = None

    try:
        with md.open(traj_path) as handle:
            frame_count = len(handle)
            xyz = read_xyz_from_handle(handle, n_frames=1, stride=1)
            xyz = normalize_handle_units_to_nm(xyz, source_format)
    except Exception:
        traj = md.load(traj_path, top=top_path)
        frame_count = int(traj.n_frames)
        xyz = traj.xyz[:1]

    atom_count = int(xyz.shape[1]) if xyz is not None and xyz.shape and len(xyz.shape) >= 2 else 0
    return {
        'mode': 'metadata',
        'atomCount': atom_count,
        'frameCount': frame_count,
        'sourceFormat': source_format,
        'accessMode': 'chunked',
    }


def flatten_frames_angstrom(xyz_values) -> List[List[float]]:
    if xyz_values is None:
        return []
    frames: List[List[float]] = []
    for i in range(xyz_values.shape[0]):
        coords_angstrom = xyz_values[i] * 10.0
        frames.append(coords_angstrom.flatten().tolist())
    return frames


def normalize_handle_units_to_nm(xyz_values, source_format: str):
    if xyz_values is None:
        return xyz_values
    if source_format in HANDLE_RETURNS_ANGSTROM_FORMATS:
        return xyz_values / 10.0
    return xyz_values


def read_chunk(
    traj_path: str,
    top_path: str,
    source_format: str,
    start: int,
    count: Optional[int],
    stride: int,
) -> Dict[str, Any]:
    safe_start = max(0, int(start))
    safe_stride = max(1, int(stride))
    requested_count = max(0, int(count if count is not None else 0))

    try:
        with md.open(traj_path) as handle:
            total_frames = len(handle)
            if safe_start >= total_frames or requested_count == 0:
                return empty_chunk_payload(source_format, safe_start, safe_stride, total_frames)

            handle.seek(safe_start)
            xyz = read_xyz_from_handle(handle, n_frames=requested_count, stride=safe_stride)
            xyz = normalize_handle_units_to_nm(xyz, source_format)
            return build_chunk_payload(
                source_format=source_format,
                safe_start=safe_start,
                safe_stride=safe_stride,
                total_frames=total_frames,
                xyz=xyz,
            )
    except Exception:
        traj = md.load(traj_path, top=top_path)
        total_frames = int(traj.n_frames)
        if safe_start >= total_frames or requested_count == 0:
            return empty_chunk_payload(source_format, safe_start, safe_stride, total_frames)

        xyz = traj.xyz[safe_start::safe_stride][:requested_count]
        return build_chunk_payload(
            source_format=source_format,
            safe_start=safe_start,
            safe_stride=safe_stride,
            total_frames=total_frames,
            xyz=xyz,
        )


def read_full(traj_path: str, top_path: str, source_format: str) -> Dict[str, Any]:
    traj = md.load(traj_path, top=top_path)
    frames = flatten_frames_angstrom(traj.xyz)
    return {
        'mode': 'full',
        'atomCount': traj.n_atoms,
        'frameCount': traj.n_frames,
        'sourceFormat': source_format,
        'frames': frames,
    }


def read_xyz_from_handle(handle, n_frames: int, stride: int):
    try:
        xyz_tuple = handle.read(n_frames=n_frames, stride=stride)
        xyz = xyz_tuple[0]
        return ensure_xyz_3d(xyz)
    except TypeError:
        xyz_tuple = handle.read()
        xyz = xyz_tuple[0]
        xyz = ensure_xyz_3d(xyz)
        if stride <= 1:
            return xyz[:n_frames]
        return xyz[:n_frames:stride]


def ensure_xyz_3d(xyz):
    if xyz is None:
        return xyz
    if len(xyz.shape) == 2:
        return xyz.reshape((1, xyz.shape[0], xyz.shape[1]))
    return xyz


def empty_chunk_payload(source_format: str, safe_start: int, safe_stride: int, total_frames: int) -> Dict[str, Any]:
    return {
        'mode': 'chunk',
        'atomCount': 0,
        'frameCount': total_frames,
        'sourceFormat': source_format,
        'start': safe_start,
        'count': 0,
        'stride': safe_stride,
        'frameIndices': [],
        'frames': [],
    }


def build_chunk_payload(
    *,
    source_format: str,
    safe_start: int,
    safe_stride: int,
    total_frames: int,
    xyz,
) -> Dict[str, Any]:
    frames = flatten_frames_angstrom(xyz)
    returned_count = len(frames)
    atom_count = int(xyz.shape[1]) if xyz.shape and len(xyz.shape) >= 2 else 0
    frame_indices = [safe_start + (i * safe_stride) for i in range(returned_count)]

    return {
        'mode': 'chunk',
        'atomCount': atom_count,
        'frameCount': total_frames,
        'sourceFormat': source_format,
        'start': safe_start,
        'count': returned_count,
        'stride': safe_stride,
        'frameIndices': frame_indices,
        'frames': frames,
    }


def main() -> int:
    args = normalize_legacy_args(sys.argv)

    traj_path = args.get('traj')
    top_path = args.get('top')
    mode = str(args.get('mode') or 'full').lower()

    if not traj_path or not top_path:
        print(json.dumps({
            'error': 'Usage: binary_traj_bridge.py <traj_path> <top_path> [format] OR --mode <metadata|chunk|full> --traj <path> --top <path>'
        }))
        return 1

    source_format = infer_source_format(traj_path, args.get('format'))

    try:
        if mode == 'metadata':
            payload = read_metadata(traj_path, top_path, source_format)
        elif mode == 'chunk':
            chunk_count = args.get('count')
            if chunk_count is None:
                chunk_count = 1
            payload = read_chunk(
                traj_path,
                top_path,
                source_format,
                int(args.get('start') or 0),
                int(chunk_count),
                int(args.get('stride') or 1),
            )
        else:
            payload = read_full(traj_path, top_path, source_format)

        print(json.dumps(payload))
        return 0
    except Exception as err:  # noqa: BLE001
        print(json.dumps({'error': str(err)}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
