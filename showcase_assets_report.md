# Showcase Assets Report

## Scope
Presentation/assets-only pass for MD Viewer. No viewer/runtime behavior was changed.

## Source assets reviewed
- Video source: `/home/dom/Videos/Screencasts/monomer_ligand_solvent.webm`
  - source format: VP8 WebM
  - source size: 72 MB
  - source resolution/duration: 3837x2040, 52.44 s
- Video source: `/home/dom/Videos/Screencasts/complexes.webm`
  - source format: VP8 WebM
  - source size: 145 MB
  - source resolution/duration: 3837x2040, 51.93 s
- Logo source: `/home/dom/Desktop/Presentation 7-1.pdf`
  - one 16:9 PDF slide, 960 x 540 pt
  - source contains substantial whitespace and slide-style composition, so it is not ideal as a direct Marketplace icon

## Generated assets

### Logo exports
- `docs/assets/logo/md-viewer-icon.png` - 256x256 transparent PNG, package/Marketplace icon
- `docs/assets/logo/md-viewer-icon-256.png` - 256x256 transparent PNG
- `docs/assets/logo/md-viewer-icon-512.png` - 512x512 transparent PNG
- `docs/assets/logo/md-viewer-icon-1024.png` - 1024x1024 transparent PNG
- `docs/assets/logo/md-viewer-mark-transparent.png` - extracted transparent protein/cartoon mark
- `docs/assets/logo/md-viewer-logo-horizontal.png` - README/header lockup on white background
- `docs/assets/logo/md-viewer-logo-horizontal-light-bg.png` - transparent horizontal lockup with dark text
- `docs/assets/logo/md-viewer-logo-horizontal-dark-bg.png` - transparent horizontal lockup with light text

Logo cleanup performed:
- cropped away slide whitespace
- removed white/light neutral background behind the protein/cartoon mark
- exported square icon sizes suitable for Marketplace/GitHub use
- rebuilt a clean horizontal logo lockup because the PDF text placement was slide-oriented and not ideal for a tight header asset

### Video exports
- `docs/assets/videos/monomer_ligand_solvent_demo.mp4`
  - transformed from original WebM
  - 1280x680, H.264 MP4, 30 fps, no audio
  - output size: about 2.3 MB
- `docs/assets/videos/monomer_ligand_solvent_poster.png`
  - poster/thumbnail from the viewer portion of the demo
- `docs/assets/videos/complexes_nucleotides_demo.mp4`
  - transformed from original WebM
  - 1280x680, H.264 MP4, 30 fps, no audio
  - output size: about 4.1 MB
- `docs/assets/videos/complexes_poster.png`
  - poster/thumbnail from the complex/nucleotide/multi-chain portion of the demo

Video decision:
- original WebM files were not copied into the repo because they are high-resolution source captures and large for front-page/package use
- smaller MP4 derivatives were generated for practical README/Marketplace presentation

## README/package updates
- `README.md`
  - added logo header image
  - added compact Showcase table with two demo thumbnails linking to MP4 demos
  - kept the section short to avoid cluttering the front page
- `package.json`
  - added `icon: docs/assets/logo/md-viewer-icon.png`
  - added dark Marketplace gallery banner metadata

## Recommendations
- Primary showcase video: `docs/assets/videos/monomer_ligand_solvent_demo.mp4`
  - best first impression because it demonstrates monomer, ligand, solvent/ion rendering, and solvent visibility controls
- Secondary showcase video: `docs/assets/videos/complexes_nucleotides_demo.mp4`
  - useful follow-up because it demonstrates complexes, nucleotides, multiple chains, and broader structural complexity
- Marketplace icon: `docs/assets/logo/md-viewer-icon.png`
  - square transparent PNG; keep this as the package icon
- GitHub/README header: `docs/assets/logo/md-viewer-logo-horizontal.png`
  - predictable on GitHub light backgrounds
- Gray/skewed source background: drop it for release assets
  - transparent/clean exports are clearer, smaller, and more reusable across GitHub and Marketplace contexts

## Proof checks
- Verified `package.json` parses and `icon` path exists.
- Verified README-linked assets exist on disk.
- Ran `npx @vscode/vsce ls` and confirmed the VSIX file list includes README, `package.json`, logo exports, poster thumbnails, and optimized MP4 demos.
- `.vscodeignore` excludes `*_report.md` so this report remains repo-facing documentation and is not included in the VSIX package.
