# MD Viewer Project Status

Last updated: April 24, 2026

## 1) What MD Viewer Currently Does
MD Viewer is a lightweight molecular-dynamics dataset inspector inside VS Code. It is designed for local and Remote SSH/HPC workflows, supports topology+trajectory pairing, and enables interactive inspection without requiring full trajectory download/conversion workflows just to triage data.

## 2) Current Major Supported Formats
- Trajectories: `.xyz`, `.xtc`, `.dcd`, `.trr`, `.nc`, `.rst7`, `.inpcrd`, `.mdcrd`
- Topologies: `.pdb`, `.gro`, `.parm7`, `.prmtop`

## 3) Important Completed Milestones
- Generalized dataset loader architecture and resolver flow
- Normalized dataset schema + payload pipeline
- Topology parsing hardening across supported families
- Chunked streaming/provider path for `.xtc` / `.dcd` / `.trr`
- Amber runtime/topology support for `.nc`, `.parm7`, `.rst7`, `.inpcrd`, `.mdcrd`, `.prmtop`
- Setup panel + load-options workflow (including post-load reopen/change-settings flow)
- Regression framework with repeatable reference-case capture/compare/gate checks
- Remote SSH/HPC runtime hardening (interpreter selection, diagnostics, bridge capability truthfulness)
- Bootstrap hardening for managed HPC environments
- Nucleic-acid backbone/trace semantics and pairing-consistency validation
- PDB segname fallback for blank-chain CHARMM-GUI membrane complexes

## 4) Most Recent Fix (PDB Segname Fallback Follow-up)
Issue:
- Some CHARMM-GUI PDBs leave chain ID blank in the standard chain column.
- Initial fallback split top-level chains correctly, but residue-level chain IDs could still remain blank.

Fix:
- Use segname fallback when chain ID is blank.
- Ensure residue-level chain IDs also store the effective chain ID (not blank raw chain ID).

Why it mattered:
- Prevents downstream chain/residue grouping collapse in normalization and payload semantics.

## 5) Current Proof / Validation Culture
Expected for meaningful changes:
- Targeted validation scripts
- Before/after artifacts
- Runtime checkpoints/logs where relevant
- Regression-gate reruns
- No completion claims based on compile-only checks

## 6) Current Known-Good Status
- Frozen regression gate is passing
- Latest parser/runtime sanity checks for recent fixes are passing
- Extension behavior has been validated across multiple tested remote/HPC paths to date

## 7) Known Cautions / Future Work
- HPC environments still vary widely by module stack, Python build, and package availability
- Bootstrap/runtime may still require host-specific troubleshooting in edge cases
- Membrane/CHARMM-GUI and other specialized systems should continue to be validated with explicit proof artifacts
- Future work should stay tightly scoped and preserve the frozen baseline
