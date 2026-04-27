**Preserve the frozen working baseline; fix saved-frame reload correctness and raw-frame-index naming, and prove the fix with targeted save/reload validation, raw-index artifacts, optional screenshots, and regression-gate reruns.**

# Save Frame Reload and Raw Index Report

## Summary
This pass fixes two targeted Save Current Frame issues without widening scope:
1. filename numbering now uses the raw trajectory frame index (not sampled/view index)
2. saved-frame reload semantics were hardened so exported solvent-heavy frames (especially TIP-family waters) reload with correct solvent classification and sane rendering behavior

## 1) Exact root cause of odd reload/render behavior
The reload issue came from **export residue-name semantics**, not coordinate scaling.

- The export path normalized residue names globally to 3 characters (`slice(0, 3)`), so TIP-family water names (e.g. `TIP3P`) could degrade to `TIP` on PDB export.
- The parser/normalizer solvent alias sets did not fully cover TIP-family short aliases (`TIP`, `TIP3`, `TIP4`), so small TIP-water sets could reload as ligand-like classes instead of solvent.
- That classification drift altered how waters were drawn/organized after reload and produced “odd” visual behavior.

Evidence that coordinates/units stayed sane:
- frame-save correctness tests still showed correct atom counts and per-frame coordinate deltas
- no coordinate-length mismatch or unit-conversion failures in save checkpoints

## 2) Exact fix applied
### A. Raw-frame filename numbering
- Save naming now uses raw frame index directly:
  - `..._raw_frame_000012.xyz` (for raw index 12)
- Removed prior `rawFrameIndex + 1` naming convention from suffix and user message.

### B. Solvent-safe export naming + alias recognition
- Export serializer now canonicalizes solvent residue names by format:
  - PDB export: TIP-family aliases -> `WAT`
  - GRO export: TIP-family aliases -> `SOL`
- Residue normalization for export now preserves full name internally and applies format-specific width at serialization time.
- Solvent alias sets were expanded in parser/normalization logic to include TIP-family short aliases and related solvent names:
  - `TIP`, `TIP3`, `TIP3P`, `TIP4`, `TIP4P`, `H2O`, plus existing `HOH`, `WAT`, `SOL`, `SPC`, `SPCE`.

## 3) Exact code changes made
- `vscode-md-viewer/src/commands/openMdViewer.ts`
  - raw-index filename suffix switched to `raw_frame_<rawIndex>`
  - save message/comment text updated to raw-index wording
  - added `frameSuffix` in save checkpoints for explicit auditability
  - added format-aware solvent residue canonicalization for export (`pdb`/`gro`)
  - residue normalization updated to preserve full names pre-serialization
- `vscode-md-viewer/src/parsing/pdb.ts`
  - expanded solvent alias set (TIP-family + `H2O`)
- `vscode-md-viewer/src/parsing/gro.ts`
  - expanded solvent alias set (TIP-family + `H2O`)
- `vscode-md-viewer/src/normalization/DatasetNormalizer.ts`
  - expanded solvent alias set (TIP-family + `H2O`)

## 4) Validation scripts added
- `scripts/test_saved_frame_raw_index_naming.js`
- `scripts/test_saved_frame_reload_sanity.js`
- `scripts/test_saved_frame_format_reload_matrix.js`

## 5) Before/after artifacts
- `artifacts/reference_cases/save_reload_before_after.json`
- `artifacts/reference_cases/save_raw_index_before_after.json`
- `artifacts/reference_cases/save_raw_index_naming.json`
- `artifacts/reference_cases/save_frame_format_reload_matrix.json`

## 6) Proof saved `.pdb`/`.gro`/`.xyz` reload correctly
From `save_frame_format_reload_matrix.json`:
- saved files produced:
  - `format_reload_raw_frame_000000.pdb`
  - `format_reload_raw_frame_000000.gro`
  - `format_reload_raw_frame_000000.xyz`
- each reloaded with:
  - `initPayloadFrameCount = 1`
  - `dataAtomsLength = 33`
  - valid payload/visibility fields populated

From `save_reload_before_after.json` (TIP3P solvent fixture):
- source fixture (`.gro`) classified waters as solvent
- reloaded saved PDB/GRO preserved solvent class behavior (no ligand drift for small TIP-water set)

## 7) Proof filenames use raw trajectory frame index
From `save_raw_index_naming.json`:
- test setup: `frameStride=3`, sampled frame index `4`
- expected raw index: `12`
- saved output observed:
  - `raw_index_case_raw_frame_000012.xyz`
- checkpoint confirms:
  - `frameIndex=4`
  - `rawFrameIndex=12`
  - suffix `raw_frame_000012`
- naming policy delta is captured in `save_raw_index_before_after.json`

## 8) Screenshot artifacts
- Not required for this pass.
- Structured class-count + payload + filename evidence was sufficient to isolate and verify the issue/fix.

## 9) Commands executed
```bash
cd /home/dom/Desktop/Coding/md-preview/vscode-md-viewer
npm run compile
```

```bash
cd /home/dom/Desktop/Coding/md-preview
node scripts/test_saved_frame_raw_index_naming.js
node scripts/test_saved_frame_reload_sanity.js
node scripts/test_saved_frame_format_reload_matrix.js
node scripts/test_save_current_frame_formats.js
node scripts/test_save_current_frame_correctness.js
```

```bash
cd /home/dom/Desktop/Coding/md-preview
node scripts/capture_reference_case.js > artifacts/reference_cases/logs/save_frame_reload_capture.log 2>&1
node scripts/compare_reference_cases.js > artifacts/reference_cases/logs/save_frame_reload_compare.log 2>&1
node scripts/check_regression_gate.js > artifacts/reference_cases/logs/save_frame_reload_regression_gate.log 2>&1
```

## 10) Frozen baseline status
- compile: PASS
- targeted save/reload + raw-index tests: PASS
- existing save-format/correctness tests: PASS
- regression gate: PASS (`[RegressionGate] PASS`)

Outcome: Save Current Frame now reloads more truthfully across formats and uses raw-frame index naming while preserving the frozen baseline.
