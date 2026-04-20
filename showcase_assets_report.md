# Showcase Assets Report

## Scope
Presentation/assets-only refresh for MD Viewer. No viewer/runtime behavior was changed.

## Source assets
- Logo PDF: `/Users/dom/Coding/videos_and_logo/horizontal.pdf`
- Marketplace/source logo PDF: `/Users/dom/Coding/videos_and_logo/for_vscode_marketplace.pdf`
- Monomer/ligand/solvent video: `/Users/dom/Coding/videos_and_logo/ligand_monomer_solvent.mov`
- Complexes/nucleotides video: `/Users/dom/Coding/videos_and_logo/complexes.mov`

## Repository assets

### Logos
- `docs/assets/logo/horizontal.pdf`
- `docs/assets/logo/for_vscode_marketplace.pdf`
- `docs/assets/logo/horizontal.png`
  - high-resolution PNG render used by GitHub README, generated from `horizontal.pdf`
- `docs/assets/logo/for_vscode_marketplace.png`
  - high-resolution PNG render used by VS Code package metadata, generated from `for_vscode_marketplace.pdf`

The prior generated PNG logo exports were removed. The supplied PDFs remain in the repository as source logo assets, with PNG renders added only where GitHub and VS Code need image files for display.

### Videos
- `docs/assets/videos/monomer_ligand_solvent_demo.mp4`
  - generated from `ligand_monomer_solvent.mov`
  - H.264 MP4, 1440x900, 30 fps, no audio, fast-start metadata
- `docs/assets/videos/monomer_ligand_solvent_poster.png`
  - poster/thumbnail from the refreshed monomer demo
- `docs/assets/videos/complexes_nucleotides_demo.mp4`
  - generated from `complexes.mov`
  - H.264 MP4, 1440x900, 30 fps, no audio, fast-start metadata
- `docs/assets/videos/complexes_poster.png`
  - poster/thumbnail from the refreshed complexes demo

The original `.mov` files were not copied into the repository because one source file exceeds GitHub's regular Git object size limit. The MP4 derivatives keep the README playback path lightweight and browser-friendly.

## README/package updates
- `README.md`
  - displays `docs/assets/logo/horizontal.png` as the header logo
  - places the logo before the page title
  - links each Showcase poster directly to raw GitHub-hosted MP4 playback URLs
- `package.json`
  - points `icon` at `docs/assets/logo/for_vscode_marketplace.png`

## Proof checks
- Verified README-linked assets exist on disk.
- Verified replacement video files are H.264 MP4 files and remain below GitHub's regular repository file size limit.
- Verified package metadata still parses as JSON.
