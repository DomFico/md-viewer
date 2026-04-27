**Preserve the frozen working baseline; replace load mode with explicit frames-per-load input, move Change Settings into a separate Tools section, add Save Current Frame for `.pdb`/`.gro`/`.xyz`, and prove it with targeted validation, saved-file artifacts, and regression-gate reruns.**

# Viewer Tools and Frame Save Report

## Summary
This pass delivers a focused UX/workflow enhancement without widening scope:
- setup panel load-mode dropdown replaced by explicit `Frames Per Load` input (`number` or `All`)
- `Change Settings` moved out of Rendering into a dedicated `Tools` section
- new `Save Current Frame` tool added for `.pdb`, `.gro`, `.xyz`

## 1) Root cause / rationale for replacing load mode
The previous `Fast Preview / Standard / Full` dropdown hid the actual frame-window behavior and made tuning chunk/init size indirect. Users needed direct control over how many frames are requested initially and per chunk hint, so the setup flow now exposes a concrete `framesPerLoad` value with explicit `All` semantics.

## 2) Frames-per-load implementation path
- Added explicit behavior type in options model:
  - `FramesPerLoad = number | 'all'`
- Setup panel now sends `framesPerLoad` directly (sanitized).
- Payload/build path maps `framesPerLoad` to:
  - initial frame indices count
  - chunk size hint for chunk-capable providers
- `All` maps to sampled frame count.

## 3) UI/control changes in viewer
- Rendering section keeps rendering-related controls only.
- New `Tools` section added under Rendering.
- `Tools` now contains:
  - `Change Settings`
  - `Save Current Frame`

## 4) Save Current Frame implementation path
- Viewer posts current frame payload (`frameIndex`, `rawFrameIndex`, coordinates).
- Extension handles save request, opens save workflow (or test autosave path), serializes current frame to selected format:
  - `.pdb`
  - `.gro`
  - `.xyz`
- Format-specific serializer output is written via extension-side FS APIs.

## 5) Exact code changes made
- `vscode-md-viewer/src/options/LoadOptions.ts`
  - added `framesPerLoad` to behavior model and defaults
- `vscode-md-viewer/src/commands/openMdSetupPanel.ts`
  - parses/sanitizes `framesPerLoad`
  - setup behavior validation/wiring updated
- `vscode-md-viewer/src/webview/getSetupPanelHtml.ts`
  - removed load-mode dropdown
  - added frames-per-load input control
- `vscode-md-viewer/media/setupPanel.js`
  - emits `framesPerLoad` updates (`number` or `all`)
- `vscode-md-viewer/src/normalization/PayloadBuilder.ts`
  - maps `framesPerLoad` to init frame window/chunk hint
- `vscode-md-viewer/src/webview/getHtml.ts`
  - added `Tools` section and `Save Current Frame` button
- `vscode-md-viewer/media/viewer.js`
  - moved `Change Settings` control logic to Tools area
  - added save-current-frame dispatch and checkpoints
- `vscode-md-viewer/src/commands/openMdViewer.ts`
  - implemented `saveCurrentFrame` handling + `.pdb/.gro/.xyz` writing
  - added save checkpoints + optional test autosave support

## 6) Validation scripts added
- `scripts/test_frames_per_load_input.js`
- `scripts/test_tools_panel_layout.js`
- `scripts/test_save_current_frame_formats.js`
- `scripts/test_save_current_frame_correctness.js`

## 7) Before/after artifacts
- `artifacts/reference_cases/frames_per_load_before_after.json`
- `artifacts/reference_cases/tools_panel_before_after.json`

Additional proof artifacts:
- `artifacts/reference_cases/frames_per_load_input.json`
- `artifacts/reference_cases/tools_panel_layout.json`
- `artifacts/reference_cases/save_current_frame_outputs.json`
- `artifacts/reference_cases/save_current_frame_correctness.json`

## 8) Proof numeric and `All` frame-load values work
From `frames_per_load_input.json`:
- default case: `observedFramesPerLoad = 25`
- custom case: `observedFramesPerLoad = 5`, `initFrameCount = 5`
- all case: `observedFramesPerLoad = "all"`, `initFrameCount = timelineFrameCount`

## 9) Proof Tools section exists and Change Settings moved
From `tools_panel_layout.json` + `tools_panel_before_after.json`:
- `toolsSectionFound = true`
- `renderingContainsChangeSettings = false`
- `toolsContainsChangeSettings = true`
- `toolsContainsSaveCurrentFrame = true`
- reopen dispatch still succeeds (`CHK_REOPEN_4... dispatched=true`)

## 10) Proof Save Current Frame works for `.pdb`, `.gro`, `.xyz`
From `save_current_frame_outputs.json`:
- `.pdb` written, `exists=true`, `atomCount=33`
- `.gro` written, `exists=true`, `atomCount=33`
- `.xyz` written, `exists=true`, `atomCount=33`

## 11) Proof saved files reflect current frame
From `save_current_frame_correctness.json`:
- frame 0 saved as `correctness_test_frame_0001.xyz`
- frame 10 saved as `correctness_test_frame_0011.xyz`
- atom counts equal (`33`) and coordinate delta is non-zero (`deltaMagnitude=28.414179570527427`)
- confirms export is tied to currently displayed frame, not fixed to frame 1

## 12) Frozen-baseline regression proof
Executed and passing:
- `npm run compile`
- targeted scripts listed above
- regression gate rerun:
  - `scripts/capture_reference_case.js`
  - `scripts/compare_reference_cases.js`
  - `scripts/check_regression_gate.js`
- regression log: `artifacts/reference_cases/logs/viewer_tools_regression_gate.log`
- final line: `[RegressionGate] PASS`

## 13) Outcome
The setup workflow is now explicit and controllable (`framesPerLoad`), viewer controls are cleaner (`Tools` section), and users can export the currently visible frame in `.pdb/.gro/.xyz`. Targeted evidence and regression-gate reruns confirm behavior and baseline safety.
