**Preserve the frozen working baseline; identify and fix the remaining saved-PDB reload/grouping bug and simplify raw-frame filename naming, proving the issue and the fix with targeted artifacts, optional screenshots, and regression-gate reruns.**

# Save PDB Reload Grouping Fix Report

## Summary
This follow-up pass fixes the remaining saved-PDB reload/grouping bug and simplifies save filename numbering to a raw-index-only suffix.

The fix is intentionally narrow:
- keep current Save Current Frame feature and formats (`.pdb`, `.gro`, `.xyz`)
- keep viewer/setup/streaming/runtime baseline behavior
- correct exported PDB residue identifiers so large solvent systems do not collapse into giant grouped residues
- simplify filename suffix from `raw_frame_000018` style to `18` style

## 1) Exact root cause of remaining saved-PDB reload issue
The remaining issue was PDB residue-identifier collision from export field constraints, not coordinate scaling.

In the old export path:
- residue sequence numbers were clamped to `9999`
- insertion code was not written
- chain IDs were reduced to a single first character

For large solvent-heavy systems, many waters and ions were emitted as the same residue key (for example `A:9999`), which caused residue grouping collapse on reload.

Concrete proof from the user-provided problematic file:
- file: `/home/dom/Desktop/Research/HalM2/1ENC/apo/run_1/md_0_10_raw_frame_000018.pdb`
- `maxAtomsPerWaterResidue = 9399`
- dominant collapsed key: `A:9999:_:WAT`
- artifact: `artifacts/reference_cases/save_pdb_grouping_bug_repro.json`

## 2) Exact fix applied
### A) Collision-safe PDB residue identity export
- Added deterministic residue identity assignment for exported PDB atoms:
  - preserves valid source `(chain, resSeq, insertionCode)` when unique and in range
  - falls back to generated unique identities across chain/resSeq/insertion combinations when needed
- Insertion code is now emitted in PDB output (column 27)
- Prevents high-residue-count collapse into `9999` collisions

### B) Raw-index filename simplification
- Save suffix now uses raw frame index only:
  - `..._18.pdb` instead of `..._raw_frame_000018.pdb`
- Keeps raw index truthfulness while removing `raw_frame` marker and zero-padding complexity

### C) Maintained solvent canonicalization hardening
- TIP-family solvent canonicalization (`WAT` for PDB, `SOL` for GRO) remains intact
- parser/normalizer solvent alias sets still include TIP-family aliases

## 3) Exact code changes made
- `vscode-md-viewer/src/commands/openMdViewer.ts`
  - added `insertionCode` to export atom model
  - added collision-safe PDB residue identity allocator
  - added insertion-code formatting into PDB output
  - changed save filename suffix to simple raw index string
- `vscode-md-viewer/src/parsing/pdb.ts`
  - solvent alias set includes TIP-family short aliases and `H2O`
- `vscode-md-viewer/src/parsing/gro.ts`
  - solvent alias set includes TIP-family short aliases and `H2O`
- `vscode-md-viewer/src/normalization/DatasetNormalizer.ts`
  - solvent alias set includes TIP-family short aliases and `H2O`

## 4) Validation scripts added/updated
- Added:
  - `scripts/saved_pdb_identifier_utils.js`
  - `scripts/test_saved_pdb_residue_grouping_bug.js`
  - `scripts/test_saved_pdb_reload_grouping_fix.js`
  - `scripts/test_saved_pdb_identifier_integrity.js`
  - `scripts/test_saved_frame_simple_raw_naming.js`
- Updated:
  - `scripts/test_saved_frame_raw_index_naming.js`
  - `scripts/test_saved_frame_reload_sanity.js`
  - `scripts/test_saved_frame_format_reload_matrix.js`

## 5) Before/after artifacts
- `artifacts/reference_cases/save_pdb_grouping_bug_repro.json`
- `artifacts/reference_cases/save_pdb_grouping_before_after.json`
- `artifacts/reference_cases/save_pdb_identifier_integrity.json`
- `artifacts/reference_cases/save_filename_policy.json`
- `artifacts/reference_cases/save_raw_index_naming.json`
- `artifacts/reference_cases/save_raw_index_before_after.json`
- `artifacts/reference_cases/save_reload_before_after.json`
- `artifacts/reference_cases/save_frame_format_reload_matrix.json`

## 6) Proof that saved `.pdb` reload no longer collapses waters
From `save_pdb_grouping_before_after.json`:
- Before (known-bad file):
  - `maxAtomsPerWaterResidue = 9399`
  - `waterAtomsAt9999 = 9399`
- After (new export from `md_0_10.xtc + md_0_10.gro`, raw frame 18):
  - saved file: `artifacts/tmp/save_pdb_grouping_fix/md_0_10_18.pdb`
  - `maxAtomsPerWaterResidue = 3`
  - `waterAtomsAt9999 = 3`

This removes the giant collapsed water grouping behavior.

## 7) Proof about water selection behavior
Structural proof from identifier integrity now guarantees water residue grouping is no longer collapsed:
- each water residue in fixed export is size `3`
- no giant `WAT` residue group remains

Checkpoint-based WAT auto-selection was treated as optional corroboration (depends on UI autodrive path); correctness proof is anchored to exported identifier integrity and reload residue grouping metrics.

## 8) Proof filename now uses simple raw frame number
From `save_filename_policy.json`:
- observed: `simple_naming_case_12.xyz`
- includes raw frame index `12`
- no `raw_frame`
- no zero-padded raw index convention

From `save_raw_index_naming.json`:
- sampled frame `4` at stride `3` maps to raw frame `12`
- saved name: `raw_index_case_12.xyz`

## 9) Screenshots
- Not required for this pass.
- Identifier-integrity + reload-grouping metrics provide direct proof of the failure and fix.

## 10) Commands executed
```bash
cd /home/dom/Desktop/Coding/md-preview/vscode-md-viewer
npm run compile
```

```bash
cd /home/dom/Desktop/Coding/md-preview
node scripts/test_saved_pdb_residue_grouping_bug.js
node scripts/test_saved_pdb_reload_grouping_fix.js
node scripts/test_saved_pdb_identifier_integrity.js
node scripts/test_saved_frame_simple_raw_naming.js
node scripts/test_saved_frame_raw_index_naming.js
node scripts/test_saved_frame_reload_sanity.js
node scripts/test_saved_frame_format_reload_matrix.js
node scripts/test_save_current_frame_formats.js
node scripts/test_save_current_frame_correctness.js
```

```bash
cd /home/dom/Desktop/Coding/md-preview
node scripts/capture_reference_case.js > artifacts/reference_cases/logs/save_pdb_grouping_capture.log 2>&1
node scripts/compare_reference_cases.js > artifacts/reference_cases/logs/save_pdb_grouping_compare.log 2>&1
node scripts/check_regression_gate.js > artifacts/reference_cases/logs/save_pdb_grouping_regression_gate.log 2>&1
```

## 11) Frozen baseline status
- compile: PASS
- targeted grouping/naming/reload tests: PASS
- existing save-format/correctness tests: PASS
- regression gate: PASS (`[RegressionGate] PASS`)

Outcome: the remaining saved-PDB residue grouping collapse is fixed, filename numbering is simplified to raw index only, and the frozen baseline remains intact.

