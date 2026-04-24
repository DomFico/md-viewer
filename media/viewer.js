/**
 * MD Viewer — Three.js manual-abstraction trajectory player
 */
(function () {
  'use strict';

  // ── Element color palette ──────────────────────────────────────────────────
  const ELEMENT_COLORS_BY_THEME = {
    black: {
      H:  0xdddddd, C:  0x888888, N:  0x5599ff, O:  0xff5544,
      S:  0xffcc00, P:  0xff9900, F:  0x00ffaa, Cl: 0x00dd66,
      Br: 0xaa3300, I:  0x7700cc, CA: 0x888888,
    },
    white: {
      H:  0x6b7280, C:  0x4b5563, N:  0x2f68c5, O:  0xc73e33,
      S:  0xa37a00, P:  0xb86a00, F:  0x0f8f73, Cl: 0x23814d,
      Br: 0x8d3b1f, I:  0x6940b5, CA: 0x4b5563,
    },
  };
  const DEFAULT_ELEMENT_COLORS = {
    black: 0xaaaaaa,
    white: 0x5f6773,
  };
  const CHAIN_COLORS_BY_THEME = {
    black: [0xff7f50, 0x66d9ef, 0xf4d35e, 0x7bd389, 0xc792ea, 0xff9fda, 0x9ad1ff, 0xffb86c],
    white: [0xc8553d, 0x1f7a8c, 0xa87800, 0x2f855a, 0x7a4db5, 0xb3477a, 0x2f5d8a, 0xb16a1d],
  };
  const AMINO_ACID_CODES = {
    ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C',
    GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
    LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P',
    SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
    SEC: 'U', PYL: 'O',
  };

  // ── Covalent radii (Å) for bond inference ────────────────────────────────
  const COVALENT_RADII = {
    H: 0.31, C: 0.76, N: 0.71, O: 0.66,
    S: 1.05, P: 1.07, F: 0.57, Cl: 1.02, Br: 1.14, I: 1.33,
  };
  const DEFAULT_RADIUS = 0.75;
  const CONTROL_TUNING = {
    horizontalRotationSign: -1,
    verticalRotationSign: -1,
    rotationSensitivity: 0.008,
    panSensitivity: 0.0012,
    zoomSensitivity: 0.001,
  };
  const LAYOUT_TUNING = {
    sequenceDefault: 118,
    sequenceMin: 58,
    sequenceCollapsed: 29,
    sequenceCollapseThreshold: 42,
    sequenceMaxFraction: 0.48,
    panelDefault: 246,
    panelMin: 180,
    panelCollapsed: 35,
    panelCollapseThreshold: 88,
    panelMaxFraction: 0.42,
  };
  const LINE_THICKNESS_SCREEN_PX = {
    base: 2.0,
  };
  const VIEWER_THEMES = {
    black: {
      clear: 0x0d1117,
      css: '#0d1117',
      proteinTrace: 0xaaccff,
      proteinBond: 0x446688,
      ligandBond: 0x33cc66,
      localNeighborhoodBond: 0x697586,
      residueHighlight: 0xffd84a,
    },
    white: {
      clear: 0xffffff,
      css: '#ffffff',
      proteinTrace: 0x2f5d8a,
      proteinBond: 0x5a7088,
      ligandBond: 0x1f8f4c,
      localNeighborhoodBond: 0x4b5563,
      residueHighlight: 0xc59b0b,
    },
  };

  function normalizeBackgroundMode(value) {
    return value === 'white' ? 'white' : 'black';
  }

  function elementColor(el, backgroundMode) {
    const key = el.length === 1 ? el.toUpperCase() : (el[0].toUpperCase() + el.slice(1).toLowerCase());
    const palette = ELEMENT_COLORS_BY_THEME[backgroundMode] ?? ELEMENT_COLORS_BY_THEME.black;
    return palette[key] ?? DEFAULT_ELEMENT_COLORS[backgroundMode] ?? DEFAULT_ELEMENT_COLORS.black;
  }

  function chainColor(chainIndex, backgroundMode) {
    const palette = CHAIN_COLORS_BY_THEME[backgroundMode] ?? CHAIN_COLORS_BY_THEME.black;
    return palette[((chainIndex % palette.length) + palette.length) % palette.length];
  }

  function chainColorCss(chainIndex, backgroundMode) {
    const color = new THREE.Color(chainColor(chainIndex, backgroundMode));
    return `#${color.getHexString()}`;
  }

  function colorHexCss(colorValue) {
    const color = new THREE.Color(colorValue);
    return `#${color.getHexString()}`;
  }

  function covalentRadius(el) {
    const key = el.length === 1 ? el.toUpperCase() : (el[0].toUpperCase() + el.slice(1).toLowerCase());
    return COVALENT_RADII[key] ?? DEFAULT_RADIUS;
  }

  function residueLabel(residue, sequenceMode) {
    if (sequenceMode === 'three') return residue.resName;
    return AMINO_ACID_CODES[residue.resName.toUpperCase()] ?? residue.resName;
  }

  function formatResidueId(residue) {
    const suffix = residue.insertionCode ? residue.insertionCode : '';
    return `${residue.resSeq}${suffix}`;
  }

  function residueDescriptor(residue) {
    const chainName = residue.chainId ? `Chain ${residue.chainId}` : 'Unassigned chain';
    return `${chainName} ${residue.resName} ${formatResidueId(residue)}`;
  }

  function residueDescriptorCompact(residue) {
    const chainName = residue.chainId || '_';
    return `${chainName}:${residue.resName}${formatResidueId(residue)}`;
  }

  function inferBonds(atoms, pos) {
    const n = atoms.length;
    const pairs = [];
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const dx = pos[i*3] - pos[j*3];
            const dy = pos[i*3+1] - pos[j*3+1];
            const dz = pos[i*3+2] - pos[j*3+2];
            const d2 = dx*dx + dy*dy + dz*dz;
            const maxBond = (covalentRadius(atoms[i].element) + covalentRadius(atoms[j].element)) * 1.3;
            if (d2 < maxBond*maxBond) pairs.push(i, j);
        }
    }
    return new Int32Array(pairs);
  }

  function inferSubsetBonds(atoms, pos, indices) {
    const pairs = [];
    for (let a = 0; a < indices.length; a++) {
      const i = indices[a];
      for (let b = a + 1; b < indices.length; b++) {
        const j = indices[b];
        const dx = pos[i * 3] - pos[j * 3];
        const dy = pos[i * 3 + 1] - pos[j * 3 + 1];
        const dz = pos[i * 3 + 2] - pos[j * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        const maxBond = (covalentRadius(atoms[i].element) + covalentRadius(atoms[j].element)) * 1.3;
        if (d2 < maxBond * maxBond) pairs.push(i, j);
      }
    }
    return new Int32Array(pairs);
  }

  function excludeBondPairs(pairArray, excludedIndices) {
    if (!pairArray || excludedIndices.length === 0) {
      return pairArray;
    }

    const excluded = new Set(excludedIndices);
    const pairs = [];
    for (let i = 0; i < pairArray.length; i += 2) {
      const a = pairArray[i];
      const b = pairArray[i + 1];
      if (!excluded.has(a) && !excluded.has(b)) {
        pairs.push(a, b);
      }
    }
    return new Int32Array(pairs);
  }

  function filterVisibleIndices(indices, hiddenIndexSet) {
    if (!hiddenIndexSet || hiddenIndexSet.size === 0) {
      return Array.isArray(indices) ? indices.slice() : [];
    }
    const filtered = [];
    for (let i = 0; i < indices.length; i++) {
      const atomIndex = indices[i];
      if (!hiddenIndexSet.has(atomIndex)) {
        filtered.push(atomIndex);
      }
    }
    return filtered;
  }

  function filterVisiblePairs(pairArray, hiddenIndexSet) {
    if (!Array.isArray(pairArray) || pairArray.length === 0) {
      return [];
    }
    if (!hiddenIndexSet || hiddenIndexSet.size === 0) {
      return pairArray.slice();
    }
    const filtered = [];
    for (let i = 0; i + 1 < pairArray.length; i += 2) {
      const a = pairArray[i];
      const b = pairArray[i + 1];
      if (!hiddenIndexSet.has(a) && !hiddenIndexSet.has(b)) {
        filtered.push(a, b);
      }
    }
    return filtered;
  }

  console.log('[WebView] script loading initiated');

  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  if (vscode) {
    console.log('[WebView] vscode api acquired');
  }

  function sendWebviewCheckpoint(checkpoint, payload) {
    const entry = { checkpoint, payload };
    console.log('[WebView][Checkpoint]', entry);
    if (vscode) {
      vscode.postMessage({
        type: 'checkpoint',
        checkpoint,
        payload,
      });
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  let activeTrajectoryMessageHandler = null;

  // Bind message listeners early
  window.addEventListener('message', event => {
    const message = event.data;
    console.log('[WebView] IPC Message Received:', message.type || message.command);
    if (
      (message.type === 'trajectoryFrameChunkResponse' || message.type === 'trajectoryFrameChunkError') &&
      typeof activeTrajectoryMessageHandler === 'function'
    ) {
      activeTrajectoryMessageHandler(message);
      return;
    }
    if (message.type === 'init' || message.command === 'loadTrajectory') {
      console.log('[WebView] Bootstrapping scene initialization');
      
      // Handle the new nested payload format or fallback to the old format
      const payload = message.payload || message;
      
      try {
        initViewer(payload.data, payload.stats, payload.config, payload.runtimeDebug || {});
      } catch (err) {
        console.error('[WebView] Bootstrap Failed:', err);
        const errDump = (err && err.stack) ? err.stack : String(err);
        document.getElementById('canvas-container').innerHTML = 
          `<div style="color:#ff5555; padding: 2rem; background: #220000;">
             <h3>Viewer Crash</h3>
             <pre style="white-space: pre-wrap; font-size: 12px;">${errDump}</pre>
           </div>`;
      }
    }
  });

  if (vscode) {
    console.log('[WebView] sending ready event');
    vscode.postMessage({ type: 'ready' });
  }

  function initViewer(traj, stats, config, runtimeDebug) {
    console.log('[WebView] initViewer start');
    activeTrajectoryMessageHandler = null;
    if (!traj || !traj.frames || traj.frames.length === 0) {
      document.getElementById('canvas-container').innerHTML = '<p style="color:red;padding:2rem;">No trajectory data found.</p>';
      return;
    }

    const debugContext = runtimeDebug || {};
    const isGroBackedFlow = debugContext.isGroBackedFlow === true;
    const isAmberFlow = debugContext.isAmberFlow === true
      || debugContext.trajectoryExt === '.nc'
      || debugContext.trajectoryExt === '.rst7'
      || debugContext.topologyExt === '.parm7';
    const trajectoryExt = String(debugContext.trajectoryExt || '').toLowerCase();
    const dcdNcParityFormatPrefix = trajectoryExt === '.dcd'
      ? 'CHK_DCD_PARITY'
      : (trajectoryExt === '.nc' ? 'CHK_NC_PARITY' : null);
    const dcdNcParityProbeEnabled = Boolean(
      dcdNcParityFormatPrefix && (
        debugContext.dcdNcParityProbe === true
        || debugContext.dcdNcParityProbe === '1'
        || debugContext.dcdNcParityProbe === 1
      )
    );
    const uxProbeAutodrive = debugContext.uxProbeAutodrive === true;
    const reopenSettingsAutodrive = debugContext.reopenSettingsAutodrive === true;
    const reopenSettingsAutodriveDelayMs = Number.isFinite(Number(debugContext.reopenSettingsAutodriveDelayMs))
      ? Math.max(0, Number(debugContext.reopenSettingsAutodriveDelayMs))
      : 900;
    const reopenSettingsAutodriveOptions =
      debugContext.reopenSettingsAutodriveOptions && typeof debugContext.reopenSettingsAutodriveOptions === 'object'
        ? debugContext.reopenSettingsAutodriveOptions
        : null;
    const reopenSettingsAutodriveAutoConfirm = debugContext.reopenSettingsAutodriveAutoConfirm === true;
    const referenceHarnessRaw = debugContext.referenceHarness || {};
    const referenceHarnessEnabled = referenceHarnessRaw.enabled === true;
    const referenceHarness = {
      enabled: referenceHarnessEnabled,
      caseId: referenceHarnessRaw.caseId || null,
      captureInteractions: referenceHarnessRaw.captureInteractions !== false,
      initCaptureDelayMs: Number.isFinite(referenceHarnessRaw.initCaptureDelayMs) ? referenceHarnessRaw.initCaptureDelayMs : 250,
      interactionStepDelayMs: Number.isFinite(referenceHarnessRaw.interactionStepDelayMs) ? referenceHarnessRaw.interactionStepDelayMs : 300,
      cameraSettleTimeoutMs: Number.isFinite(referenceHarnessRaw.cameraSettleTimeoutMs) ? referenceHarnessRaw.cameraSettleTimeoutMs : 2600,
    };
    const parityCheckpointsEnabled = isAmberFlow || referenceHarness.enabled;
    const checkpointContext = {
      trajectoryPath: debugContext.trajectoryPath || null,
      topologyPath: debugContext.topologyPath || null,
      sourceTrajectoryPath: debugContext.trajectoryPath || null,
    };

    function emitDcdNcParityCheckpoint(step, suffix, payload) {
      if (!dcdNcParityFormatPrefix) return;
      sendWebviewCheckpoint(`${dcdNcParityFormatPrefix}_${step}_${suffix}`, payload);
    }

    const { atomCount, atoms, frames, topology } = traj;
    const trajectoryMeta = traj.trajectory || {};
    const supportsFrameRequests = Boolean(trajectoryMeta.supportsFrameRequests);
    const chunkSizeHint = Number.isFinite(trajectoryMeta.chunkSizeHint) && trajectoryMeta.chunkSizeHint > 0
      ? trajectoryMeta.chunkSizeHint
      : 24;
    const totalFrameCount = Number.isFinite(trajectoryMeta.frameCount) && trajectoryMeta.frameCount > 0
      ? trajectoryMeta.frameCount
      : frames.length;
    const samplingFrameStride = Number.isFinite(trajectoryMeta.samplingFrameStride) && trajectoryMeta.samplingFrameStride > 0
      ? Math.max(1, Math.floor(trajectoryMeta.samplingFrameStride))
      : (Number.isFinite(trajectoryMeta.initialFrameStride) && trajectoryMeta.initialFrameStride > 0
        ? Math.max(1, Math.floor(trajectoryMeta.initialFrameStride))
        : 1);
    const sampledFrameCount = Number.isFinite(trajectoryMeta.sampledFrameCount) && trajectoryMeta.sampledFrameCount > 0
      ? Math.max(1, Math.floor(trajectoryMeta.sampledFrameCount))
      : totalFrameCount;
    const rawFrameCount = Number.isFinite(trajectoryMeta.rawFrameCount) && trajectoryMeta.rawFrameCount > 0
      ? Math.max(sampledFrameCount, Math.floor(trajectoryMeta.rawFrameCount))
      : Math.max(sampledFrameCount, totalFrameCount * samplingFrameStride);
    const providedFrameIndices = Array.isArray(trajectoryMeta.initialFrameIndices) &&
      trajectoryMeta.initialFrameIndices.length === frames.length
      ? trajectoryMeta.initialFrameIndices.map((value) => Number(value))
      : frames.map((_, idx) => idx);
    const providedRawFrameIndices = Array.isArray(trajectoryMeta.initialFrameRawIndices) &&
      trajectoryMeta.initialFrameRawIndices.length === frames.length
      ? trajectoryMeta.initialFrameRawIndices.map((value) => Number(value))
      : providedFrameIndices.map((virtualIdx) => virtualIdx * samplingFrameStride);
    const frameCache = new Map();
    const rawFrameIndexByVirtual = new Map();
    for (let i = 0; i < frames.length; i++) {
      frameCache.set(providedFrameIndices[i], frames[i]);
      rawFrameIndexByVirtual.set(providedFrameIndices[i], providedRawFrameIndices[i]);
    }
    const float32Frames = frameCache;
    const frameRequestState = {
      sequence: 0,
      pendingById: new Map(),
      pendingByChunkKey: new Map(),
    };

    function frameChunkKey(start, count, stride) {
      return `${start}:${count}:${stride}`;
    }

    function getFrameData(frameIndex) {
      return float32Frames.get(frameIndex) || null;
    }

    function cacheChunkFrames(frameIndices, chunkFrames, rawFrameIndices) {
      for (let i = 0; i < frameIndices.length; i++) {
        const virtualIndex = frameIndices[i];
        float32Frames.set(virtualIndex, chunkFrames[i]);
        if (Array.isArray(rawFrameIndices) && Number.isFinite(rawFrameIndices[i])) {
          rawFrameIndexByVirtual.set(virtualIndex, rawFrameIndices[i]);
        } else if (!rawFrameIndexByVirtual.has(virtualIndex)) {
          rawFrameIndexByVirtual.set(virtualIndex, virtualIndex * samplingFrameStride);
        }
      }
    }
    const hasTopology = topology && topology.hasTopology;
    const persistedState = vscode && typeof vscode.getState === 'function' ? (vscode.getState() || {}) : {};
    let backgroundMode = normalizeBackgroundMode(persistedState.backgroundMode || config.backgroundColor);
    let sequenceMode = persistedState.sequenceMode === 'three' ? 'three' : 'one';
    let localContextRadius = Number.isFinite(persistedState.localContextRadius)
      ? persistedState.localContextRadius
      : 6;
    let sequenceRegionCollapsed = persistedState.sequenceRegionCollapsed === true;
    let sequenceExpandedHeight = Number.isFinite(persistedState.sequenceExpandedHeight)
      ? persistedState.sequenceExpandedHeight
      : LAYOUT_TUNING.sequenceDefault;
    let controlPanelOpen = persistedState.controlPanelOpen !== false;
    let controlPanelExpandedWidth = Number.isFinite(persistedState.controlPanelExpandedWidth)
      ? persistedState.controlPanelExpandedWidth
      : LAYOUT_TUNING.panelDefault;
    
    const displayFilter = (traj && traj.displayFilter && typeof traj.displayFilter === 'object')
      ? traj.displayFilter
      : {};
    const hiddenAtomIndices = Array.isArray(displayFilter.hiddenAtomIndices)
      ? displayFilter.hiddenAtomIndices.filter((value) => Number.isInteger(value) && value >= 0)
      : [];
    const hiddenAtomSet = new Set(hiddenAtomIndices);
    const caIndices = hasTopology ? filterVisibleIndices(topology.caIndices || [], hiddenAtomSet) : [];
    const caLinePairs = hasTopology ? filterVisiblePairs(topology.caLinePairs || [], hiddenAtomSet) : [];
    const explicitTopologyBondPairs = hasTopology ? filterVisiblePairs(topology.bondPairs || [], hiddenAtomSet) : [];
    const ligandIonIndices = hasTopology ? filterVisibleIndices(topology.ligandIonIndices || [], hiddenAtomSet) : [];
    const ligandIndices = hasTopology ? filterVisibleIndices((topology.ligandIndices || topology.ligandIonIndices || []), hiddenAtomSet) : [];
    const chainIds = hasTopology ? (topology.chains || []) : [];
    const atomToChain = hasTopology ? (topology.atomToChain || []) : [];
    const atomToResidue = hasTopology ? (topology.atomToResidue || []) : [];
    const commonSolventResidueNames = hasTopology && Array.isArray(topology.commonSolventResidueNames)
      ? topology.commonSolventResidueNames.map((name) => String(name || '').toUpperCase())
      : [];
    const commonSolventResidueNameSet = new Set(commonSolventResidueNames);
    const residueNameCounts = hasTopology && topology.residueNameCounts && typeof topology.residueNameCounts === 'object'
      ? topology.residueNameCounts
      : {};
    const residueEntries = hasTopology
      ? (topology.residueEntries || []).map((entry, index) => {
        const resNameUpper = String(entry?.resName || '').toUpperCase();
        const classification = typeof entry?.classification === 'string'
          ? entry.classification
          : (entry?.isIon ? 'ion' : (entry?.isLigand ? 'ligand' : (entry?.isSolvent ? 'solvent' : 'polymer_or_other')));
        const isCommonSolvent = Boolean(entry?.isCommonSolvent) || commonSolventResidueNameSet.has(resNameUpper);
        const isSolvent = Boolean(entry?.isSolvent) || classification === 'solvent' || isCommonSolvent;
        return {
          ...entry,
          residueId: index,
          classification,
          isSolvent,
          isCommonSolvent,
        };
      })
      : [];
    const useChainColors = hasTopology && chainIds.length > 1;
    const caIndexSet = new Set(caIndices);
    const residueHasVisibleAtoms = hasTopology
      ? residueEntries.map((entry) => Array.isArray(entry.atomIndices) && entry.atomIndices.some((atomIndex) => !hiddenAtomSet.has(atomIndex)))
      : [];
    const visibleResidueCount = hasTopology
      ? residueHasVisibleAtoms.filter(Boolean).length
      : 0;
    if (hasTopology) {
      sendWebviewCheckpoint('CHK_SOLV_7_SOLVENT_RENDER_MODE', {
        ...checkpointContext,
        renderRule: 'common_solvent_points_only_no_bonds',
        commonSolventResidueNames,
        commonSolventCount: commonSolventResidueNames.length,
        commonSolventThreshold: Number(topology.commonSolventThreshold || displayFilter.commonSolventThreshold || 50),
        residueNameCountsSample: Object.entries(residueNameCounts)
          .map(([name, count]) => ({ name, count: Number(count) || 0 }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
          .slice(0, 16),
      });
    }

    if (isGroBackedFlow) {
      sendWebviewCheckpoint('CHK_GRO_7_WEBVIEW_INIT_RECEIVED', {
        clickedPath: debugContext.clickedPath || null,
        trajectoryPath: debugContext.trajectoryPath || null,
        topologyPath: debugContext.topologyPath || null,
        trajectoryExt: debugContext.trajectoryExt || null,
        topologyExt: debugContext.topologyExt || null,
        atomCount,
        frameCount: totalFrameCount,
        loadedFrameCount: Array.isArray(frames) ? frames.length : null,
        supportsFrameRequests,
        chunkSizeHint,
        hasTopologyFlag: Boolean(hasTopology),
        topologyPresent: Boolean(topology),
        topology_hasTopology_value: topology ? Boolean(topology.hasTopology) : null,
        topology_residueEntries_length: Array.isArray(topology && topology.residueEntries) ? topology.residueEntries.length : null,
        topology_atomToResidue_length: Array.isArray(topology && topology.atomToResidue) ? topology.atomToResidue.length : null,
        topology_chains_length: Array.isArray(topology && topology.chains) ? topology.chains.length : null,
        topology_atomToChain_length: Array.isArray(topology && topology.atomToChain) ? topology.atomToChain.length : null,
        topology_caIndices_length: Array.isArray(topology && topology.caIndices) ? topology.caIndices.length : null,
        topology_bondPairs_length: Array.isArray(topology && topology.bondPairs) ? topology.bondPairs.length : null,
        topology_backbonePairs_field: topology && Array.isArray(topology.backbonePairs) ? 'backbonePairs' : 'caLinePairs',
        topology_backbonePairs_length: topology && Array.isArray(topology.backbonePairs)
          ? topology.backbonePairs.length
          : (topology && Array.isArray(topology.caLinePairs) ? topology.caLinePairs.length : null),
        topology_ligandIndices_length: Array.isArray(topology && topology.ligandIndices) ? topology.ligandIndices.length : null,
        topology_ionIndices_length: Array.isArray(topology && topology.ionIndices) ? topology.ionIndices.length : null,
        topology_ligandIonIndices_length: Array.isArray(topology && topology.ligandIonIndices) ? topology.ligandIonIndices.length : null,
        data_frames_length: Array.isArray(frames) ? frames.length : null,
        data_atoms_length: Array.isArray(atoms) ? atoms.length : null,
        displayFilter_selectionPreset: displayFilter.selectionPreset || null,
        displayFilter_solventHandling: displayFilter.solventHandling || null,
        displayFilter_hiddenAtomCount: hiddenAtomSet.size,
        displayFilter_visibleResidueCount: visibleResidueCount,
      });
    }
    if (isAmberFlow) {
      sendWebviewCheckpoint('CHK_AMBER_8_VIEWER_INIT_RECEIVED', {
        clickedPath: debugContext.clickedPath || null,
        trajectoryPath: debugContext.trajectoryPath || null,
        topologyPath: debugContext.topologyPath || null,
        trajectoryExt: debugContext.trajectoryExt || null,
        topologyExt: debugContext.topologyExt || null,
        atomCount,
        totalFrameCount,
        loadedFrameCount: Array.isArray(frames) ? frames.length : null,
        supportsFrameRequests,
        chunkSizeHint,
        hasTopologyFlag: Boolean(hasTopology),
        topologyPresent: Boolean(topology),
        topology_hasTopology_value: topology ? Boolean(topology.hasTopology) : null,
        topology_residueEntries_length: Array.isArray(topology && topology.residueEntries) ? topology.residueEntries.length : null,
        topology_atomToResidue_length: Array.isArray(topology && topology.atomToResidue) ? topology.atomToResidue.length : null,
        topology_chains_length: Array.isArray(topology && topology.chains) ? topology.chains.length : null,
        topology_atomToChain_length: Array.isArray(topology && topology.atomToChain) ? topology.atomToChain.length : null,
        topology_caIndices_length: Array.isArray(topology && topology.caIndices) ? topology.caIndices.length : null,
        topology_bondPairs_length: Array.isArray(topology && topology.bondPairs) ? topology.bondPairs.length : null,
        topology_backbonePairs_field: topology && Array.isArray(topology.backbonePairs) ? 'backbonePairs' : 'caLinePairs',
        topology_backbonePairs_length: topology && Array.isArray(topology.backbonePairs)
          ? topology.backbonePairs.length
          : (topology && Array.isArray(topology.caLinePairs) ? topology.caLinePairs.length : null),
        topology_ligandIndices_length: Array.isArray(topology && topology.ligandIndices) ? topology.ligandIndices.length : null,
        topology_ionIndices_length: Array.isArray(topology && topology.ionIndices) ? topology.ionIndices.length : null,
        topology_ligandIonIndices_length: Array.isArray(topology && topology.ligandIonIndices) ? topology.ligandIonIndices.length : null,
        data_frames_length: Array.isArray(frames) ? frames.length : null,
        data_atoms_length: Array.isArray(atoms) ? atoms.length : null,
        displayFilter_selectionPreset: displayFilter.selectionPreset || null,
        displayFilter_solventHandling: displayFilter.solventHandling || null,
        displayFilter_hiddenAtomCount: hiddenAtomSet.size,
        displayFilter_visibleResidueCount: visibleResidueCount,
      });
    }
    if (parityCheckpointsEnabled) {
      const residueSummaryByName = {};
      const trackedResidueNames = ['AS4', 'ANP', 'ZNB', 'MG'];
      for (const trackedName of trackedResidueNames) {
        residueSummaryByName[trackedName] = {
          residueCount: 0,
          atomCount: 0,
          classificationBuckets: {
            polymer_or_other: 0,
            ligand: 0,
            ion: 0,
            solvent: 0,
            common_solvent: 0,
            unknown: 0,
          },
          chainIds: [],
        };
      }
      for (const residue of residueEntries) {
        const residueNameUpper = String(residue?.resName || '').toUpperCase();
        if (!Object.prototype.hasOwnProperty.call(residueSummaryByName, residueNameUpper)) continue;
        const bucket = residueClassLabel(residue);
        const summary = residueSummaryByName[residueNameUpper];
        summary.residueCount += 1;
        summary.atomCount += Array.isArray(residue.atomIndices) ? residue.atomIndices.length : 0;
        summary.classificationBuckets[bucket] = (summary.classificationBuckets[bucket] || 0) + 1;
        if (residue.chainId && !summary.chainIds.includes(residue.chainId)) {
          summary.chainIds.push(residue.chainId);
        }
      }
      sendWebviewCheckpoint('CHK_PARITY_RES_1_CLASSIFICATION_SUMMARY', {
        referenceCaseId: referenceHarness.caseId,
        isAmberFlow,
        trajectoryExt: debugContext.trajectoryExt || null,
        topologyExt: debugContext.topologyExt || null,
        residueSummaryByName,
      });
    }

    const app = document.getElementById('app');
    const slider = document.getElementById('slider');
    const btnBackground = document.getElementById('btn-background');
    const btnChangeSettings = document.getElementById('btn-change-settings');
    const btnSeqMode = document.getElementById('btn-seq-mode');
    const btnSequenceToggle = document.getElementById('btn-sequence-toggle');
    const btnPanelToggle = document.getElementById('btn-panel-toggle');
    const sequenceRegion = document.getElementById('sequence-region');
    const sequenceResizer = document.getElementById('sequence-resizer');
    const controlPanel = document.getElementById('control-panel');
    const panelResizer = document.getElementById('panel-resizer');
    const sequenceContent = document.getElementById('sequence-content');
    const sequenceSelection = document.getElementById('sequence-selection');
    const localRadiusSlider = document.getElementById('local-radius-slider');
    const localRadiusValue = document.getElementById('local-radius-value');

    sendWebviewCheckpoint('CHK_REOPEN_1_CONTROL_RENDERED', {
      controlPresent: Boolean(btnChangeSettings),
      source: 'viewer_init',
      trajectoryPath: debugContext.trajectoryPath || null,
      topologyPath: debugContext.topologyPath || null,
      loadOptionsSource: debugContext && debugContext.loadOptions ? debugContext.loadOptions.source || null : null,
    });

    function persistUiState() {
      if (!vscode || typeof vscode.setState !== 'function') return;
      vscode.setState({
        backgroundMode,
        sequenceMode,
        localContextRadius,
        sequenceRegionCollapsed,
        sequenceExpandedHeight,
        controlPanelOpen,
        controlPanelExpandedWidth,
      });
    }

    // Filter components out of the base mesh if topology is provided to avoid z-fighting
    const baseAtomIndices = [];
    if (hasTopology) {
      const special = new Set([...caIndices, ...ligandIonIndices]);
      for (let i = 0; i < atomCount; i++) {
        if (hiddenAtomSet.has(i)) continue;
        if (!special.has(i)) baseAtomIndices.push(i);
      }
    } else {
      for (let i = 0; i < atomCount; i++) {
        if (!hiddenAtomSet.has(i)) {
          baseAtomIndices.push(i);
        }
      }
    }

    let useBonds = false;
    if (config.renderMode === 'points+bonds') {
      useBonds = true;
    } else if (config.renderMode === 'auto') {
      // Keep auto mode consistent across system sizes:
      // local-radius overlays drive protein bond visibility for both small and large systems.
      useBonds = false;
    }

    const firstFrame = getFrameData(0) || frames[0];
    if (!firstFrame) {
      document.getElementById('canvas-container').innerHTML = '<p style="color:red;padding:2rem;">No initial frame data found.</p>';
      return;
    }

    let proteinBondPairs = null;
    let proteinBondPos = null;
    if (useBonds) {
      const inferredBonds = inferBonds(atoms, firstFrame);
      proteinBondPairs = hasTopology ? excludeBondPairs(inferredBonds, ligandIonIndices) : inferredBonds;
      proteinBondPos = new Float32Array(proteinBondPairs.length * 3);
    }

    let ligandBondPairs = null;
    let ligandBondPos = null;
    if (hasTopology && ligandIndices.length > 1) {
      ligandBondPairs = inferSubsetBonds(atoms, firstFrame, ligandIndices);
      ligandBondPos = new Float32Array(ligandBondPairs.length * 3);
    }

    // ── Update UI ────────────────────────────────────────────────────────────
    document.getElementById('status-atoms').textContent = `${atomCount} atoms`;
    const statusFrames = document.getElementById('status-frames');
    const sliderPos = document.getElementById('slider');
    const frameCounter = document.getElementById('frame-counter');

    function highestLoadedFrameIndex() {
      let maxIndex = -1;
      for (const index of frameCache.keys()) {
        if (index > maxIndex) maxIndex = index;
      }
      return maxIndex;
    }

    function highestContiguousLoadedFrameIndex() {
      let idx = 0;
      while (idx < totalFrameCount && frameCache.has(idx)) {
        idx += 1;
      }
      return Math.max(0, idx - 1);
    }

    function loadedFrameWindow() {
      return {
        start: 0,
        contiguousEnd: highestContiguousLoadedFrameIndex(),
        highestLoaded: highestLoadedFrameIndex(),
        loadedFrameCount: frameCache.size,
        totalFrameCount,
      };
    }

    function setSliderLimitFromLoadedWindow() {
      if (!supportsFrameRequests) {
        sliderPos.max = Math.max(0, totalFrameCount - 1);
        return;
      }
      const windowState = loadedFrameWindow();
      sliderPos.max = Math.max(0, windowState.contiguousEnd);
    }

    function rawFrameIndexForVirtual(frameIndex) {
      if (rawFrameIndexByVirtual.has(frameIndex)) {
        return rawFrameIndexByVirtual.get(frameIndex);
      }
      return frameIndex * samplingFrameStride;
    }

    function frameCounterText(frameIndex, suffix = '') {
      const virtualCurrent = frameIndex + 1;
      const rawIndex = rawFrameIndexForVirtual(frameIndex);
      const rawText = Number.isFinite(rawIndex) ? ` (raw ${rawIndex + 1}/${rawFrameCount})` : '';
      return `${virtualCurrent} / ${totalFrameCount}${rawText}${suffix}`;
    }

    function refreshFrameStatusText(extraSuffix = '') {
      const windowState = loadedFrameWindow();
      const loadedFrameCount = windowState.loadedFrameCount;
      const framesText = supportsFrameRequests
        ? `${loadedFrameCount} / ${totalFrameCount} sampled frames loaded (window 0-${windowState.contiguousEnd}, stride ${samplingFrameStride})${extraSuffix}`
        : (stats.decimated
          ? `${frames.length} frames (preview, decimated from ${stats.originalFramesCount})`
          : `${frames.length} frames`);
      statusFrames.textContent = framesText;
    }
    refreshFrameStatusText();
    document.getElementById('status-mode').textContent = hasTopology ? "Manual Blend (Structure)" : "Points Only";
    setSliderLimitFromLoadedWindow();
    sliderPos.value = 0;
    localContextRadius = normalizeLocalContextRadius(localContextRadius);
    localRadiusSlider.value = String(localContextRadius);
    localRadiusValue.textContent = formatLocalContextRadius(localContextRadius);

    // ── Three.js scene setup ─────────────────────────────────────────────────
    const canvas = document.getElementById('viewer-canvas');
    const container = document.getElementById('canvas-container');

    const background = VIEWER_THEMES[backgroundMode] ?? VIEWER_THEMES.black;

    function readDevicePixelRatio() {
      return Math.max(window.devicePixelRatio || 1, 1);
    }

    let currentDevicePixelRatio = readDevicePixelRatio();

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
    renderer.setPixelRatio(currentDevicePixelRatio);
    renderer.setClearColor(background.clear, 1);
    container.style.backgroundColor = background.css;
    const supportsAlphaToCoverage = !!(
      renderer.getContext &&
      renderer.getContext().getContextAttributes &&
      renderer.getContext().getContextAttributes().antialias
    );

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
    const drawBufferSize = new THREE.Vector2(1, 1);
    const screenSpaceLineMaterials = [];

    function normalizeLocalContextRadius(value) {
      if (!Number.isFinite(value)) return 6;
      return Math.max(0, Math.min(12, value));
    }

    function formatLocalContextRadius(value) {
      return `${normalizeLocalContextRadius(value).toFixed(1)} A`;
    }

    function lineWidthValue() {
      return LINE_THICKNESS_SCREEN_PX.base;
    }

    function deviceLineWidthValue() {
      return lineWidthValue() * currentDevicePixelRatio;
    }

    function getAttributeArray(attribute) {
      if (!attribute) return null;
      if (attribute.array) return attribute.array;
      if (attribute.data && attribute.data.array) return attribute.data.array;
      return null;
    }

    function configureDynamicInterleavedAttribute(attribute) {
      if (attribute && attribute.data && typeof attribute.data.setUsage === 'function') {
        attribute.data.setUsage(THREE.DynamicDrawUsage);
      }
    }

    function setScreenSpaceLinePositions(geometry, positions) {
      geometry.setPositions(positions);
      configureDynamicInterleavedAttribute(geometry.attributes.instanceStart);
    }

    function setScreenSpaceLineColors(geometry, colors) {
      geometry.setColors(colors);
      configureDynamicInterleavedAttribute(geometry.attributes.instanceColorStart);
    }

    function markScreenSpaceLinePositionsDirty(geometry) {
      if (!geometry) return;
      if (geometry.attributes.instanceStart) geometry.attributes.instanceStart.needsUpdate = true;
      if (geometry.attributes.instanceEnd) geometry.attributes.instanceEnd.needsUpdate = true;
    }

    function markScreenSpaceLineColorsDirty(geometry) {
      if (!geometry) return;
      if (geometry.attributes.instanceColorStart) geometry.attributes.instanceColorStart.needsUpdate = true;
      if (geometry.attributes.instanceColorEnd) geometry.attributes.instanceColorEnd.needsUpdate = true;
    }

    function createScreenSpaceLineMaterial(parameters) {
      const material = new THREE.LineMaterial(Object.assign({}, parameters, {
        linewidth: deviceLineWidthValue(),
        resolution: drawBufferSize.clone(),
      }));
      material.transparent = parameters.transparent !== false;
      material.alphaToCoverage = supportsAlphaToCoverage;
      screenSpaceLineMaterials.push(material);
      return material;
    }

    function syncScreenSpaceLineMaterials() {
      renderer.getDrawingBufferSize(drawBufferSize);
      const lineWidth = deviceLineWidthValue();
      for (let i = 0; i < screenSpaceLineMaterials.length; i++) {
        const material = screenSpaceLineMaterials[i];
        material.resolution.copy(drawBufferSize);
        material.linewidth = lineWidth;
      }
    }

    function createScreenSpaceLineMesh(geometry, material) {
      const mesh = new THREE.LineSegments2(geometry, material);
      mesh.frustumCulled = false;
      return mesh;
    }

    function lineProminenceFactor() {
      return 1;
    }

    function elementColorValue(atomIndex) {
      return elementColor(atoms[atomIndex].element, backgroundMode);
    }

    function atomSceneColorValue(atomIndex) {
      if (useChainColors && caIndexSet.has(atomIndex) && atomToChain[atomIndex] !== undefined) {
        return chainColor(atomToChain[atomIndex], backgroundMode);
      }
      return elementColor(atoms[atomIndex].element, backgroundMode);
    }

    function fillSceneColorBuffer(buffer, indices) {
      for (let i = 0; i < indices.length; i++) {
        const c = new THREE.Color(atomSceneColorValue(indices[i]));
        buffer[i * 3] = c.r;
        buffer[i * 3 + 1] = c.g;
        buffer[i * 3 + 2] = c.b;
      }
    }

    function fillScenePairColorBuffer(buffer, pairs) {
      for (let i = 0; i < pairs.length; i++) {
        const c = new THREE.Color(atomSceneColorValue(pairs[i]));
        buffer[i * 3] = c.r;
        buffer[i * 3 + 1] = c.g;
        buffer[i * 3 + 2] = c.b;
      }
    }

    function fillElementPairColorBuffer(buffer, pairs) {
      for (let i = 0; i < pairs.length; i++) {
        const c = new THREE.Color(elementColorValue(pairs[i]));
        buffer[i * 3] = c.r;
        buffer[i * 3 + 1] = c.g;
        buffer[i * 3 + 2] = c.b;
      }
    }

    function isHydrogenAtom(atomIndex) {
      return atoms[atomIndex].element.toUpperCase() === 'H';
    }

    // ── Geometry Generators ──────────────────────────────────────────────────
    const initBuffer = (indices) => new Float32Array(indices.length * 3);

    const fillColorBuffer = (buffer, indices, mode) => {
      for (let i = 0; i < indices.length; i++) {
        const atomIndex = indices[i];
        const colorValue = mode === 'chain' && useChainColors && atomToChain[atomIndex] !== undefined
          ? chainColor(atomToChain[atomIndex], backgroundMode)
          : elementColor(atoms[atomIndex].element, backgroundMode);
        const c = new THREE.Color(colorValue);
        buffer[i * 3] = c.r; buffer[i * 3 + 1] = c.g; buffer[i * 3 + 2] = c.b;
      }
    };

    const makeColorAttribute = (indices, mode) => {
      const attr = new THREE.BufferAttribute(new Float32Array(indices.length * 3), 3);
      fillColorBuffer(attr.array, indices, mode);
      return attr;
    };

    const applyPos = (indices, source, target) => {
      for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        target[i * 3]     = source[idx * 3];
        target[i * 3 + 1] = source[idx * 3 + 1];
        target[i * 3 + 2] = source[idx * 3 + 2];
      }
    };

    const applyTrace = (pairs, source, target) => {
      for (let i = 0; i < pairs.length; i++) {
        const idx = pairs[i];
        target[i * 3]     = source[idx * 3];
        target[i * 3 + 1] = source[idx * 3 + 1];
        target[i * 3 + 2] = source[idx * 3 + 2];
      }
    };

    const fillPairColorBuffer = (buffer, pairs, mode) => {
      for (let i = 0; i < pairs.length; i++) {
        const atomIndex = pairs[i];
        const colorValue = mode === 'chain' && useChainColors && atomToChain[atomIndex] !== undefined
          ? chainColor(atomToChain[atomIndex], backgroundMode)
          : elementColor(atoms[atomIndex].element, backgroundMode);
        const c = new THREE.Color(colorValue);
        buffer[i * 3] = c.r;
        buffer[i * 3 + 1] = c.g;
        buffer[i * 3 + 2] = c.b;
      }
    };

    function pushSolidPairColor(colors, colorValue) {
      const c = new THREE.Color(colorValue);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }

    function pushElementPairColor(colors, atomA, atomB) {
      const colorA = new THREE.Color(elementColorValue(atomA));
      const colorB = new THREE.Color(elementColorValue(atomB));
      colors.push(colorA.r, colorA.g, colorA.b, colorB.r, colorB.g, colorB.b);
    }

    // Allocate frame buffers
    const posBase = initBuffer(baseAtomIndices);
    const posCa = initBuffer(caIndices);
    const posLigands = initBuffer(ligandIonIndices);
    const posTrace = new Float32Array(caLinePairs.length * 3);
    const traceColors = useChainColors ? new Float32Array(caLinePairs.length * 3) : null;

    // Materials
    const matBase = new THREE.PointsMaterial({ size: 0.4, vertexColors: true, transparent: true, opacity: 1.0, sizeAttenuation: true });
    const matCa = new THREE.PointsMaterial({ size: 0.5, vertexColors: true, transparent: true, opacity: 1.0, sizeAttenuation: true });
    const matLigands = new THREE.PointsMaterial({ size: 0.6, vertexColors: true, transparent: true, opacity: 1.0, sizeAttenuation: true });
    const matTrace = createScreenSpaceLineMaterial(
      useChainColors
        ? { vertexColors: true, transparent: true, opacity: 0.38 }
        : { color: background.proteinTrace, transparent: true, opacity: 0.38 }
    );

    // Build geometries
    const geoBase = new THREE.BufferGeometry();
    const attrBase = new THREE.BufferAttribute(posBase, 3).setUsage(THREE.DynamicDrawUsage);
    const attrBaseColor = makeColorAttribute(baseAtomIndices, 'element');
    geoBase.setAttribute('position', attrBase);
    geoBase.setAttribute('color', attrBaseColor);

    let attrCa, attrCaColor, attrLigands, attrLigandsColor, attrSelectedResidue;
    let geoTrace = null;
    let traceMesh = null;
    let attrTraceColor = null;
    let geoProteinBonds = null;
    let proteinBondMesh = null;
    let attrProteinBondColor = null;
    let geoLigandBonds = null;
    let ligandBondMesh = null;
    let attrLocalContextBondColor = null;
    let attrLocalContextIon = null;
    const raycastMeshes = [];

    const meshBase = new THREE.Points(geoBase, matBase);
    meshBase.userData.globalIndices = baseAtomIndices;
    meshBase.renderOrder = 1;
    scene.add(meshBase);
    raycastMeshes.push(meshBase);

    let matProteinBonds = null;
    if (useBonds) {
      const proteinBondColors = new Float32Array(proteinBondPairs.length * 3);
      matProteinBonds = createScreenSpaceLineMaterial({ vertexColors: true, transparent: true, opacity: 0.62 });
      geoProteinBonds = new THREE.LineSegmentsGeometry();
      setScreenSpaceLinePositions(geoProteinBonds, proteinBondPos);
      fillPairColorBuffer(proteinBondColors, proteinBondPairs, 'element');
      setScreenSpaceLineColors(geoProteinBonds, proteinBondColors);
      attrProteinBondColor = geoProteinBonds.attributes.instanceColorStart;
      applyTrace(proteinBondPairs, firstFrame, proteinBondPos);
      proteinBondMesh = createScreenSpaceLineMesh(geoProteinBonds, matProteinBonds);
      proteinBondMesh.renderOrder = 1;
      scene.add(proteinBondMesh);
    }

    let matLigandBonds = null;
    if (ligandBondPairs && ligandBondPairs.length > 0) {
      matLigandBonds = createScreenSpaceLineMaterial({ color: background.ligandBond, transparent: true, opacity: 0.95 });
      geoLigandBonds = new THREE.LineSegmentsGeometry();
      setScreenSpaceLinePositions(geoLigandBonds, ligandBondPos);
      applyTrace(ligandBondPairs, firstFrame, ligandBondPos);
      ligandBondMesh = createScreenSpaceLineMesh(geoLigandBonds, matLigandBonds);
      ligandBondMesh.renderOrder = 1;
      scene.add(ligandBondMesh);
    }

    if (hasTopology) {
      const geoCa = new THREE.BufferGeometry();
      attrCa = new THREE.BufferAttribute(posCa, 3).setUsage(THREE.DynamicDrawUsage);
      attrCaColor = makeColorAttribute(caIndices, 'chain');
      geoCa.setAttribute('position', attrCa);
      geoCa.setAttribute('color', attrCaColor);
      const meshCa = new THREE.Points(geoCa, matCa);
      meshCa.userData.globalIndices = caIndices;
      meshCa.renderOrder = 1;
      scene.add(meshCa);
      raycastMeshes.push(meshCa);

      const geoLigands = new THREE.BufferGeometry();
      attrLigands = new THREE.BufferAttribute(posLigands, 3).setUsage(THREE.DynamicDrawUsage);
      attrLigandsColor = new THREE.BufferAttribute(new Float32Array(ligandIonIndices.length * 3), 3);
      fillColorBuffer(attrLigandsColor.array, ligandIonIndices, 'element');
      geoLigands.setAttribute('position', attrLigands);
      geoLigands.setAttribute('color', attrLigandsColor);
      const meshLigands = new THREE.Points(geoLigands, matLigands);
      meshLigands.userData.globalIndices = ligandIonIndices;
      meshLigands.renderOrder = 1;
      scene.add(meshLigands);
      raycastMeshes.push(meshLigands);

      geoTrace = new THREE.LineSegmentsGeometry();
      setScreenSpaceLinePositions(geoTrace, posTrace);
      if (traceColors) {
        fillPairColorBuffer(traceColors, caLinePairs, 'chain');
        setScreenSpaceLineColors(geoTrace, traceColors);
        attrTraceColor = geoTrace.attributes.instanceColorStart;
      }
      traceMesh = createScreenSpaceLineMesh(geoTrace, matTrace);
      traceMesh.renderOrder = 1;
      scene.add(traceMesh);
    }

    let selectedResiduePos = new Float32Array(0);
    let selectedContextPos = new Float32Array(0);
    let selectedContextColors = new Float32Array(0);
    let selectedBondPos = new Float32Array(0);
    let localContextBondPos = new Float32Array(0);
    let localContextBondColors = new Float32Array(0);
    let localContextIonPos = new Float32Array(0);
    let localContextIonColors = new Float32Array(0);
    const geoSelectedResidue = new THREE.BufferGeometry();
    attrSelectedResidue = new THREE.BufferAttribute(selectedResiduePos, 3).setUsage(THREE.DynamicDrawUsage);
    geoSelectedResidue.setAttribute('position', attrSelectedResidue);
    const matSelectedResidue = new THREE.PointsMaterial({
      size: 1.35,
      color: background.residueHighlight,
      transparent: true,
      opacity: 0.58,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const meshSelectedResidue = new THREE.Points(geoSelectedResidue, matSelectedResidue);
    meshSelectedResidue.frustumCulled = false;
    meshSelectedResidue.renderOrder = 4;
    meshSelectedResidue.userData.globalIndices = [];
    meshSelectedResidue.visible = false;
    scene.add(meshSelectedResidue);
    raycastMeshes.push(meshSelectedResidue);

    const geoSelectedContext = new THREE.BufferGeometry();
    let attrSelectedContext = new THREE.BufferAttribute(selectedContextPos, 3).setUsage(THREE.DynamicDrawUsage);
    let attrSelectedContextColor = new THREE.BufferAttribute(selectedContextColors, 3);
    geoSelectedContext.setAttribute('position', attrSelectedContext);
    geoSelectedContext.setAttribute('color', attrSelectedContextColor);
    const matSelectedContext = new THREE.PointsMaterial({
      size: 1.2,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const meshSelectedContext = new THREE.Points(geoSelectedContext, matSelectedContext);
    meshSelectedContext.userData.globalIndices = [];
    meshSelectedContext.frustumCulled = false;
    meshSelectedContext.renderOrder = 5;
    meshSelectedContext.visible = false;
    scene.add(meshSelectedContext);

    const geoSelectedResidueBonds = new THREE.LineSegmentsGeometry();
    setScreenSpaceLinePositions(geoSelectedResidueBonds, selectedBondPos);
    const matSelectedResidueBonds = createScreenSpaceLineMaterial({
      color: background.proteinTrace,
      transparent: true,
      opacity: 0.98,
      depthTest: false,
      depthWrite: false,
    });
    const meshSelectedResidueBonds = createScreenSpaceLineMesh(geoSelectedResidueBonds, matSelectedResidueBonds);
    meshSelectedResidueBonds.frustumCulled = false;
    meshSelectedResidueBonds.renderOrder = 3;
    meshSelectedResidueBonds.visible = false;
    scene.add(meshSelectedResidueBonds);

    const geoLocalContextBonds = new THREE.LineSegmentsGeometry();
    setScreenSpaceLinePositions(geoLocalContextBonds, localContextBondPos);
    setScreenSpaceLineColors(geoLocalContextBonds, localContextBondColors);
    attrLocalContextBondColor = geoLocalContextBonds.attributes.instanceColorStart;
    const matLocalContextBonds = createScreenSpaceLineMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
    });
    const meshLocalContextBonds = createScreenSpaceLineMesh(geoLocalContextBonds, matLocalContextBonds);
    meshLocalContextBonds.frustumCulled = false;
    meshLocalContextBonds.renderOrder = 2;
    meshLocalContextBonds.visible = false;
    scene.add(meshLocalContextBonds);

    const geoLocalContextIons = new THREE.BufferGeometry();
    attrLocalContextIon = new THREE.BufferAttribute(localContextIonPos, 3).setUsage(THREE.DynamicDrawUsage);
    let attrLocalContextIonColor = new THREE.BufferAttribute(localContextIonColors, 3);
    geoLocalContextIons.setAttribute('position', attrLocalContextIon);
    geoLocalContextIons.setAttribute('color', attrLocalContextIonColor);
    const matLocalContextIons = new THREE.PointsMaterial({
      size: 1.2,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const meshLocalContextIons = new THREE.Points(geoLocalContextIons, matLocalContextIons);
    meshLocalContextIons.frustumCulled = false;
    meshLocalContextIons.renderOrder = 3;
    meshLocalContextIons.visible = false;
    scene.add(meshLocalContextIons);

    let selectedResidueId = null;
    let selectedResidueButton = null;
    let selectedResidueIndices = [];
    let selectedResidueBondPairs = new Int32Array(0);
    let amberSelectionOverlayCheckpointPending = false;
    let amberSelectionLastVisibility = null;
    let parityFocusState = null;
    let deselectCameraCheckpointPending = null;
    let deselectCycleCount = 0;
    let lastDeselectOverviewDistance = null;
    const sequenceButtons = [];
    let defaultOverviewState = null;
    let localMonotonicDebugState = {
      selectedResidueId: null,
      frame: -1,
      radius: -1,
      pairKeys: new Set(),
      residueSet: new Set(),
      pairMetadataByKey: new Map(),
    };

    function resetLocalMonotonicDebugState() {
      localMonotonicDebugState = {
        selectedResidueId: null,
        frame: -1,
        radius: -1,
        pairKeys: new Set(),
        residueSet: new Set(),
        pairMetadataByKey: new Map(),
      };
    }

    function roundNumber(value, digits = 4) {
      if (!Number.isFinite(value)) return null;
      const factor = Math.pow(10, digits);
      return Math.round(value * factor) / factor;
    }

    function vectorToObject(vector) {
      if (!vector) {
        return { x: null, y: null, z: null };
      }
      return {
        x: roundNumber(vector.x),
        y: roundNumber(vector.y),
        z: roundNumber(vector.z),
      };
    }

    function quaternionToObject(quaternion) {
      if (!quaternion) {
        return { x: null, y: null, z: null, w: null };
      }
      return {
        x: roundNumber(quaternion.x),
        y: roundNumber(quaternion.y),
        z: roundNumber(quaternion.z),
        w: roundNumber(quaternion.w),
      };
    }

    function cameraForwardVector() {
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      return direction.normalize();
    }

    function cameraStateSnapshot() {
      return {
        position: vectorToObject(camera.position),
        target: vectorToObject(orbitTarget),
        up: vectorToObject(camera.up),
        quaternion: quaternionToObject(camera.quaternion),
        forward: vectorToObject(cameraForwardVector()),
        distanceToTarget: roundNumber(camera.position.distanceTo(orbitTarget)),
      };
    }

    function angleBetweenVectorsDeg(a, b) {
      if (!a || !b) return null;
      const dot = Math.max(-1, Math.min(1, a.dot(b)));
      return roundNumber(Math.acos(dot) * (180 / Math.PI));
    }

    function countSequenceGroupsFromDom() {
      return sequenceContent.querySelectorAll('.chain-row').length;
    }

    function countMainSequenceGroupsFromDom() {
      return sequenceContent.querySelectorAll('.chain-row:not(.is-common-solvent-row)').length;
    }

    function countCommonSolventRowsFromDom() {
      return sequenceContent.querySelectorAll('.chain-row.is-common-solvent-row').length;
    }

    function countSequenceEntriesFromDom() {
      return sequenceContent.querySelectorAll('.sequence-residue').length;
    }

    function residueClassLabel(residue) {
      if (!residue) return 'unknown';
      if (residue.isCommonSolvent) return 'common_solvent';
      if (residue.isSolvent) return 'solvent';
      if (residue.isIon) return 'ion';
      if (residue.isLigand) return 'ligand';
      return 'polymer_or_other';
    }

    function isCommonSolventResidue(resId) {
      const residue = residueEntries[resId];
      return Boolean(residue && residue.isCommonSolvent);
    }

    function countLigandEntriesFromDom() {
      return sequenceContent.querySelectorAll('.sequence-residue.is-ligand').length;
    }

    function countIonEntriesFromDom() {
      return sequenceContent.querySelectorAll('.sequence-residue.is-ion').length;
    }

    function emitReferenceViewerInitCapture() {
      if (!referenceHarness.enabled) return;
      sendWebviewCheckpoint('CHK_REF_VIEWER_INIT_CAPTURE', {
        referenceCaseId: referenceHarness.caseId,
        hasTopology: Boolean(hasTopology),
        topologyPresent: Boolean(topology),
        residueNavigationEnabled: Boolean(hasTopology && residueEntries.length > 0),
        sequenceGroupCount: countSequenceGroupsFromDom(),
        sequenceEntryCount: countSequenceEntriesFromDom(),
        ligandNavigationEntryCount: countLigandEntriesFromDom(),
        ionNavigationEntryCount: countIonEntriesFromDom(),
        ligandsAppearInNavigationUI: countLigandEntriesFromDom() > 0,
        caTraceMeshExists: Boolean(traceMesh),
        caTraceVisible: Boolean(traceMesh && traceMesh.visible && matTrace && matTrace.visible),
        caTraceLinePairCount: Math.floor(caLinePairs.length / 2),
        caIndicesLength: caIndices.length,
        trajectoryTotalFrameCount: totalFrameCount,
        trajectoryLoadedFrameCount: frameCache.size,
        trajectorySupportsFrameRequests: supportsFrameRequests,
        sliderStates: {
          frameSliderEnabled: slider ? !slider.disabled : null,
          fpsSliderEnabled: document.getElementById('fps-slider') ? !document.getElementById('fps-slider').disabled : null,
          abstractionSliderEnabled: aggroSlider ? !aggroSlider.disabled : null,
          localRadiusSliderEnabled: localRadiusSlider ? !localRadiusSlider.disabled : null,
        },
      });
    }

    function chooseReferenceResidues() {
      const polymerResidueIds = [];
      const ligandResidueIds = [];
      const ionResidueIds = [];
      const customResiduesByName = {};
      const trackedCustomNames = new Set(['AS4', 'ANP', 'ZNB', 'MG']);
      for (let i = 0; i < residueEntries.length; i++) {
        const residue = residueEntries[i];
        const residueNameUpper = String(residue?.resName || '').toUpperCase();
        if (trackedCustomNames.has(residueNameUpper) && customResiduesByName[residueNameUpper] === undefined) {
          customResiduesByName[residueNameUpper] = i;
        }
        if (residue.isIon) {
          ionResidueIds.push(i);
        } else if (residue.isLigand) {
          ligandResidueIds.push(i);
        } else if (!residue.isSolvent && !residue.isCommonSolvent) {
          polymerResidueIds.push(i);
        }
      }

      const normalProteinResidueId = polymerResidueIds.length > 0
        ? polymerResidueIds[Math.floor(polymerResidueIds.length / 2)]
        : null;
      const terminalResidueId = polymerResidueIds.length > 0
        ? polymerResidueIds[polymerResidueIds.length - 1]
        : null;
      const ligandResidueId = ligandResidueIds.length > 0 ? ligandResidueIds[0] : null;
      const ionResidueId = ionResidueIds.length > 0 ? ionResidueIds[0] : null;

      return {
        normalProteinResidueId,
        terminalResidueId,
        ligandResidueId,
        ionResidueId,
        customResiduesByName,
      };
    }

    async function waitForCameraSettle() {
      const timeoutMs = Math.max(200, referenceHarness.cameraSettleTimeoutMs);
      const start = performance.now();
      while (cameraTween && (performance.now() - start) < timeoutMs) {
        await sleep(40);
      }
      await sleep(120);
    }

    function captureInteractionSnapshot(interactionType, residueId) {
      const residue = (residueId !== null && residueEntries[residueId]) ? residueEntries[residueId] : null;
      const residueCompactLabel = residue ? residueDescriptorCompact(residue) : null;
      const expectedSelectionText = residueCompactLabel ? `Focused ${residueCompactLabel}` : null;
      const selectionText = sequenceSelection.textContent || '';
      const selectedBondCount = Math.floor(selectedResidueBondPairs.length / 2);
      const localContextBondCount = meshLocalContextBonds.visible ? Math.floor(localContextBondPos.length / 6) : 0;
      const selectedAtomOverlayVisible = Boolean(meshSelectedResidue.visible && selectedResidueIndices.length > 0);
      const selectedBondOverlayVisible = Boolean(meshSelectedResidueBonds.visible && selectedBondCount > 0);
      const localContextOverlayVisible = Boolean(meshLocalContextBonds.visible);
      const localContextIonOverlayVisible = Boolean(meshLocalContextIons.visible);
      const currentCameraState = cameraStateSnapshot();
      const currentForward = cameraForwardVector();

      const snapshot = {
        referenceCaseId: referenceHarness.caseId,
        interactionType,
        selectedResidueId: residueId,
        selectedResidueName: residue ? residue.resName : null,
        selectedResidueLabel: residueCompactLabel,
        selectedResidueAtomCount: selectedResidueIndices.length,
        selectedBondCount,
        localContextBondCount,
        selectedAtomOverlayVisible,
        selectedBondOverlayVisible,
        localContextOverlayVisible,
        localContextIonOverlayVisible,
        cameraTarget: currentCameraState.target,
        cameraPosition: currentCameraState.position,
        cameraQuaternion: currentCameraState.quaternion,
        cameraForward: currentCameraState.forward,
        cameraDistanceToTarget: currentCameraState.distanceToTarget,
        sequenceUiHighlightedResidue: Boolean(selectedResidueButton && selectedResidueButton.classList.contains('is-selected')),
        sequenceUiSelectionText: selectionText,
        expectedSequenceSelectionText: expectedSelectionText,
        sequenceUiUpdatedCorrectly: expectedSelectionText ? selectionText === expectedSelectionText : false,
      };

      if (parityCheckpointsEnabled && residue) {
        sendWebviewCheckpoint('CHK_PARITY_SEL_5_LOCAL_BOND_COUNT', {
          referenceCaseId: referenceHarness.caseId,
          interactionType,
          selectedResidueId: residueId,
          selectedResidueName: residue.resName,
          localContextBondCount,
          localContextOverlayVisible,
          localContextIonOverlayVisible,
        });
        sendWebviewCheckpoint('CHK_PARITY_SEL_6_SELECTED_ATOM_VISIBLE', {
          referenceCaseId: referenceHarness.caseId,
          interactionType,
          selectedResidueId: residueId,
          selectedResidueName: residue.resName,
          selectedAtomCount: selectedResidueIndices.length,
          selectedAtomOverlayVisible,
        });
        sendWebviewCheckpoint('CHK_PARITY_SEL_7_SELECTED_BOND_VISIBLE', {
          referenceCaseId: referenceHarness.caseId,
          interactionType,
          selectedResidueId: residueId,
          selectedResidueName: residue.resName,
          selectedBondCount,
          selectedBondOverlayVisible,
        });
        sendWebviewCheckpoint('CHK_PARITY_SEL_8_LOCAL_VISIBLE', {
          referenceCaseId: referenceHarness.caseId,
          interactionType,
          selectedResidueId: residueId,
          selectedResidueName: residue.resName,
          localContextOverlayVisible,
          localContextIonOverlayVisible,
          localContextBondCount,
        });
      }
      if (dcdNcParityFormatPrefix && residue) {
        emitDcdNcParityCheckpoint(5, 'LOCAL_BOND_COUNT', {
          interactionType,
          selectedResidueId: residueId,
          selectedResidueName: residue.resName,
          localContextBondCount,
          localContextOverlayVisible,
          localContextIonOverlayVisible,
        });
        emitDcdNcParityCheckpoint(6, 'SELECTED_VISIBLE', {
          interactionType,
          selectedResidueId: residueId,
          selectedResidueName: residue.resName,
          selectedAtomCount: selectedResidueIndices.length,
          selectedBondCount,
          selectedAtomOverlayVisible,
          selectedBondOverlayVisible,
          localContextOverlayVisible,
          localContextIonOverlayVisible,
        });
      }

      if (parityCheckpointsEnabled && parityFocusState && parityFocusState.residueId === residueId) {
        const targetError = roundNumber(orbitTarget.distanceTo(parityFocusState.focusTarget));
        const preForward = parityFocusState.preForward;
        const orientationDeltaFromPreDeg = preForward ? angleBetweenVectorsDeg(preForward, currentForward) : null;
        const defaultForward = defaultOverviewState
          ? new THREE.Vector3().subVectors(defaultOverviewState.target, defaultOverviewState.position).normalize()
          : null;
        const orientationDeltaToDefaultDeg = defaultForward ? angleBetweenVectorsDeg(defaultForward, currentForward) : null;
        const resetOrReorientDetected = Boolean(
          (targetError !== null && targetError > 1.0) ||
          (
            orientationDeltaToDefaultDeg !== null &&
            orientationDeltaFromPreDeg !== null &&
            orientationDeltaToDefaultDeg < 6 &&
            orientationDeltaFromPreDeg > 20
          )
        );

        sendWebviewCheckpoint('CHK_PARITY_CAM_3_POST_FOCUS_CAMERA_STATE', {
          referenceCaseId: referenceHarness.caseId,
          interactionType,
          selectedResidueId: residueId,
          selectedResidueName: residue.resName,
          postFocus: currentCameraState,
          expectedFocusTarget: vectorToObject(parityFocusState.focusTarget),
          targetError,
        });
        sendWebviewCheckpoint('CHK_PARITY_CAM_4_CAMERA_DISTANCE', {
          referenceCaseId: referenceHarness.caseId,
          interactionType,
          selectedResidueId: residueId,
          selectedResidueName: residue.resName,
          cameraDistanceToTarget: currentCameraState.distanceToTarget,
          requestedMinDistance: parityFocusState.minDistance,
          focusRadius: parityFocusState.focusRadius,
          boundRadius: parityFocusState.boundRadius,
        });
        sendWebviewCheckpoint('CHK_PARITY_CAM_5_CAMERA_ORIENTATION', {
          referenceCaseId: referenceHarness.caseId,
          interactionType,
          selectedResidueId: residueId,
          selectedResidueName: residue.resName,
          orientationDeltaFromPreDeg,
          orientationDeltaToDefaultDeg,
          preForward: vectorToObject(parityFocusState.preForward),
          postForward: vectorToObject(currentForward),
          preQuaternion: quaternionToObject(parityFocusState.preQuaternion),
          postQuaternion: currentCameraState.quaternion,
        });
        sendWebviewCheckpoint('CHK_PARITY_CAM_6_RESET_OR_REORIENT_DETECTED', {
          referenceCaseId: referenceHarness.caseId,
          interactionType,
          selectedResidueId: residueId,
          selectedResidueName: residue.resName,
          resetOrReorientDetected,
          targetError,
          orientationDeltaFromPreDeg,
          orientationDeltaToDefaultDeg,
        });
      }

      return snapshot;
    }

    async function runReferenceInteractionsCapture() {
      if (!referenceHarness.enabled || !referenceHarness.captureInteractions) {
        return;
      }

      const selectionPlan = chooseReferenceResidues();
      sendWebviewCheckpoint('CHK_REF_INTERACTION_PLAN', {
        referenceCaseId: referenceHarness.caseId,
        selectionPlan,
      });

      const interactions = [];
      const stepDelay = Math.max(0, referenceHarness.interactionStepDelayMs);

      async function runStep(interactionType, residueId) {
        if (residueId === null || residueId === undefined || !residueEntries[residueId]) {
          const skipped = {
            referenceCaseId: referenceHarness.caseId,
            interactionType,
            skipped: true,
            reason: 'residue_not_available',
          };
          interactions.push(skipped);
          sendWebviewCheckpoint('CHK_REF_INTERACTION_STEP', skipped);
          return;
        }

        focusResidueById(residueId, 'reference_autodrive');
        await waitForCameraSettle();
        const snapshot = captureInteractionSnapshot(interactionType, residueId);
        interactions.push(snapshot);
        sendWebviewCheckpoint('CHK_REF_INTERACTION_STEP', snapshot);
        if (stepDelay > 0) {
          await sleep(stepDelay);
        }
      }

      await runStep('normal_protein_residue', selectionPlan.normalProteinResidueId);
      await runStep('terminal_residue', selectionPlan.terminalResidueId);
      await runStep('ligand_residue', selectionPlan.ligandResidueId);
      await runStep('ion_residue', selectionPlan.ionResidueId);
      const customNames = ['AS4', 'ANP', 'ZNB', 'MG'];
      for (const customName of customNames) {
        const residueId = selectionPlan.customResiduesByName
          ? selectionPlan.customResiduesByName[customName]
          : undefined;
        await runStep(`custom_${customName.toLowerCase()}_residue`, residueId);
      }

      sendWebviewCheckpoint('CHK_REF_INTERACTIONS_CAPTURE', {
        referenceCaseId: referenceHarness.caseId,
        interactions,
      });
    }

    function projectResidueCenterToClientPoint(resId) {
      const pos = getFrameData(currentFrame);
      if (!pos) return null;
      const residue = residueEntries[resId];
      if (!residue) return null;
      const displayAtoms = residueDisplayAtomIndices[resId] || getDisplayAtomIndices(residue.atomIndices);
      const atomIndex = displayAtoms.length > 0 ? displayAtoms[0] : (residue.atomIndices[0] ?? null);
      if (atomIndex === null || atomIndex === undefined) return null;
      const rect = canvas.getBoundingClientRect();
      const point = new THREE.Vector3(
        pos[atomIndex * 3],
        pos[atomIndex * 3 + 1],
        pos[atomIndex * 3 + 2],
      );
      const ndc = point.clone().project(camera);
      return {
        clientX: rect.left + ((ndc.x + 1) * 0.5 * rect.width),
        clientY: rect.top + ((1 - ndc.y) * 0.5 * rect.height),
        ndc: vectorToObject(ndc),
        atomIndex,
        point: vectorToObject(point),
      };
    }

    async function runDcdNcSequenceClickParityProbe() {
      if (!dcdNcParityProbeEnabled) {
        return;
      }

      const selectionPlan = chooseReferenceResidues();
      const ligandProbeResidueId = selectionPlan.ligandResidueId
        ?? (selectionPlan.customResiduesByName ? (
          selectionPlan.customResiduesByName.ANP
          ?? selectionPlan.customResiduesByName.ZNB
          ?? null
        ) : null);
      const ionProbeResidueId = selectionPlan.ionResidueId
        ?? (selectionPlan.customResiduesByName ? (selectionPlan.customResiduesByName.MG ?? null) : null);

      const probeSteps = [
        { role: 'protein', residueId: selectionPlan.normalProteinResidueId },
        { role: 'ligand', residueId: ligandProbeResidueId },
        { role: 'ion', residueId: ionProbeResidueId },
      ];

      emitDcdNcParityCheckpoint('SEQ', 'PLAN', {
        trajectoryExt,
        selectionPlan,
        probeSteps,
      });

      for (const step of probeSteps) {
        const residue = step.residueId !== null && step.residueId !== undefined
          ? residueEntries[step.residueId] || null
          : null;
        if (!residue) {
          emitDcdNcParityCheckpoint('SEQ', 'STEP', {
            role: step.role,
            residueId: step.residueId ?? null,
            skipped: true,
            reason: 'residue_not_available',
          });
          continue;
        }

        const button = sequenceButtons[step.residueId] || null;
        if (button && typeof button.click === 'function') {
          button.click();
        } else {
          focusResidueById(step.residueId, 'sequence_click_fallback');
        }
        await waitForCameraSettle();
        const sequenceSnapshot = captureInteractionSnapshot(`sequence_click_${step.role}`, selectedResidueId);
        emitDcdNcParityCheckpoint('SEQ', 'STEP', {
          role: step.role,
          mode: 'sequence_click',
          requestedResidueId: step.residueId,
          requestedResidueName: residue.resName,
          ...sequenceSnapshot,
        });

        const clickPoint = projectResidueCenterToClientPoint(step.residueId);
        if (!clickPoint) {
          emitDcdNcParityCheckpoint('SEQ', 'STEP', {
            role: step.role,
            mode: 'scene_click',
            requestedResidueId: step.residueId,
            requestedResidueName: residue.resName,
            skipped: true,
            reason: 'projection_unavailable',
          });
          continue;
        }
        handleSceneClick(clickPoint.clientX, clickPoint.clientY);
        await waitForCameraSettle();
        const sceneSnapshot = captureInteractionSnapshot(`scene_click_${step.role}`, selectedResidueId);
        emitDcdNcParityCheckpoint('SEQ', 'STEP', {
          role: step.role,
          mode: 'scene_click',
          requestedResidueId: step.residueId,
          requestedResidueName: residue.resName,
          projection: clickPoint,
          ...sceneSnapshot,
        });
      }
    }

    function applyLineAppearance() {
      const width = deviceLineWidthValue();
      const emphasis = lineProminenceFactor();

      matTrace.linewidth = width;
      matTrace.opacity = 0.86 + (emphasis * 0.14);

      if (matProteinBonds) {
        matProteinBonds.linewidth = width;
        matProteinBonds.opacity = 0.93 + (emphasis * 0.07);
      }

      if (matLigandBonds) {
        matLigandBonds.linewidth = width;
        matLigandBonds.opacity = 0.97 + (emphasis * 0.03);
      }

      matSelectedResidueBonds.linewidth = width * 1.35;
      matSelectedResidueBonds.opacity = 1.0;
      matLocalContextBonds.linewidth = width * 1.15;
      matLocalContextBonds.opacity = 0.98 + (emphasis * 0.02);
    }

    function renderScene() {
      renderer.render(scene, camera);
    }

    function applyViewerTheme() {
      const theme = VIEWER_THEMES[backgroundMode] ?? VIEWER_THEMES.black;
      renderer.setClearColor(theme.clear, 1);
      container.style.backgroundColor = theme.css;
      btnBackground.textContent = backgroundMode === 'white' ? 'Bg: White' : 'Bg: Black';
      btnBackground.title = `Switch to ${backgroundMode === 'white' ? 'black' : 'white'} background`;

      fillColorBuffer(attrBaseColor.array, baseAtomIndices, 'element');
      attrBaseColor.needsUpdate = true;

      if (attrCaColor) {
        fillColorBuffer(attrCaColor.array, caIndices, 'chain');
        attrCaColor.needsUpdate = true;
      }

      if (attrLigandsColor) {
        fillColorBuffer(attrLigandsColor.array, ligandIonIndices, 'element');
        attrLigandsColor.needsUpdate = true;
      }

      if (attrTraceColor) {
        fillPairColorBuffer(getAttributeArray(attrTraceColor), caLinePairs, 'chain');
        markScreenSpaceLineColorsDirty(geoTrace);
      } else {
        matTrace.color.setHex(theme.proteinTrace);
      }

      if (attrProteinBondColor) {
        fillPairColorBuffer(getAttributeArray(attrProteinBondColor), proteinBondPairs, 'element');
        markScreenSpaceLineColorsDirty(geoProteinBonds);
      }

      if (matLigandBonds) {
        matLigandBonds.color.setHex(theme.ligandBond);
      }

      matSelectedResidue.color.setHex(theme.residueHighlight);
      matSelectedResidueBonds.color.setHex(selectedResidueBondColorValue());
      applyLineAppearance();
      const currentFramePos = getFrameData(currentFrame);
      if (selectedResidueId !== null && currentFramePos) {
        updateSelectedResidueOverlay(currentFramePos);
        updateSelectedResidueBondOverlay(currentFramePos);
        rebuildLocalContextOverlay(currentFramePos);
      }
      refreshSequenceTheme();
      persistUiState();
    }

    function sequenceChainCss(chainIndex) {
      if (useChainColors) return chainColorCss(chainIndex, backgroundMode);
      const theme = VIEWER_THEMES[backgroundMode] ?? VIEWER_THEMES.black;
      return colorHexCss(theme.proteinTrace);
    }

    function updateSequenceSelectionText() {
      if (selectedResidueId === null || !residueEntries[selectedResidueId]) {
        sequenceSelection.textContent = hasTopology
          ? 'Click a residue to focus the view'
          : 'Sequence navigation becomes available when topology metadata is available (self-contained .pdb/.gro or a companion topology file).';
        return;
      }
      sequenceSelection.textContent = `Focused ${residueDescriptorCompact(residueEntries[selectedResidueId])}`;
    }

    function updateSelectedResidueOverlay(pos) {
      if (selectedResidueId === null || selectedResidueIndices.length === 0) {
        meshSelectedResidue.visible = false;
        meshSelectedContext.visible = false;
        return;
      }

      const requiredLength = selectedResidueIndices.length * 3;
      if (selectedResiduePos.length !== requiredLength) {
        selectedResiduePos = new Float32Array(requiredLength);
        attrSelectedResidue = new THREE.BufferAttribute(selectedResiduePos, 3).setUsage(THREE.DynamicDrawUsage);
        geoSelectedResidue.setAttribute('position', attrSelectedResidue);
      }
      if (selectedContextPos.length !== requiredLength) {
        selectedContextPos = new Float32Array(requiredLength);
        selectedContextColors = new Float32Array(requiredLength);
        attrSelectedContext = new THREE.BufferAttribute(selectedContextPos, 3).setUsage(THREE.DynamicDrawUsage);
        attrSelectedContextColor = new THREE.BufferAttribute(selectedContextColors, 3);
        geoSelectedContext.setAttribute('position', attrSelectedContext);
        geoSelectedContext.setAttribute('color', attrSelectedContextColor);
      }

      applyPos(selectedResidueIndices, pos, selectedResiduePos);
      applyPos(selectedResidueIndices, pos, selectedContextPos);
      fillSceneColorBuffer(selectedContextColors, selectedResidueIndices);
      attrSelectedResidue.needsUpdate = true;
      attrSelectedContext.needsUpdate = true;
      attrSelectedContextColor.needsUpdate = true;
      meshSelectedResidue.visible = true;
      meshSelectedContext.visible = true;
    }

    function getDisplayAtomIndices(atomIndices) {
      const visibleOnly = [];
      const display = [];
      for (let i = 0; i < atomIndices.length; i++) {
        const atomIndex = atomIndices[i];
        if (hiddenAtomSet.has(atomIndex)) continue;
        visibleOnly.push(atomIndex);
        if (!isHydrogenAtom(atomIndex)) {
          display.push(atomIndex);
        }
      }
      if (display.length > 0) return display;
      return visibleOnly;
    }

    const residueDisplayAtomIndices = hasTopology
      ? residueEntries.map((residue) => getDisplayAtomIndices(residue.atomIndices))
      : [];

    const bondCatalog = [];
    const residueBondLookup = hasTopology ? residueEntries.map(() => []) : [];
    const residueInternalBondCache = hasTopology ? residueEntries.map(() => null) : [];

    function appendBondCatalogEntries(pairSource) {
      if (!hasTopology || !pairSource || pairSource.length === 0) return;
      for (let i = 0; i < pairSource.length; i += 2) {
        const a = pairSource[i];
        const b = pairSource[i + 1];
        const resA = atomToResidue[a];
        const resB = atomToResidue[b];
        if (resA === undefined || resB === undefined) continue;

        const bondIndex = bondCatalog.length;
        bondCatalog.push({ a, b, resA, resB });
        residueBondLookup[resA].push(bondIndex);
        if (resB !== resA) {
          residueBondLookup[resB].push(bondIndex);
        }
      }
    }

    appendBondCatalogEntries(explicitTopologyBondPairs);
    appendBondCatalogEntries(proteinBondPairs);
    appendBondCatalogEntries(ligandBondPairs);

    let selectedResidueBondBuildMeta = {
      resId: null,
      catalogBondPairCount: 0,
      inferredInternalBondPairCount: 0,
      dedupedBondPairCount: 0,
      usedTopologyBondCatalog: false,
    };

    function getResidueInternalBondPairs(resId) {
      if (!hasTopology || resId === null || resId < 0 || !residueEntries[resId]) {
        return new Int32Array(0);
      }
      if (residueInternalBondCache[resId]) {
        return residueInternalBondCache[resId];
      }
      const displayAtoms = residueDisplayAtomIndices[resId] || getDisplayAtomIndices(residueEntries[resId].atomIndices);
      const inferred = inferDisplayBondPairs(displayAtoms, firstFrame);
      residueInternalBondCache[resId] = inferred;
      return inferred;
    }

    function selectedResidueBondColorValue() {
      const theme = VIEWER_THEMES[backgroundMode] ?? VIEWER_THEMES.black;
      if (selectedResidueId === null || !residueEntries[selectedResidueId]) {
        return theme.proteinTrace;
      }

      const residue = residueEntries[selectedResidueId];
      if (residue.isCommonSolvent) {
        return theme.base;
      }
      if (residue.isLigand || residue.isIon) {
        return theme.ligandBond;
      }
      if (useChainColors && residue.chainIndex !== undefined) {
        return chainColor(residue.chainIndex, backgroundMode);
      }
      return theme.proteinTrace;
    }

    function isHeteroResidue(resId) {
      const residue = residueEntries[resId];
      return !!(residue && (residue.isLigand || residue.isIon));
    }

    function buildSelectedResidueBondPairs(resId) {
      if (!hasTopology || resId === null || resId < 0 || !residueBondLookup[resId]) {
        selectedResidueBondBuildMeta = {
          resId,
          catalogBondPairCount: 0,
          inferredInternalBondPairCount: 0,
          dedupedBondPairCount: 0,
          usedTopologyBondCatalog: false,
        };
        return new Int32Array(0);
      }
      if (isCommonSolventResidue(resId)) {
        selectedResidueBondBuildMeta = {
          resId,
          catalogBondPairCount: 0,
          inferredInternalBondPairCount: 0,
          dedupedBondPairCount: 0,
          usedTopologyBondCatalog: false,
        };
        return new Int32Array(0);
      }

      const bondIndices = residueBondLookup[resId];
      const pairs = [];
      const seenPairKeys = new Set();
      let catalogPairCount = 0;
      function addPair(a, b) {
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (seenPairKeys.has(key)) return;
        seenPairKeys.add(key);
        pairs.push(a, b);
      }
      for (let i = 0; i < bondIndices.length; i++) {
        const bond = bondCatalog[bondIndices[i]];
        addPair(bond.a, bond.b);
        catalogPairCount += 1;
      }

      const inferredInternal = getResidueInternalBondPairs(resId);
      for (let i = 0; i < inferredInternal.length; i += 2) {
        addPair(inferredInternal[i], inferredInternal[i + 1]);
      }

      selectedResidueBondBuildMeta = {
        resId,
        catalogBondPairCount: catalogPairCount,
        inferredInternalBondPairCount: inferredInternal.length / 2,
        dedupedBondPairCount: pairs.length / 2,
        usedTopologyBondCatalog: explicitTopologyBondPairs.length > 0,
      };
      return new Int32Array(pairs);
    }

    function collectCatalogBondPairsForIncludedResidues(includedResidues) {
      if (!hasTopology || !includedResidues || includedResidues.length === 0) {
        return new Int32Array(0);
      }
      const includedResidueSet = new Set(includedResidues);
      const seenPairs = new Set();
      const pairs = [];

      for (let i = 0; i < includedResidues.length; i++) {
        const resId = includedResidues[i];
        const bondIndices = residueBondLookup[resId] || [];
        for (let j = 0; j < bondIndices.length; j++) {
          const bond = bondCatalog[bondIndices[j]];
          if (!bond) continue;
          if (!includedResidueSet.has(bond.resA) || !includedResidueSet.has(bond.resB)) continue;
          if (isCommonSolventResidue(bond.resA) || isCommonSolventResidue(bond.resB)) continue;
          if (bond.resA === selectedResidueId && bond.resB === selectedResidueId) continue;
          const key = bond.a < bond.b ? `${bond.a}:${bond.b}` : `${bond.b}:${bond.a}`;
          if (seenPairs.has(key)) continue;
          seenPairs.add(key);
          pairs.push(bond.a, bond.b);
        }
      }

      return new Int32Array(pairs);
    }

    function mergeBondPairSources(primaryPairs, secondaryPairs) {
      const seenPairs = new Set();
      const merged = [];

      function pushPairs(pairArray) {
        if (!pairArray || pairArray.length === 0) return;
        for (let i = 0; i < pairArray.length; i += 2) {
          const a = pairArray[i];
          const b = pairArray[i + 1];
          const key = a < b ? `${a}:${b}` : `${b}:${a}`;
          if (seenPairs.has(key)) continue;
          seenPairs.add(key);
          merged.push(a, b);
        }
      }

      pushPairs(primaryPairs);
      pushPairs(secondaryPairs);
      return new Int32Array(merged);
    }

    function inferDisplayBondPairs(atomIndices, pos) {
      if (!atomIndices || atomIndices.length < 2) {
        return new Int32Array(0);
      }
      return inferSubsetBonds(atoms, pos, atomIndices);
    }

    function atomGroupHasContactWithinRadius(candidateIndices, referenceIndices, pos, radiusSq) {
      for (let i = 0; i < candidateIndices.length; i++) {
        const candidateIndex = candidateIndices[i];
        const cx = pos[candidateIndex * 3];
        const cy = pos[candidateIndex * 3 + 1];
        const cz = pos[candidateIndex * 3 + 2];

        for (let j = 0; j < referenceIndices.length; j++) {
          const referenceIndex = referenceIndices[j];
          const dx = cx - pos[referenceIndex * 3];
          const dy = cy - pos[referenceIndex * 3 + 1];
          const dz = cz - pos[referenceIndex * 3 + 2];
          if ((dx * dx) + (dy * dy) + (dz * dz) <= radiusSq) {
            return true;
          }
        }
      }
      return false;
    }

    function computeIncludedLocalResiduesFromDisplayAtoms(selectedResId, radius, pos) {
      if (selectedResId === null || !residueEntries[selectedResId]) {
        return [];
      }

      const includedResidues = [selectedResId];
      const selectedDisplayAtoms = residueDisplayAtomIndices[selectedResId] || getDisplayAtomIndices(residueEntries[selectedResId].atomIndices);
      if (radius <= 0 || selectedDisplayAtoms.length === 0) {
        return includedResidues;
      }

      const radiusSq = radius * radius;
      for (let resId = 0; resId < residueEntries.length; resId++) {
        if (resId === selectedResId) continue;
        if (isCommonSolventResidue(resId)) continue;
        const candidateDisplayAtoms = residueDisplayAtomIndices[resId] || getDisplayAtomIndices(residueEntries[resId].atomIndices);
        if (candidateDisplayAtoms.length === 0) continue;
        if (atomGroupHasContactWithinRadius(candidateDisplayAtoms, selectedDisplayAtoms, pos, radiusSq)) {
          includedResidues.push(resId);
        }
      }

      return includedResidues;
    }

    function collectLocalDisplayAtomIndices(includedResidues) {
      const localDisplayAtomIndices = [];
      const localIonDisplayAtomIndices = [];
      for (let i = 0; i < includedResidues.length; i++) {
        const resId = includedResidues[i];
        const residue = residueEntries[resId];
        if (residue.isCommonSolvent && resId !== selectedResidueId) {
          continue;
        }
        const displayAtoms = residueDisplayAtomIndices[resId] || getDisplayAtomIndices(residue.atomIndices);
        for (let j = 0; j < displayAtoms.length; j++) {
          localDisplayAtomIndices.push(displayAtoms[j]);
        }
        if (resId !== selectedResidueId && residue.isIon) {
          for (let j = 0; j < displayAtoms.length; j++) {
            localIonDisplayAtomIndices.push(displayAtoms[j]);
          }
        }
      }
      return { localDisplayAtomIndices, localIonDisplayAtomIndices };
    }

    function inferLocalOverlayBondPairs(localDisplayAtomIndices, pos) {
      if (!localDisplayAtomIndices || localDisplayAtomIndices.length < 2) {
        return new Int32Array(0);
      }
      return inferDisplayBondPairs(localDisplayAtomIndices, pos);
    }

    function buildRenderedLocalBondPairs(localCandidatePairs, includedResidues) {
      const includedResidueSet = new Set(includedResidues);
      const pairs = [];
      const colors = [];
      const seenPairKeys = new Set();
      const pairMetadataByKey = new Map();

      function classifyPair(resA, resB) {
        if (isHeteroResidue(resA) || isHeteroResidue(resB)) {
          return 'hetero-related';
        }
        if (resA === selectedResidueId || resB === selectedResidueId) {
          return 'selected-neighbor';
        }
        return 'neighbor-neighbor';
      }

      function addPair(a, b, resA, resB, pairType) {
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (seenPairKeys.has(key)) return;
        seenPairKeys.add(key);
        pairs.push(a, b);
        pairMetadataByKey.set(key, { a, b, resA, resB, pairType });
        if (isHeteroResidue(resA) || isHeteroResidue(resB)) {
          const theme = VIEWER_THEMES[backgroundMode] ?? VIEWER_THEMES.black;
          pushSolidPairColor(colors, theme.ligandBond);
        } else {
          pushElementPairColor(colors, a, b);
        }
      }

      for (let i = 0; i < localCandidatePairs.length; i += 2) {
        const a = localCandidatePairs[i];
        const b = localCandidatePairs[i + 1];
        const resA = atomToResidue[a];
        const resB = atomToResidue[b];
        if (resA === undefined || resB === undefined) continue;
        if (!includedResidueSet.has(resA) || !includedResidueSet.has(resB)) continue;
        if (isCommonSolventResidue(resA) || isCommonSolventResidue(resB)) continue;
        // Selected-residue internal bonds are rendered by the selected overlay.
        if (resA === selectedResidueId && resB === selectedResidueId) continue;
        addPair(a, b, resA, resB, classifyPair(resA, resB));
      }

      return {
        bondPairs: new Int32Array(pairs),
        bondColors: new Float32Array(colors),
        pairMetadataByKey,
      };
    }

    function updateLocalMonotonicDebug(radius, includedResidues, localDisplayAtomCount, inferredPairCount, bondPairs, pairMetadataByKey) {
      const pairKeys = new Set();
      for (let i = 0; i < bondPairs.length; i += 2) {
        const a = bondPairs[i];
        const b = bondPairs[i + 1];
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        pairKeys.add(key);
      }
      const residueSet = new Set(includedResidues);
      const sameContext = (
        localMonotonicDebugState.selectedResidueId === selectedResidueId &&
        localMonotonicDebugState.frame === currentFrame
      );
      const radiusIncreased = radius > (localMonotonicDebugState.radius + 1e-6);
      const radiusDecreased = radius < (localMonotonicDebugState.radius - 1e-6);

      if (!sameContext || radiusIncreased || radiusDecreased) {
        console.debug('[LocalRadiusStats]', {
          selectedResidueId,
          frame: currentFrame,
          radius,
          includedResidueCount: includedResidues.length,
          includedDisplayAtomCount: localDisplayAtomCount,
          inferredLocalPairCount: inferredPairCount,
          renderedLocalPairCount: bondPairs.length / 2,
        });
      }

      if (sameContext && radiusIncreased) {
        const droppedBondPairs = [];
        for (const key of localMonotonicDebugState.pairKeys) {
          if (!pairKeys.has(key)) {
            const pairMeta = localMonotonicDebugState.pairMetadataByKey.get(key);
            droppedBondPairs.push({
              pair: key,
              residueA: pairMeta ? pairMeta.resA : null,
              residueB: pairMeta ? pairMeta.resB : null,
              pairType: pairMeta ? pairMeta.pairType : 'unknown',
            });
          }
        }
        const droppedResidueIds = [];
        for (const resId of localMonotonicDebugState.residueSet) {
          if (!residueSet.has(resId)) {
            droppedResidueIds.push(resId);
          }
        }
        if (droppedBondPairs.length > 0 || droppedResidueIds.length > 0) {
          console.error('[LocalRadiusMonotonicityViolation]', {
            selectedResidueId,
            frame: currentFrame,
            previousRadius: localMonotonicDebugState.radius,
            currentRadius: radius,
            droppedBondPairs,
            droppedResidueIds,
          });
        }
      }

      if (!sameContext || radiusDecreased) {
        localMonotonicDebugState = {
          selectedResidueId,
          frame: currentFrame,
          radius,
          pairKeys,
          residueSet,
          pairMetadataByKey: new Map(pairMetadataByKey),
        };
        return;
      }

      localMonotonicDebugState.radius = radius;
      localMonotonicDebugState.pairKeys = pairKeys;
      localMonotonicDebugState.residueSet = residueSet;
      localMonotonicDebugState.pairMetadataByKey = new Map(pairMetadataByKey);
    }

    function rebuildLocalContextOverlay(pos) {
      if (selectedResidueId === null) {
        meshLocalContextBonds.visible = false;
        meshLocalContextIons.visible = false;
        return;
      }

      const includedResidues = computeIncludedLocalResiduesFromDisplayAtoms(selectedResidueId, localContextRadius, pos);
      const localData = collectLocalDisplayAtomIndices(includedResidues);
      const catalogLocalPairs = collectCatalogBondPairsForIncludedResidues(includedResidues);
      const inferredLocalPairs = inferLocalOverlayBondPairs(localData.localDisplayAtomIndices, pos);
      const mergedLocalPairs = mergeBondPairSources(catalogLocalPairs, inferredLocalPairs);
      const overlay = buildRenderedLocalBondPairs(mergedLocalPairs, includedResidues);
      updateLocalMonotonicDebug(
        localContextRadius,
        includedResidues,
        localData.localDisplayAtomIndices.length,
        mergedLocalPairs.length / 2,
        overlay.bondPairs,
        overlay.pairMetadataByKey
      );
      const localBondPairs = overlay.bondPairs;
      if (localBondPairs.length === 0) {
        meshLocalContextBonds.visible = false;
      } else {
        const bondLength = localBondPairs.length * 3;
        if (localContextBondPos.length !== bondLength) {
          localContextBondPos = new Float32Array(bondLength);
          localContextBondColors = new Float32Array(bondLength);
          setScreenSpaceLinePositions(geoLocalContextBonds, localContextBondPos);
          setScreenSpaceLineColors(geoLocalContextBonds, localContextBondColors);
          attrLocalContextBondColor = geoLocalContextBonds.attributes.instanceColorStart;
        }

        applyTrace(localBondPairs, pos, localContextBondPos);
        localContextBondColors.set(overlay.bondColors);
        markScreenSpaceLinePositionsDirty(geoLocalContextBonds);
        markScreenSpaceLineColorsDirty(geoLocalContextBonds);
        meshLocalContextBonds.visible = true;
      }

      const ionPointLength = localData.localIonDisplayAtomIndices.length * 3;
      if (ionPointLength === 0) {
        meshLocalContextIons.visible = false;
      } else {
        if (localContextIonPos.length !== ionPointLength) {
          localContextIonPos = new Float32Array(ionPointLength);
          localContextIonColors = new Float32Array(ionPointLength);
          attrLocalContextIon = new THREE.BufferAttribute(localContextIonPos, 3).setUsage(THREE.DynamicDrawUsage);
          attrLocalContextIonColor = new THREE.BufferAttribute(localContextIonColors, 3);
          geoLocalContextIons.setAttribute('position', attrLocalContextIon);
          geoLocalContextIons.setAttribute('color', attrLocalContextIonColor);
        }
        applyPos(localData.localIonDisplayAtomIndices, pos, localContextIonPos);
        fillColorBuffer(localContextIonColors, localData.localIonDisplayAtomIndices, 'element');
        attrLocalContextIon.needsUpdate = true;
        attrLocalContextIonColor.needsUpdate = true;
        meshLocalContextIons.visible = true;
      }
    }

    function updateSelectedResidueBondOverlay(pos) {
      if (selectedResidueId === null) {
        meshSelectedResidueBonds.visible = false;
        if (isAmberFlow) {
          amberSelectionLastVisibility = false;
        }
        return;
      }
      if (isCommonSolventResidue(selectedResidueId)) {
        meshSelectedResidueBonds.visible = false;
        sendWebviewCheckpoint('CHK_SOLV_7_SOLVENT_RENDER_MODE', {
          ...checkpointContext,
          selectedResidueId,
          selectedResidueName: residueEntries[selectedResidueId]?.resName || null,
          selectedResidueClassification: residueClassLabel(residueEntries[selectedResidueId]),
          selectedBondVisible: false,
          renderMode: 'points_only',
          reason: 'common_solvent_points_only',
        });
        amberSelectionLastVisibility = false;
        return;
      }

      const usedFallbackInference = selectedResidueBondPairs.length === 0;
      const activeBondPairs = selectedResidueBondPairs.length > 0
        ? selectedResidueBondPairs
        : inferDisplayBondPairs(selectedResidueIndices, pos);
      if (activeBondPairs.length === 0) {
        meshSelectedResidueBonds.visible = false;
        if (isAmberFlow && (amberSelectionOverlayCheckpointPending || amberSelectionLastVisibility !== false)) {
          sendWebviewCheckpoint('CHK_AMBER_SEL_5_SELECTED_BOND_GEOMETRY_BUILT', {
            selectedResidueId,
            selectedResidueName: residueEntries[selectedResidueId]?.resName || null,
            selectedResidueAtomCount: selectedResidueIndices.length,
            activeBondPairCount: 0,
            selectedBondPairCountFromCatalog: selectedResidueBondPairs.length / 2,
            geometryBuilt: false,
            geometryPositionBufferLength: selectedBondPos.length,
            usedFallbackInference,
            reason: 'activeBondPairsLength===0',
          });
          sendWebviewCheckpoint('CHK_AMBER_SEL_6_SELECTED_BOND_VISIBLE', {
            selectedResidueId,
            selectedResidueName: residueEntries[selectedResidueId]?.resName || null,
            selectedBondVisible: false,
            selectedBondPairCount: 0,
            usedFallbackInference,
            reason: 'noActiveBondPairs',
          });
          amberSelectionOverlayCheckpointPending = false;
        }
        amberSelectionLastVisibility = false;
        return;
      }

      const requiredLength = activeBondPairs.length * 3;
      if (selectedBondPos.length !== requiredLength) {
        selectedBondPos = new Float32Array(requiredLength);
        setScreenSpaceLinePositions(geoSelectedResidueBonds, selectedBondPos);
      }

      applyTrace(activeBondPairs, pos, selectedBondPos);
      markScreenSpaceLinePositionsDirty(geoSelectedResidueBonds);
      matSelectedResidueBonds.color.setHex(selectedResidueBondColorValue());
      meshSelectedResidueBonds.visible = true;
      if (isAmberFlow && (amberSelectionOverlayCheckpointPending || amberSelectionLastVisibility !== true)) {
        sendWebviewCheckpoint('CHK_AMBER_SEL_5_SELECTED_BOND_GEOMETRY_BUILT', {
          selectedResidueId,
          selectedResidueName: residueEntries[selectedResidueId]?.resName || null,
          selectedResidueAtomCount: selectedResidueIndices.length,
          activeBondPairCount: activeBondPairs.length / 2,
          selectedBondPairCountFromCatalog: selectedResidueBondPairs.length / 2,
          geometryBuilt: true,
          geometryPositionBufferLength: requiredLength,
          usedFallbackInference,
          bondColorHex: colorHexCss(selectedResidueBondColorValue()),
        });
        sendWebviewCheckpoint('CHK_AMBER_SEL_6_SELECTED_BOND_VISIBLE', {
          selectedResidueId,
          selectedResidueName: residueEntries[selectedResidueId]?.resName || null,
          selectedBondVisible: true,
          selectedBondPairCount: activeBondPairs.length / 2,
          usedFallbackInference,
        });
        amberSelectionOverlayCheckpointPending = false;
      }
      amberSelectionLastVisibility = true;
    }

    function clearSelectedResidue() {
      if (selectedResidueButton) {
        selectedResidueButton.classList.remove('is-selected');
      }
      selectedResidueId = null;
      selectedResidueButton = null;
      selectedResidueIndices = [];
      selectedResidueBondPairs = new Int32Array(0);
      amberSelectionOverlayCheckpointPending = false;
      amberSelectionLastVisibility = null;
      meshSelectedResidue.userData.globalIndices = [];
      meshSelectedResidue.visible = false;
      meshSelectedContext.userData.globalIndices = [];
      meshSelectedContext.visible = false;
      meshSelectedResidueBonds.visible = false;
      meshLocalContextBonds.visible = false;
      meshLocalContextIons.visible = false;
      resetLocalMonotonicDebugState();
      updateSequenceSelectionText();
    }

    function setSelectedResidue(resId, options = {}) {
      const { scrollIntoView = true } = options;
      clearSelectedResidue();

      selectedResidueId = resId;
      selectedResidueIndices = resId !== null && residueEntries[resId]
        ? (residueDisplayAtomIndices[resId] || getDisplayAtomIndices(residueEntries[resId].atomIndices))
        : [];
      selectedResidueBondPairs = buildSelectedResidueBondPairs(resId);
      amberSelectionOverlayCheckpointPending = true;
      selectedResidueButton = resId !== null ? sequenceButtons[resId] || null : null;
      meshSelectedResidue.userData.globalIndices = selectedResidueIndices;
      meshSelectedContext.userData.globalIndices = selectedResidueIndices;

      if (isAmberFlow && resId !== null && residueEntries[resId]) {
        const residue = residueEntries[resId];
        let zeroBondReason = null;
        if (selectedResidueBondPairs.length === 0) {
          if (residue.isCommonSolvent) zeroBondReason = 'commonSolventPointsOnly';
          else if (!hasTopology) zeroBondReason = 'hasTopology=false';
          else if (selectedResidueIndices.length <= 1) zeroBondReason = 'selectedResidueAtomCount<=1';
          else if (selectedResidueBondBuildMeta.catalogBondPairCount === 0 && selectedResidueBondBuildMeta.inferredInternalBondPairCount === 0) {
            zeroBondReason = 'catalogAndInferenceBothZero';
          } else {
            zeroBondReason = 'dedupedToZero';
          }
        }
        sendWebviewCheckpoint('CHK_AMBER_SEL_2_SELECTED_RESIDUE_RESOLVED', {
          selectedResidueId: resId,
          selectedResidueName: residue.resName,
          selectedResidueSeq: residue.resSeq,
          selectedResidueChainId: residue.chainId || '',
          selectedResidueClassification: residueClassLabel(residue),
          selectedResidueAtomCount: selectedResidueIndices.length,
          hasTopologyFlag: Boolean(hasTopology),
        });
        sendWebviewCheckpoint('CHK_AMBER_SEL_3_SELECTED_ATOM_COUNT', {
          selectedResidueId: resId,
          selectedResidueName: residue.resName,
          selectedResidueAtomCount: selectedResidueIndices.length,
          selectedResidueDisplayAtomCount: selectedResidueIndices.length,
        });
        sendWebviewCheckpoint('CHK_AMBER_SEL_4_SELECTED_BOND_PAIR_COUNT', {
          selectedResidueId: resId,
          selectedResidueName: residue.resName,
          selectedBondPairCount: selectedResidueBondPairs.length / 2,
          catalogBondPairCount: selectedResidueBondBuildMeta.catalogBondPairCount,
          inferredInternalBondPairCount: selectedResidueBondBuildMeta.inferredInternalBondPairCount,
          usedTopologyBondCatalog: selectedResidueBondBuildMeta.usedTopologyBondCatalog,
          topologyBondPairsLength: explicitTopologyBondPairs.length,
          zeroBondReason,
        });
        sendWebviewCheckpoint('CHK_AMBER_SEL_7_LIGAND_SELECTION_STATE', {
          selectedResidueId: resId,
          selectedResidueName: residue.resName,
          isLigand: Boolean(residue.isLigand),
          selectedBondPairCount: selectedResidueBondPairs.length / 2,
          selectedBondVisible: Boolean(meshSelectedResidueBonds.visible),
        });
        sendWebviewCheckpoint('CHK_AMBER_SEL_8_ION_SELECTION_STATE', {
          selectedResidueId: resId,
          selectedResidueName: residue.resName,
          isIon: Boolean(residue.isIon),
          selectedBondPairCount: selectedResidueBondPairs.length / 2,
          selectedBondVisible: Boolean(meshSelectedResidueBonds.visible),
        });
      }
      if (dcdNcParityFormatPrefix && resId !== null && residueEntries[resId]) {
        const residue = residueEntries[resId];
        let zeroBondReason = null;
        if (selectedResidueBondPairs.length === 0) {
          if (residue.isCommonSolvent) zeroBondReason = 'commonSolventPointsOnly';
          else if (!hasTopology) zeroBondReason = 'hasTopology=false';
          else if (selectedResidueIndices.length <= 1) zeroBondReason = 'selectedResidueAtomCount<=1';
          else if (selectedResidueBondBuildMeta.catalogBondPairCount === 0 && selectedResidueBondBuildMeta.inferredInternalBondPairCount === 0) {
            zeroBondReason = 'catalogAndInferenceBothZero';
          } else {
            zeroBondReason = 'dedupedToZero';
          }
        }
        emitDcdNcParityCheckpoint(2, 'SELECTED_RESIDUE_RESOLVED', {
          selectedResidueId: resId,
          selectedResidueName: residue.resName,
          selectedResidueSeq: residue.resSeq,
          selectedResidueChainId: residue.chainId || '',
          selectedResidueClassification: residueClassLabel(residue),
          selectedResidueAtomCount: selectedResidueIndices.length,
          hasTopologyFlag: Boolean(hasTopology),
        });
        emitDcdNcParityCheckpoint(3, 'SELECTED_ATOM_COUNT', {
          selectedResidueId: resId,
          selectedResidueName: residue.resName,
          selectedResidueAtomCount: selectedResidueIndices.length,
          selectedResidueDisplayAtomCount: selectedResidueIndices.length,
        });
        emitDcdNcParityCheckpoint(4, 'SELECTED_BOND_PAIR_COUNT', {
          selectedResidueId: resId,
          selectedResidueName: residue.resName,
          selectedBondPairCount: selectedResidueBondPairs.length / 2,
          catalogBondPairCount: selectedResidueBondBuildMeta.catalogBondPairCount,
          inferredInternalBondPairCount: selectedResidueBondBuildMeta.inferredInternalBondPairCount,
          usedTopologyBondCatalog: selectedResidueBondBuildMeta.usedTopologyBondCatalog,
          topologyBondPairsLength: explicitTopologyBondPairs.length,
          zeroBondReason,
        });
        emitDcdNcParityCheckpoint(7, 'LIGAND_SELECTION_STATE', {
          selectedResidueId: resId,
          selectedResidueName: residue.resName,
          selectedResidueClassification: residueClassLabel(residue),
          isLigand: Boolean(residue.isLigand),
          isIon: Boolean(residue.isIon),
          selectedBondPairCount: selectedResidueBondPairs.length / 2,
          selectedBondVisible: Boolean(meshSelectedResidueBonds.visible),
        });
      }
      if (parityCheckpointsEnabled && resId !== null && residueEntries[resId]) {
        const residue = residueEntries[resId];
        let zeroBondReason = null;
        if (selectedResidueBondPairs.length === 0) {
          if (residue.isCommonSolvent) zeroBondReason = 'commonSolventPointsOnly';
          else if (!hasTopology) zeroBondReason = 'hasTopology=false';
          else if (selectedResidueIndices.length <= 1) zeroBondReason = 'selectedResidueAtomCount<=1';
          else if (selectedResidueBondBuildMeta.catalogBondPairCount === 0 && selectedResidueBondBuildMeta.inferredInternalBondPairCount === 0) {
            zeroBondReason = 'catalogAndInferenceBothZero';
          } else {
            zeroBondReason = 'dedupedToZero';
          }
        }
        sendWebviewCheckpoint('CHK_PARITY_SEL_2_SELECTED_RESIDUE_RESOLVED', {
          referenceCaseId: referenceHarness.caseId,
          selectedResidueId: resId,
          selectedResidueName: residue.resName,
          selectedResidueSeq: residue.resSeq,
          selectedResidueChainId: residue.chainId || '',
          selectedResidueClassification: residueClassLabel(residue),
          selectedResidueAtomCount: selectedResidueIndices.length,
          hasTopologyFlag: Boolean(hasTopology),
        });
        sendWebviewCheckpoint('CHK_PARITY_SEL_3_SELECTED_ATOM_COUNT', {
          referenceCaseId: referenceHarness.caseId,
          selectedResidueId: resId,
          selectedResidueName: residue.resName,
          selectedResidueAtomCount: selectedResidueIndices.length,
          selectedResidueDisplayAtomCount: selectedResidueIndices.length,
        });
        sendWebviewCheckpoint('CHK_PARITY_SEL_4_SELECTED_BOND_PAIR_COUNT', {
          referenceCaseId: referenceHarness.caseId,
          selectedResidueId: resId,
          selectedResidueName: residue.resName,
          selectedBondPairCount: selectedResidueBondPairs.length / 2,
          catalogBondPairCount: selectedResidueBondBuildMeta.catalogBondPairCount,
          inferredInternalBondPairCount: selectedResidueBondBuildMeta.inferredInternalBondPairCount,
          usedTopologyBondCatalog: selectedResidueBondBuildMeta.usedTopologyBondCatalog,
          topologyBondPairsLength: explicitTopologyBondPairs.length,
          zeroBondReason,
        });
      }

      if (selectedResidueButton) {
        selectedResidueButton.classList.add('is-selected');
        if (scrollIntoView && !sequenceRegionCollapsed) {
          selectedResidueButton.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      }

      updateSequenceSelectionText();
      const currentFramePos = getFrameData(currentFrame);
      if (currentFramePos) {
        updateSelectedResidueOverlay(currentFramePos);
        updateSelectedResidueBondOverlay(currentFramePos);
        rebuildLocalContextOverlay(currentFramePos);
      }
    }

    function cacheDefaultOverviewState() {
      defaultOverviewState = {
        position: camera.position.clone(),
        up: camera.up.clone(),
        target: orbitTarget.clone(),
      };
    }

    function restoreDefaultOverview(animated = false) {
      if (!defaultOverviewState) return;
      if (animated) {
        cameraTween = {
          startTarget: orbitTarget.clone(),
          endTarget: defaultOverviewState.target.clone(),
          startPosition: camera.position.clone(),
          endPosition: defaultOverviewState.position.clone(),
          startUp: camera.up.clone(),
          endUp: defaultOverviewState.up.clone(),
          progress: 0,
          speed: 0.14,
        };
        return;
      }

      cameraTween = null;
      orbitTarget.copy(defaultOverviewState.target);
      camera.position.copy(defaultOverviewState.position);
      camera.up.copy(defaultOverviewState.up);
      camera.lookAt(orbitTarget);
      camera.updateProjectionMatrix();
    }

    function restoreOverviewPreservingOrientation(animated = true) {
      if (!defaultOverviewState) return;
      const currentOffset = getCameraOffset();
      const currentDistance = Math.max(currentOffset.length(), 1e-4);
      const defaultDistance = defaultOverviewState.position.distanceTo(defaultOverviewState.target);
      // Keep deselection stable and non-cumulative: always return to a fixed overview scale,
      // while preserving the user's current orientation vector.
      const desiredDistance = Math.max(defaultDistance, boundRadius * 2.35, 8, currentDistance);
      if (animated) {
        startCameraTransitionToDistance(defaultOverviewState.target.clone(), desiredDistance);
        return;
      }
      const direction = currentOffset.lengthSq() > 0
        ? currentOffset.clone().normalize()
        : new THREE.Vector3(0, 0, 1);
      orbitTarget.copy(defaultOverviewState.target);
      camera.position.copy(defaultOverviewState.target).addScaledVector(direction, desiredDistance);
      camera.lookAt(orbitTarget);
      camera.updateProjectionMatrix();
    }

    function resetSelectionAndOverview() {
      const preState = cameraStateSnapshot();
      const preForward = cameraForwardVector();
      const defaultDistance = defaultOverviewState
        ? defaultOverviewState.position.distanceTo(defaultOverviewState.target)
        : null;
      const computedOverviewDistance = Math.max(defaultDistance || 0, boundRadius * 2.35, 8);
      clearSelectedResidue();
      parityFocusState = null;
      sendWebviewCheckpoint('CHK_UX_7_PRE_DESELECT_CAMERA_STATE', {
        preDeselect: preState,
        defaultOverviewTarget: defaultOverviewState ? vectorToObject(defaultOverviewState.target) : null,
      });
      sendWebviewCheckpoint('CHK_SOLV_1_PRE_DESELECT_CAMERA_STATE', {
        ...checkpointContext,
        preDeselect: preState,
        defaultOverviewTarget: defaultOverviewState ? vectorToObject(defaultOverviewState.target) : null,
      });
      sendWebviewCheckpoint('CHK_SOLV_3_OVERVIEW_DISTANCE', {
        ...checkpointContext,
        preDeselectDistance: preState.distanceToTarget,
        defaultOverviewDistance: roundNumber(defaultDistance),
        computedOverviewDistance: roundNumber(computedOverviewDistance),
        boundRadius: roundNumber(boundRadius),
      });
      deselectCameraCheckpointPending = {
        preState,
        preForward,
        computedOverviewDistance: roundNumber(computedOverviewDistance),
      };
      restoreOverviewPreservingOrientation(true);
      renderScene();
    }

    function refreshSequenceTheme() {
      for (let i = 0; i < residueEntries.length; i++) {
        const residue = residueEntries[i];
        const button = sequenceButtons[i];
        if (!button) continue;
        if (button.dataset.groupedSolvent === 'true') continue;
        button.style.setProperty('--chain-accent', sequenceChainCss(residue.chainIndex));
      }

      const chainRows = sequenceContent.querySelectorAll('.chain-row');
      for (const row of chainRows) {
        const chainIndex = parseInt(row.dataset.chainIndex || '-1', 10);
        if (chainIndex >= 0) {
          row.style.setProperty('--chain-accent', sequenceChainCss(chainIndex));
        }
      }
    }

    function applySequenceMode() {
      sequenceContent.dataset.sequenceMode = sequenceMode;
      btnSeqMode.textContent = sequenceMode === 'three' ? '3L' : '1L';
      btnSeqMode.title = `Switch to ${sequenceMode === 'three' ? 'one-letter' : 'three-letter'} residue codes`;

      for (let i = 0; i < residueEntries.length; i++) {
        const button = sequenceButtons[i];
        const residue = residueEntries[i];
        if (!button || !residue) continue;
        if (button.dataset.groupedSolvent === 'true') continue;
        button.textContent = residueLabel(residue, sequenceMode);
      }

      persistUiState();
    }

    function buildSequenceUI() {
      sequenceButtons.length = 0;
      sequenceContent.replaceChildren();

      const residueNavDisabled = !hasTopology || visibleResidueCount === 0;
      const amberChainBasePayload = {
        hasTopology: Boolean(hasTopology),
        visibleResidueCount,
        residueEntriesLength: residueEntries.length,
        chainIdsLength: chainIds.length,
        chainIdsSample: chainIds.slice(0, 12),
        atomToChainLength: atomToChain.length,
        atomToResidueLength: atomToResidue.length,
      };
      if (isGroBackedFlow) {
        sendWebviewCheckpoint('CHK_GRO_8_RESIDUE_NAV_GATE_RESULT', {
          gateExpression: '!hasTopology || visibleResidueCount === 0',
          hasTopology: Boolean(hasTopology),
          residueEntriesLength: residueEntries.length,
          visibleResidueCount,
          residueNavigationEnabled: !residueNavDisabled,
          residueNavigationDisabled: residueNavDisabled,
          chainCount: chainIds.length,
          atomToResidueLength: atomToResidue.length,
          atomToChainLength: atomToChain.length,
          caIndicesLength: caIndices.length,
          disableReason: !hasTopology ? 'hasTopology=false' : (visibleResidueCount === 0 ? 'visibleResidueCount===0' : 'none'),
          warningTextShown: residueNavDisabled
            ? 'Residue navigation requires topology metadata (.pdb/.gro self-contained, or a companion topology file such as .pdb/.gro/.parm7/.prmtop).'
            : null,
        });
      }

      if (residueNavDisabled) {
        if (isAmberFlow) {
          sendWebviewCheckpoint('CHK_AMBER_CHAIN_4_SEQUENCE_GROUP_COUNT', {
            ...amberChainBasePayload,
            gateExpression: '!hasTopology || visibleResidueCount === 0',
            residueNavigationEnabled: false,
            residueNavigationDisabled: true,
            sequenceGroupCount: 0,
            disableReason: !hasTopology ? 'hasTopology=false' : 'visibleResidueCount===0',
          });
        }
        const empty = document.createElement('div');
        empty.className = 'sequence-empty';
        empty.textContent = 'Residue navigation requires topology metadata (.pdb/.gro self-contained, or a companion topology file such as .pdb/.gro/.parm7/.prmtop).';
        sequenceContent.appendChild(empty);
        btnSeqMode.disabled = true;
        updateSequenceSelectionText();
        sendWebviewCheckpoint('CHK_SOLV_8_MAIN_SEQUENCE_COUNT', {
          ...checkpointContext,
          mainSequenceGroupCount: 0,
          totalSequenceGroupCount: 0,
          sequenceEntryCount: 0,
        });
        sendWebviewCheckpoint('CHK_SOLV_9_SOLVENT_GROUP_COUNT', {
          ...checkpointContext,
          solventGroupCount: 0,
          commonSolventResidueNames: [],
        });
        sendWebviewCheckpoint('CHK_SOLV_10_SOLVENT_ROW_BUILT', {
          ...checkpointContext,
          solventRowBuilt: false,
          solventGroupCount: 0,
        });
        if (isAmberFlow) {
          sendWebviewCheckpoint('CHK_AMBER_CHAIN_5_CHAIN_UI_BUILT', {
            ...amberChainBasePayload,
            chainUiBuilt: false,
            sequenceGroupCount: 0,
            sequenceEntryCount: 0,
            ligandEntryCount: 0,
            ionEntryCount: 0,
          });
        }
        return;
      }

      btnSeqMode.disabled = false;

      const chainGroups = new Map();
      const commonSolventGroups = new Map();
      for (let resId = 0; resId < residueEntries.length; resId++) {
        if (!residueHasVisibleAtoms[resId]) continue;
        const residue = residueEntries[resId];
        if (residue.isCommonSolvent) {
          const solventKey = String(residue.resName || 'SOLV').toUpperCase();
          if (!commonSolventGroups.has(solventKey)) {
            commonSolventGroups.set(solventKey, []);
          }
          commonSolventGroups.get(solventKey).push({ residue, resId });
          continue;
        }
        const key = residue.chainIndex;
        if (!chainGroups.has(key)) {
          chainGroups.set(key, []);
        }
        chainGroups.get(key).push({ residue, resId });
      }
      if (isAmberFlow) {
        sendWebviewCheckpoint('CHK_AMBER_CHAIN_4_SEQUENCE_GROUP_COUNT', {
          ...amberChainBasePayload,
          gateExpression: '!hasTopology || visibleResidueCount === 0',
          residueNavigationEnabled: true,
          residueNavigationDisabled: false,
          sequenceGroupCount: chainGroups.size,
          sequenceGroupKeysSample: Array.from(chainGroups.keys()).slice(0, 12),
        });
      }

      const fragment = document.createDocumentFragment();
      for (const [chainIndex, entries] of chainGroups.entries()) {
        const chainRow = document.createElement('section');
        chainRow.className = 'chain-row';
        chainRow.dataset.chainIndex = String(chainIndex);
        chainRow.style.setProperty('--chain-accent', sequenceChainCss(chainIndex));

        const label = document.createElement('div');
        label.className = 'chain-label';

        const swatch = document.createElement('span');
        swatch.className = 'chain-swatch';

        const copy = document.createElement('div');
        copy.className = 'chain-copy';

        const name = document.createElement('div');
        name.className = 'chain-name';
        name.textContent = chainIds[chainIndex] || '_';

        const count = document.createElement('div');
        count.className = 'chain-count';
        count.textContent = `${entries.length} res`;

        copy.append(name, count);
        label.append(swatch, copy);

        const residuesRow = document.createElement('div');
        residuesRow.className = 'chain-residues';

        for (const entry of entries) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'sequence-residue';
          button.style.setProperty('--chain-accent', sequenceChainCss(chainIndex));
          button.textContent = residueLabel(entry.residue, sequenceMode);
          button.title = `${residueDescriptor(entry.residue)} (${entry.residue.atomIndices.length} atoms)`;
          button.setAttribute('aria-label', residueDescriptor(entry.residue));
          if (entry.residue.isLigand) button.classList.add('is-ligand');
          if (entry.residue.isIon) button.classList.add('is-ion');
          button.addEventListener('click', () => focusResidueById(entry.resId, 'sequence_click'));
          residuesRow.appendChild(button);
          sequenceButtons[entry.resId] = button;
        }

        chainRow.append(label, residuesRow);
        fragment.appendChild(chainRow);
      }
      if (commonSolventGroups.size > 0) {
        for (const [solventName, entries] of commonSolventGroups.entries()) {
          const representative = entries[0];
          const solventRow = document.createElement('section');
          solventRow.className = 'chain-row is-common-solvent-row';
          solventRow.dataset.chainIndex = '-1';
          solventRow.dataset.solventName = solventName;
          solventRow.style.setProperty('--chain-accent', 'var(--text-muted)');

          const label = document.createElement('div');
          label.className = 'chain-label';

          const swatch = document.createElement('span');
          swatch.className = 'chain-swatch';

          const copy = document.createElement('div');
          copy.className = 'chain-copy';

          const name = document.createElement('div');
          name.className = 'chain-name';
          name.textContent = 'SOLV';

          const count = document.createElement('div');
          count.className = 'chain-count';
          count.textContent = `${entries.length} ${solventName}`;

          copy.append(name, count);
          label.append(swatch, copy);

          const residuesRow = document.createElement('div');
          residuesRow.className = 'chain-residues';

          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'sequence-residue is-common-solvent';
          button.dataset.groupedSolvent = 'true';
          button.style.setProperty('--chain-accent', 'var(--text-muted)');
          button.textContent = `${solventName}×${entries.length}`;
          button.title = `Common solvent ${solventName} (${entries.length} residues). Rendered as points only.`;
          button.setAttribute('aria-label', `Common solvent ${solventName}`);
          button.addEventListener('click', () => {
            if (representative && representative.resId !== undefined) {
              focusResidueById(representative.resId, 'sequence_click');
            }
          });
          residuesRow.appendChild(button);
          for (const entry of entries) {
            sequenceButtons[entry.resId] = button;
          }

          solventRow.append(label, residuesRow);
          fragment.appendChild(solventRow);
        }
      }

      sequenceContent.appendChild(fragment);
      applySequenceMode();
      refreshSequenceTheme();
      updateSequenceSelectionText();
      sendWebviewCheckpoint('CHK_SOLV_8_MAIN_SEQUENCE_COUNT', {
        ...checkpointContext,
        mainSequenceGroupCount: countMainSequenceGroupsFromDom(),
        totalSequenceGroupCount: countSequenceGroupsFromDom(),
        sequenceEntryCount: countSequenceEntriesFromDom(),
      });
      sendWebviewCheckpoint('CHK_SOLV_9_SOLVENT_GROUP_COUNT', {
        ...checkpointContext,
        solventGroupCount: countCommonSolventRowsFromDom(),
        commonSolventResidueNames: Array.from(commonSolventGroups.keys()),
      });
      sendWebviewCheckpoint('CHK_SOLV_10_SOLVENT_ROW_BUILT', {
        ...checkpointContext,
        solventRowBuilt: commonSolventGroups.size > 0,
        solventGroupCount: countCommonSolventRowsFromDom(),
      });
      if (isAmberFlow) {
        sendWebviewCheckpoint('CHK_AMBER_CHAIN_5_CHAIN_UI_BUILT', {
          ...amberChainBasePayload,
          chainUiBuilt: true,
          sequenceGroupCount: countSequenceGroupsFromDom(),
          sequenceEntryCount: countSequenceEntriesFromDom(),
          ligandEntryCount: countLigandEntriesFromDom(),
          ionEntryCount: countIonEntriesFromDom(),
        });
      }
    }

    let resizeQueued = false;

    function scheduleCanvasResize() {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(() => {
        resizeQueued = false;
        resize();
        renderScene();
      });
    }

    function getSequenceMaxHeight() {
      return Math.max(
        LAYOUT_TUNING.sequenceMin,
        Math.floor(Math.max(app.clientHeight - 80, 120) * LAYOUT_TUNING.sequenceMaxFraction)
      );
    }

    function getPanelMaxWidth() {
      return Math.max(
        LAYOUT_TUNING.panelMin,
        Math.floor(Math.max(app.clientWidth - 120, 200) * LAYOUT_TUNING.panelMaxFraction)
      );
    }

    function clampSequenceHeight(value) {
      return Math.max(LAYOUT_TUNING.sequenceMin, Math.min(getSequenceMaxHeight(), Math.round(value)));
    }

    function clampPanelWidth(value) {
      return Math.max(LAYOUT_TUNING.panelMin, Math.min(getPanelMaxWidth(), Math.round(value)));
    }

    function applySequenceRegionState(options = {}) {
      const { skipPersist = false, skipResize = false } = options;
      sequenceExpandedHeight = clampSequenceHeight(sequenceExpandedHeight);
      sequenceRegion.dataset.collapsed = sequenceRegionCollapsed ? 'true' : 'false';
      app.style.setProperty(
        '--sequence-region-size',
        `${sequenceRegionCollapsed ? LAYOUT_TUNING.sequenceCollapsed : sequenceExpandedHeight}px`
      );
      btnSequenceToggle.setAttribute('aria-expanded', sequenceRegionCollapsed ? 'false' : 'true');
      btnSequenceToggle.title = sequenceRegionCollapsed ? 'Expand sequence region' : 'Collapse sequence region';
      btnSequenceToggle.textContent = sequenceRegionCollapsed ? 'SEQ+' : 'SEQ';
      if (!skipPersist) persistUiState();
      if (!skipResize) scheduleCanvasResize();
    }

    function applyControlPanelState(options = {}) {
      const { skipPersist = false, skipResize = false } = options;
      controlPanelExpandedWidth = clampPanelWidth(controlPanelExpandedWidth);
      controlPanel.dataset.collapsed = controlPanelOpen ? 'false' : 'true';
      controlPanel.style.width = `${controlPanelOpen ? controlPanelExpandedWidth : LAYOUT_TUNING.panelCollapsed}px`;
      btnPanelToggle.setAttribute('aria-expanded', controlPanelOpen ? 'true' : 'false');
      btnPanelToggle.title = controlPanelOpen ? 'Collapse controls' : 'Expand controls';
      if (!skipPersist) persistUiState();
      if (!skipResize) scheduleCanvasResize();
    }

    function runPointerDrag(pointerEvent, cursor, onMove, onFinish) {
      const previousCursor = document.body.style.cursor;
      document.body.style.cursor = cursor;
      if (pointerEvent.target && typeof pointerEvent.target.setPointerCapture === 'function') {
        pointerEvent.target.setPointerCapture(pointerEvent.pointerId);
      }

      const handleMove = (event) => onMove(event);
      const handleUp = () => {
        document.body.style.cursor = previousCursor;
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        if (typeof onFinish === 'function') onFinish();
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    }

    function beginSequenceResize(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = sequenceRegionCollapsed
        ? LAYOUT_TUNING.sequenceCollapsed
        : sequenceRegion.getBoundingClientRect().height;

      runPointerDrag(event, 'ns-resize', (moveEvent) => {
        const rawHeight = startHeight + (moveEvent.clientY - startY);
        if (rawHeight <= LAYOUT_TUNING.sequenceCollapseThreshold) {
          sequenceRegionCollapsed = true;
        } else {
          sequenceRegionCollapsed = false;
          sequenceExpandedHeight = clampSequenceHeight(rawHeight);
        }
        applySequenceRegionState({ skipPersist: true });
      }, () => {
        persistUiState();
      });
    }

    function beginPanelResize(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = controlPanelOpen
        ? controlPanel.getBoundingClientRect().width
        : LAYOUT_TUNING.panelCollapsed;

      runPointerDrag(event, 'ew-resize', (moveEvent) => {
        const rawWidth = startWidth - (moveEvent.clientX - startX);
        if (rawWidth <= LAYOUT_TUNING.panelCollapseThreshold) {
          controlPanelOpen = false;
        } else {
          controlPanelOpen = true;
          controlPanelExpandedWidth = clampPanelWidth(rawWidth);
        }
        applyControlPanelState({ skipPersist: true });
      }, () => {
        persistUiState();
      });
    }

    function clampLayoutState() {
      sequenceExpandedHeight = clampSequenceHeight(sequenceExpandedHeight);
      controlPanelExpandedWidth = clampPanelWidth(controlPanelExpandedWidth);
      applySequenceRegionState({ skipPersist: true });
      applyControlPanelState({ skipPersist: true });
    }

    // ── Camera & Orbit Setup ─────────────────────────────────────────────────
    const orbitTarget = new THREE.Vector3();
    let isDragging = false;
    let lastMouse = { x: 0, y: 0 };
    let dragMode = 'rotate';

    let boundRadius = 20.0;

    function getCameraOffset() {
      return new THREE.Vector3().subVectors(camera.position, orbitTarget);
    }

    function quantile(sorted, q) {
      if (!sorted.length) return 0;
      if (sorted.length === 1) return sorted[0];
      const clampedQ = Math.max(0, Math.min(1, q));
      const idx = (sorted.length - 1) * clampedQ;
      const lower = Math.floor(idx);
      const upper = Math.min(sorted.length - 1, lower + 1);
      const t = idx - lower;
      return sorted[lower] * (1 - t) + sorted[upper] * t;
    }

    function collectVisibleFramingIndices() {
      const visible = [];
      for (let i = 0; i < atomCount; i++) {
        if (!hiddenAtomSet.has(i)) visible.push(i);
      }
      if (visible.length > 0) {
        return visible;
      }
      return Array.from({ length: atomCount }, (_, idx) => idx);
    }

    function computeFramingBounds(pos, indices) {
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

      for (let i = 0; i < indices.length; i++) {
        const atomIndex = indices[i];
        const x = pos[atomIndex * 3];
        const y = pos[atomIndex * 3 + 1];
        const z = pos[atomIndex * 3 + 2];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
      }

      if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
        return {
          center: new THREE.Vector3(0, 0, 0),
          fullMin: { x: 0, y: 0, z: 0 },
          fullMax: { x: 1, y: 1, z: 1 },
          robustMin: { x: 0, y: 0, z: 0 },
          robustMax: { x: 1, y: 1, z: 1 },
          fullRadius: 1,
          robustRadius: 1,
          sampledAxisPoints: 0,
        };
      }

      const fullCenter = new THREE.Vector3(
        (minX + maxX) * 0.5,
        (minY + maxY) * 0.5,
        (minZ + maxZ) * 0.5
      );
      const fullDiag = new THREE.Vector3(maxX - minX, maxY - minY, maxZ - minZ).length();
      const fullRadius = Math.max(1e-3, fullDiag * 0.5);

      const sampleLimit = 30000;
      const sampleStep = Math.max(1, Math.ceil(indices.length / sampleLimit));
      const xs = [];
      const ys = [];
      const zs = [];
      for (let i = 0; i < indices.length; i += sampleStep) {
        const atomIndex = indices[i];
        xs.push(pos[atomIndex * 3]);
        ys.push(pos[atomIndex * 3 + 1]);
        zs.push(pos[atomIndex * 3 + 2]);
      }
      xs.sort((a, b) => a - b);
      ys.sort((a, b) => a - b);
      zs.sort((a, b) => a - b);

      const lowQ = 0.02;
      const highQ = 0.98;
      let robustMin = {
        x: quantile(xs, lowQ),
        y: quantile(ys, lowQ),
        z: quantile(zs, lowQ),
      };
      let robustMax = {
        x: quantile(xs, highQ),
        y: quantile(ys, highQ),
        z: quantile(zs, highQ),
      };

      const minRobustSpan = 0.1;
      const fullSpan = {
        x: Math.max(1e-6, maxX - minX),
        y: Math.max(1e-6, maxY - minY),
        z: Math.max(1e-6, maxZ - minZ),
      };
      const robustSpan = {
        x: robustMax.x - robustMin.x,
        y: robustMax.y - robustMin.y,
        z: robustMax.z - robustMin.z,
      };
      if (robustSpan.x < fullSpan.x * minRobustSpan) {
        robustMin.x = minX;
        robustMax.x = maxX;
      }
      if (robustSpan.y < fullSpan.y * minRobustSpan) {
        robustMin.y = minY;
        robustMax.y = maxY;
      }
      if (robustSpan.z < fullSpan.z * minRobustSpan) {
        robustMin.z = minZ;
        robustMax.z = maxZ;
      }

      const robustCenter = new THREE.Vector3(
        (robustMin.x + robustMax.x) * 0.5,
        (robustMin.y + robustMax.y) * 0.5,
        (robustMin.z + robustMax.z) * 0.5
      );
      const robustDiag = new THREE.Vector3(
        robustMax.x - robustMin.x,
        robustMax.y - robustMin.y,
        robustMax.z - robustMin.z
      ).length();
      const robustRadius = Math.max(1e-3, robustDiag * 0.5);

      return {
        center: robustCenter,
        fullCenter,
        fullMin: { x: minX, y: minY, z: minZ },
        fullMax: { x: maxX, y: maxY, z: maxZ },
        robustMin,
        robustMax,
        fullRadius,
        robustRadius,
        sampledAxisPoints: xs.length,
      };
    }

    function fitCamera() {
      const pos = getFrameData(0) || firstFrame;
      if (!pos) return;

      const visibleIndices = collectVisibleFramingIndices();
      const bounds = computeFramingBounds(pos, visibleIndices);
      const center = bounds.center;
      const framingRadius = Math.max(bounds.robustRadius, bounds.fullRadius * 0.35, 1e-3);
      boundRadius = framingRadius;
      const cameraDistance = Math.max(framingRadius * 2.55, bounds.fullRadius * 1.45, 8);

      camera.position.set(center.x, center.y, center.z + cameraDistance);
      camera.up.set(0, 1, 0);
      camera.lookAt(center);
      orbitTarget.copy(center);

      camera.near = Math.max(0.05, cameraDistance - (bounds.fullRadius * 2.4));
      camera.far = Math.max(camera.near + 50, cameraDistance + (bounds.fullRadius * 3.5));
      camera.updateProjectionMatrix();

      sendWebviewCheckpoint('CHK_UX_15_INITIAL_BOUNDS', {
        visibleAtomCountForFraming: visibleIndices.length,
        sampledAxisPoints: bounds.sampledAxisPoints,
        fullBoundsMin: vectorToObject(new THREE.Vector3(bounds.fullMin.x, bounds.fullMin.y, bounds.fullMin.z)),
        fullBoundsMax: vectorToObject(new THREE.Vector3(bounds.fullMax.x, bounds.fullMax.y, bounds.fullMax.z)),
        robustBoundsMin: vectorToObject(new THREE.Vector3(bounds.robustMin.x, bounds.robustMin.y, bounds.robustMin.z)),
        robustBoundsMax: vectorToObject(new THREE.Vector3(bounds.robustMax.x, bounds.robustMax.y, bounds.robustMax.z)),
        fullRadius: roundNumber(bounds.fullRadius),
        robustRadius: roundNumber(bounds.robustRadius),
      });
      sendWebviewCheckpoint('CHK_SOLV_11_INITIAL_BOUNDS', {
        ...checkpointContext,
        visibleAtomCountForFraming: visibleIndices.length,
        sampledAxisPoints: bounds.sampledAxisPoints,
        fullBoundsMin: vectorToObject(new THREE.Vector3(bounds.fullMin.x, bounds.fullMin.y, bounds.fullMin.z)),
        fullBoundsMax: vectorToObject(new THREE.Vector3(bounds.fullMax.x, bounds.fullMax.y, bounds.fullMax.z)),
        robustBoundsMin: vectorToObject(new THREE.Vector3(bounds.robustMin.x, bounds.robustMin.y, bounds.robustMin.z)),
        robustBoundsMax: vectorToObject(new THREE.Vector3(bounds.robustMax.x, bounds.robustMax.y, bounds.robustMax.z)),
        fullRadius: roundNumber(bounds.fullRadius),
        robustRadius: roundNumber(bounds.robustRadius),
      });
      sendWebviewCheckpoint('CHK_UX_16_INITIAL_CAMERA_TARGET', {
        target: vectorToObject(center),
        cameraPosition: vectorToObject(camera.position),
        cameraDistance: roundNumber(cameraDistance),
      });
      sendWebviewCheckpoint('CHK_SOLV_12_INITIAL_CAMERA_TARGET', {
        ...checkpointContext,
        target: vectorToObject(center),
        cameraPosition: vectorToObject(camera.position),
        cameraDistance: roundNumber(cameraDistance),
      });
      sendWebviewCheckpoint('CHK_UX_17_CLIP_OR_SLAB_VALUES', {
        near: roundNumber(camera.near, 6),
        far: roundNumber(camera.far, 6),
        boundRadius: roundNumber(boundRadius),
        cameraDistance: roundNumber(cameraDistance),
      });
      sendWebviewCheckpoint('CHK_SOLV_13_CLIP_VALUES', {
        ...checkpointContext,
        near: roundNumber(camera.near, 6),
        far: roundNumber(camera.far, 6),
        boundRadius: roundNumber(boundRadius),
        cameraDistance: roundNumber(cameraDistance),
      });

      updateAbstractions();
    }

    function updateCameraClipRange() {
      const distance = camera.position.distanceTo(orbitTarget);
      const near = Math.max(0.05, distance - (boundRadius * 4.0));
      const far = Math.max(near + 50, distance + (boundRadius * 6.0));
      const nearChanged = Math.abs(camera.near - near) > 1e-4;
      const farChanged = Math.abs(camera.far - far) > 1e-4;
      if (nearChanged || farChanged) {
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
      }
    }

    function tumble(dx, dy) {
      const cameraOffset = getCameraOffset();
      if (cameraOffset.lengthSq() === 0) return;

      const yaw = dx * CONTROL_TUNING.rotationSensitivity * CONTROL_TUNING.horizontalRotationSign;
      const pitch = dy * CONTROL_TUNING.rotationSensitivity * CONTROL_TUNING.verticalRotationSign;

      if (yaw !== 0) {
        const yawAxis = camera.up.clone().normalize();
        const yawRotation = new THREE.Quaternion().setFromAxisAngle(yawAxis, yaw);
        cameraOffset.applyQuaternion(yawRotation);
        camera.up.applyQuaternion(yawRotation).normalize();
      }

      if (pitch !== 0) {
        const viewDir = cameraOffset.clone().negate().normalize();
        const rightAxis = new THREE.Vector3().crossVectors(viewDir, camera.up).normalize();
        if (rightAxis.lengthSq() > 0) {
          const pitchRotation = new THREE.Quaternion().setFromAxisAngle(rightAxis, pitch);
          cameraOffset.applyQuaternion(pitchRotation);
          camera.up.applyQuaternion(pitchRotation).normalize();
        }
      }

      camera.position.copy(orbitTarget).add(cameraOffset);
      camera.lookAt(orbitTarget);
    }

    function pan(dx, dy) {
      const cameraOffset = getCameraOffset();
      const radius = Math.max(cameraOffset.length(), 0.1);
      const lookDir = new THREE.Vector3().subVectors(orbitTarget, camera.position).normalize();
      const right   = new THREE.Vector3().crossVectors(lookDir, camera.up).normalize();
      const camUp   = camera.up.clone().normalize();
      const speed   = radius * CONTROL_TUNING.panSensitivity;
      const panOffset  = new THREE.Vector3()
        .addScaledVector(right, -dx * speed)
        .addScaledVector(camUp,  dy * speed);
      orbitTarget.add(panOffset);
      camera.position.add(panOffset);
      camera.lookAt(orbitTarget);
    }

    function zoom(deltaY) {
      const cameraOffset = getCameraOffset();
      const zoomScale = Math.max(0.1, 1 + deltaY * CONTROL_TUNING.zoomSensitivity);
      const nextRadius = Math.max(boundRadius * 0.05, cameraOffset.length() * zoomScale);
      cameraOffset.setLength(nextRadius);
      camera.position.copy(orbitTarget).add(cameraOffset);
      camera.lookAt(orbitTarget);
    }

    let cameraTween = null;

    function startCameraTransitionToDistance(nextTarget, endDistance) {
      const currentOffset = getCameraOffset();
      const direction = currentOffset.lengthSq() > 0
        ? currentOffset.clone().normalize()
        : new THREE.Vector3(0, 0, 1);
      cameraTween = {
        startTarget: orbitTarget.clone(),
        endTarget: nextTarget.clone(),
        startPosition: camera.position.clone(),
        endPosition: nextTarget.clone().addScaledVector(direction, Math.max(endDistance, 0.1)),
        startUp: camera.up.clone(),
        endUp: camera.up.clone(),
        progress: 0,
        speed: 0.08,
      };
    }

    function startCameraTransition(nextTarget, zoomFactor, minDistance) {
      const startTarget = orbitTarget.clone();
      const startPosition = camera.position.clone();
      const currentOffset = getCameraOffset();
      const baseDistance = Math.max(currentOffset.length(), boundRadius * 0.08, minDistance || 0);
      const endDistance = Math.max(minDistance || 0, baseDistance * zoomFactor);
      const endOffset = currentOffset.lengthSq() > 0
        ? currentOffset.clone().setLength(endDistance)
        : new THREE.Vector3(0, 0, endDistance);

      cameraTween = {
        startTarget,
        endTarget: nextTarget.clone(),
        startPosition,
        endPosition: nextTarget.clone().add(endOffset),
        startUp: camera.up.clone(),
        endUp: camera.up.clone(),
        progress: 0,
        speed: 0.08,
      };
    }

    function computeResidueFocus(resId, pos) {
      const residue = residueEntries[resId];
      if (!residue) return null;

      const center = new THREE.Vector3();
      let radiusSq = 0;
      for (let i = 0; i < residue.atomIndices.length; i++) {
        const atomIndex = residue.atomIndices[i];
        center.x += pos[atomIndex * 3];
        center.y += pos[atomIndex * 3 + 1];
        center.z += pos[atomIndex * 3 + 2];
      }
      center.divideScalar(Math.max(residue.atomIndices.length, 1));

      for (let i = 0; i < residue.atomIndices.length; i++) {
        const atomIndex = residue.atomIndices[i];
        const dx = pos[atomIndex * 3] - center.x;
        const dy = pos[atomIndex * 3 + 1] - center.y;
        const dz = pos[atomIndex * 3 + 2] - center.z;
        radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
      }

      return {
        center,
        radius: Math.sqrt(radiusSq),
      };
    }

    function focusResidueById(resId, source = 'focusResidueById') {
      const pos = getFrameData(currentFrame);
      if (!pos) return;
      const focus = computeResidueFocus(resId, pos);
      if (!focus) return;
      const residue = residueEntries[resId] || null;
      const classification = residue
        ? residueClassLabel(residue)
        : 'unknown';
      const preCameraState = cameraStateSnapshot();
      const preForward = cameraForwardVector();
      const preQuaternion = camera.quaternion.clone();
      if (isAmberFlow && residue) {
        sendWebviewCheckpoint('CHK_AMBER_SEL_1_RESIDUE_CLICKED', {
          residueId: resId,
          residueName: residue.resName,
          residueSeq: residue.resSeq,
          chainId: residue.chainId || '',
          classification: residueClassLabel(residue),
          source,
        });
      }
      if (parityCheckpointsEnabled && residue) {
        sendWebviewCheckpoint('CHK_PARITY_SEL_1_RESIDUE_CLICKED', {
          referenceCaseId: referenceHarness.caseId,
          residueId: resId,
          residueName: residue.resName,
          residueSeq: residue.resSeq,
          chainId: residue.chainId || '',
          classification,
          source,
        });
        sendWebviewCheckpoint('CHK_PARITY_CAM_1_PRE_FOCUS_CAMERA_STATE', {
          referenceCaseId: referenceHarness.caseId,
          residueId: resId,
          residueName: residue.resName,
          preFocus: preCameraState,
        });
      }
      if (dcdNcParityFormatPrefix && residue) {
        emitDcdNcParityCheckpoint(1, 'RESIDUE_CLICKED', {
          residueId: resId,
          residueName: residue.resName,
          residueSeq: residue.resSeq,
          chainId: residue.chainId || '',
          classification,
          source,
        });
      }

      const minDistance = Math.max(boundRadius * 0.12, focus.radius * 10);
      parityFocusState = {
        residueId: resId,
        residueName: residue ? residue.resName : null,
        preForward,
        preQuaternion,
        focusTarget: focus.center.clone(),
        minDistance: roundNumber(minDistance),
        focusRadius: roundNumber(focus.radius),
        boundRadius: roundNumber(boundRadius),
      };
      if (parityCheckpointsEnabled && residue) {
        sendWebviewCheckpoint('CHK_PARITY_CAM_2_FOCUS_TARGET', {
          referenceCaseId: referenceHarness.caseId,
          residueId: resId,
          residueName: residue.resName,
          focusTarget: vectorToObject(focus.center),
          focusRadius: roundNumber(focus.radius),
          boundRadius: roundNumber(boundRadius),
          minDistance: roundNumber(minDistance),
        });
      }
      startCameraTransition(focus.center, 0.82, minDistance);
      setSelectedResidue(resId);
    }

    function pickResidueAtClientPoint(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      if (
        clientX < rect.left || clientX > rect.right ||
        clientY < rect.top || clientY > rect.bottom
      ) {
        return null;
      }

      const mouse = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.params.Points.threshold = Math.max(matSelectedResidue.size * 0.5, matSelectedContext.size * 0.5, 0.55);
      raycaster.setFromCamera(mouse, camera);

      const intersects = raycaster.intersectObjects(raycastMeshes);
      for (const hit of intersects) {
        const globalIndices = hit.object.userData.globalIndices;
        if (!globalIndices || hit.index === undefined) continue;
        const globalIdx = globalIndices[hit.index];
        const resId = atomToResidue[globalIdx];
        if (resId !== undefined && residueEntries[resId]) {
          return resId;
        }
      }

      return null;
    }

    function handleSceneClick(clientX, clientY) {
      const resId = pickResidueAtClientPoint(clientX, clientY);
      if (resId !== null) {
        focusResidueById(resId, 'scene_click');
      } else {
        resetSelectionAndOverview();
      }
    }

    // ── Continuous Abstraction Logic ──────────────────────────────────────────
    const aggroSlider = document.getElementById('abstraction-slider');
    
    function updateAbstractions() {
      if (!hasTopology) return;

      const sliderVal = parseInt(aggroSlider.value, 10);
      const effectiveBlend = sliderVal / 100.0;
      const atomVisibility = Math.max(0, 1.0 - effectiveBlend);
      applyLineAppearance();

      matBase.opacity = atomVisibility;
      matBase.visible = matBase.opacity > 0.05;

      if (matProteinBonds) {
        matProteinBonds.visible = proteinBondPairs.length > 0;
      }

      matTrace.visible = caLinePairs.length > 0;

      matCa.size = 0.55;
      matCa.opacity = atomVisibility;
      matCa.visible = matCa.opacity > 0.05;
      matLigands.size = 1.2;
      matSelectedContext.size = matLigands.size;
      matLocalContextIons.size = matLigands.size;
      matLigands.opacity = atomVisibility;
      matLigands.visible = ligandIonIndices.length > 0 && matLigands.opacity > 0.05;
      matSelectedResidue.size = Math.max(matLigands.size + 0.32, matCa.size + 0.48, matBase.size + 0.72, 1.25);
      if (matLigandBonds) {
        matLigandBonds.visible = ligandBondPairs.length > 0;
      }
    }

    aggroSlider.addEventListener('input', () => { updateAbstractions(); renderScene(); });
    btnBackground.addEventListener('click', () => {
      backgroundMode = backgroundMode === 'white' ? 'black' : 'white';
      applyViewerTheme();
      renderScene();
    });
    if (btnChangeSettings) {
      btnChangeSettings.addEventListener('click', () => {
        const hasOverrides = Boolean(reopenSettingsAutodriveOptions);
        sendWebviewCheckpoint('CHK_REOPEN_2_BUTTON_CLICKED', {
          source: 'viewer_button',
          hasOverrides,
          autoConfirm: reopenSettingsAutodriveAutoConfirm,
          trajectoryPath: debugContext.trajectoryPath || null,
          topologyPath: debugContext.topologyPath || null,
        });
        if (vscode) {
          vscode.postMessage({
            type: 'reopenSettings',
            source: 'viewer_button',
            optionsOverrides: hasOverrides ? reopenSettingsAutodriveOptions : undefined,
            autoConfirm: reopenSettingsAutodriveAutoConfirm,
          });
        }
      });
    }
    btnSeqMode.addEventListener('click', () => {
      sequenceMode = sequenceMode === 'three' ? 'one' : 'three';
      applySequenceMode();
    });
    localRadiusSlider.addEventListener('input', () => {
      localContextRadius = normalizeLocalContextRadius(parseFloat(localRadiusSlider.value));
      localRadiusValue.textContent = formatLocalContextRadius(localContextRadius);
      persistUiState();
      const currentFramePos = getFrameData(currentFrame);
      if (selectedResidueId !== null && currentFramePos) {
        rebuildLocalContextOverlay(currentFramePos);
        renderScene();
      }
    });
    btnSequenceToggle.addEventListener('click', () => {
      sequenceRegionCollapsed = !sequenceRegionCollapsed;
      applySequenceRegionState();
    });
    btnPanelToggle.addEventListener('click', () => {
      controlPanelOpen = !controlPanelOpen;
      applyControlPanelState();
    });
    sequenceResizer.addEventListener('pointerdown', beginSequenceResize);
    panelResizer.addEventListener('pointerdown', beginPanelResize);

    // Interaction Events
    const CLICK_SLOP = 4;
    let clickCandidate = false;
    let dragStart = { x: 0, y: 0 };

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;

      isDragging = true;
      dragMode = (e.metaKey || e.ctrlKey) ? 'pan' : 'rotate';
      lastMouse = { x: e.clientX, y: e.clientY };
      dragStart = { x: e.clientX, y: e.clientY };
      clickCandidate = dragMode === 'rotate';
    });

    window.addEventListener('mouseup', (e) => {
      if (!isDragging) return;
      const shouldHandleClick = clickCandidate && e.button === 0;
      isDragging = false;
      clickCandidate = false;
      if (shouldHandleClick) {
        handleSceneClick(e.clientX, e.clientY);
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      lastMouse = { x: e.clientX, y: e.clientY };

      if (
        Math.abs(e.clientX - dragStart.x) > CLICK_SLOP ||
        Math.abs(e.clientY - dragStart.y) > CLICK_SLOP
      ) {
        clickCandidate = false;
      }

      if (dragMode === 'pan' || e.metaKey || e.ctrlKey) {
        pan(dx, dy);
      } else if (!clickCandidate) {
        tumble(dx, dy);
      }
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoom(e.deltaY);
    }, { passive: false });

    function resize() {
      const w = Math.max(container.clientWidth, 1);
      const h = Math.max(container.clientHeight, 1);
      currentDevicePixelRatio = readDevicePixelRatio();
      renderer.setPixelRatio(currentDevicePixelRatio);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      syncScreenSpaceLineMaterials();
    }
    function syncDevicePixelRatioIfNeeded() {
      const nextDevicePixelRatio = readDevicePixelRatio();
      if (Math.abs(nextDevicePixelRatio - currentDevicePixelRatio) <= 1e-6) {
        return;
      }
      resize();
    }
    new ResizeObserver(() => { clampLayoutState(); }).observe(app);
    new ResizeObserver(resize).observe(container);
    window.addEventListener('resize', scheduleCanvasResize);

    // ── Frame Application ────────────────────────────────────────────────────
    let currentFrame = 0;
    let pendingFrameTarget = null;
    let isPlaying = false;
    let fps = parseInt(document.getElementById('fps-slider').value, 10);
    let lastFrameTime = 0;

    const btnPlay      = document.getElementById('btn-play');

    activeTrajectoryMessageHandler = (message) => {
      const pending = frameRequestState.pendingById.get(message.requestId);
      if (!pending) return;
      frameRequestState.pendingById.delete(message.requestId);
      frameRequestState.pendingByChunkKey.delete(pending.chunkKey);

      if (message.type === 'trajectoryFrameChunkError') {
        pending.reject(new Error(message.error || 'Unknown chunk error'));
        return;
      }

      const frameIndices = Array.isArray(message.frameIndices) ? message.frameIndices.map((value) => Number(value)) : [];
      const rawFrameIndices = Array.isArray(message.rawFrameIndices)
        ? message.rawFrameIndices.map((value) => Number(value))
        : frameIndices.map((frameIndex) => frameIndex * samplingFrameStride);
      const chunkFrames = Array.isArray(message.frames) ? message.frames : [];
      cacheChunkFrames(frameIndices, chunkFrames, rawFrameIndices);
      setSliderLimitFromLoadedWindow();
      refreshFrameStatusText();
      sendWebviewCheckpoint('CHK_UX_13_CHUNK_ARRIVED', {
        requestId: message.requestId || null,
        returnedFrameCount: chunkFrames.length,
        returnedVirtualFrameIndicesSample: frameIndices.slice(0, 12),
        returnedRawFrameIndicesSample: rawFrameIndices.slice(0, 12),
        loadedFrameWindow: loadedFrameWindow(),
      });

      pending.resolve({
        frameIndices,
        frames: chunkFrames,
      });
    };

    function applyFramePosition(pos) {
      if (!pos) return;

      applyPos(baseAtomIndices, pos, posBase);
      attrBase.needsUpdate = true;

      if (hasTopology) {
        applyPos(caIndices, pos, posCa);
        attrCa.needsUpdate = true;

        applyPos(ligandIonIndices, pos, posLigands);
        attrLigands.needsUpdate = true;

        applyTrace(caLinePairs, pos, posTrace);
        markScreenSpaceLinePositionsDirty(geoTrace);
      }

      if (proteinBondPairs && geoProteinBonds) {
        applyTrace(proteinBondPairs, pos, proteinBondPos);
        markScreenSpaceLinePositionsDirty(geoProteinBonds);
      }

      if (ligandBondPairs && geoLigandBonds) {
        applyTrace(ligandBondPairs, pos, ligandBondPos);
        markScreenSpaceLinePositionsDirty(geoLigandBonds);
      }

      updateSelectedResidueOverlay(pos);
      updateSelectedResidueBondOverlay(pos);
      rebuildLocalContextOverlay(pos);

      sliderPos.value = currentFrame;
      frameCounter.textContent = frameCounterText(currentFrame);
      sendWebviewCheckpoint('CHK_UX_14_ACTIVE_FRAME_UPDATED', {
        activeVirtualFrameIndex: currentFrame,
        activeRawFrameIndex: rawFrameIndexForVirtual(currentFrame),
        loadedFrameWindow: loadedFrameWindow(),
      });
    }

    function requestFrameChunk(start, count, stride = 1) {
      if (!supportsFrameRequests || !vscode) {
        return Promise.reject(new Error('Chunk requests are unavailable in this viewer session.'));
      }

      const safeStart = Math.max(0, Math.floor(start));
      const safeCount = Math.max(1, Math.floor(count));
      const safeStride = Math.max(1, Math.floor(stride));
      const chunkKey = frameChunkKey(safeStart, safeCount, safeStride);
      const existing = frameRequestState.pendingByChunkKey.get(chunkKey);
      if (existing) {
        return existing;
      }

      const requestId = `chunk-${Date.now()}-${frameRequestState.sequence++}`;
      const promise = new Promise((resolve, reject) => {
        frameRequestState.pendingById.set(requestId, { resolve, reject, chunkKey });
        vscode.postMessage({
          type: 'trajectoryFrameChunkRequest',
          requestId,
          start: safeStart,
          count: safeCount,
          stride: safeStride,
        });
      });
      frameRequestState.pendingByChunkKey.set(chunkKey, promise);
      return promise;
    }

    function ensureFrameAvailable(frameIndex) {
      const cached = getFrameData(frameIndex);
      if (cached) {
        return Promise.resolve(cached);
      }
      if (!supportsFrameRequests) {
        return Promise.reject(new Error(`Frame ${frameIndex} is not loaded and chunk requests are disabled.`));
      }

      const halfWindow = Math.floor(chunkSizeHint / 2);
      const start = Math.max(0, frameIndex - halfWindow);
      const remaining = Math.max(0, totalFrameCount - start);
      const count = Math.max(1, Math.min(chunkSizeHint, remaining));
      refreshFrameStatusText(' (fetching)');

      return requestFrameChunk(start, count, 1).then(() => {
        const resolved = getFrameData(frameIndex);
        if (!resolved) {
          throw new Error(`Chunk response did not include requested frame ${frameIndex}`);
        }
        return resolved;
      });
    }

    function setFrame(n) {
      const requestedVirtualFrame = Math.max(0, Math.min(totalFrameCount - 1, n));
      const windowState = loadedFrameWindow();
      let targetVirtualFrame = requestedVirtualFrame;
      let clampedToLoadedWindow = false;

      sendWebviewCheckpoint('CHK_UX_10_REQUESTED_FRAME_INDEX', {
        requestedVirtualFrameIndex: requestedVirtualFrame,
        requestedRawFrameIndex: rawFrameIndexForVirtual(requestedVirtualFrame),
        totalFrameCount,
      });
      sendWebviewCheckpoint('CHK_UX_11_LOADED_FRAME_WINDOW', {
        loadedFrameWindow: windowState,
      });

      if (supportsFrameRequests && requestedVirtualFrame > windowState.contiguousEnd) {
        targetVirtualFrame = windowState.contiguousEnd;
        clampedToLoadedWindow = true;
        pendingFrameTarget = requestedVirtualFrame;

        sendWebviewCheckpoint('CHK_UX_12_FRAME_REQUEST_CLAMPED_OR_WAITING', {
          requestedVirtualFrameIndex: requestedVirtualFrame,
          requestedRawFrameIndex: rawFrameIndexForVirtual(requestedVirtualFrame),
          activeVirtualFrameIndexBeforeClamp: currentFrame,
          clampedVirtualFrameIndex: targetVirtualFrame,
          clampedRawFrameIndex: rawFrameIndexForVirtual(targetVirtualFrame),
          loadedFrameWindow: windowState,
          waitingForChunk: true,
        });

        if (windowState.contiguousEnd < totalFrameCount - 1) {
          const nextStart = Math.max(0, windowState.contiguousEnd + 1);
          const remaining = Math.max(0, totalFrameCount - nextStart);
          const requestCount = Math.max(1, Math.min(chunkSizeHint, remaining));
          refreshFrameStatusText(' (fetching next chunk)');
          void requestFrameChunk(nextStart, requestCount, 1)
            .then(() => {
              setSliderLimitFromLoadedWindow();
              refreshFrameStatusText();
              if (pendingFrameTarget === null || pendingFrameTarget === undefined) return;
              const refreshedWindow = loadedFrameWindow();
              const resumedTarget = Math.min(pendingFrameTarget, refreshedWindow.contiguousEnd);
              const reachedRequested = resumedTarget >= pendingFrameTarget;
              if (reachedRequested || refreshedWindow.contiguousEnd >= totalFrameCount - 1) {
                pendingFrameTarget = null;
              }
              if (resumedTarget > currentFrame) {
                setFrame(resumedTarget);
              }
            })
            .catch((err) => {
              console.warn('[WebView] Failed to prefetch next chunk:', err);
            });
        }
      } else if (!clampedToLoadedWindow) {
        pendingFrameTarget = null;
      }

      currentFrame = targetVirtualFrame;
      const pos = getFrameData(currentFrame);
      if (pos) {
        applyFramePosition(pos);
        return;
      }

      sliderPos.value = currentFrame;
      frameCounter.textContent = frameCounterText(currentFrame, ' (loading...)');
      sendWebviewCheckpoint('CHK_UX_12_FRAME_REQUEST_CLAMPED_OR_WAITING', {
        requestedVirtualFrameIndex: requestedVirtualFrame,
        requestedRawFrameIndex: rawFrameIndexForVirtual(requestedVirtualFrame),
        activeVirtualFrameIndexBeforeClamp: currentFrame,
        clampedVirtualFrameIndex: currentFrame,
        clampedRawFrameIndex: rawFrameIndexForVirtual(currentFrame),
        loadedFrameWindow: loadedFrameWindow(),
        waitingForChunk: true,
        reason: 'frameMissingInCache',
      });
      const requestedFrame = currentFrame;
      void ensureFrameAvailable(requestedFrame)
        .then((resolvedPos) => {
          if (requestedFrame !== currentFrame) return;
          applyFramePosition(resolvedPos);
        })
        .catch((err) => {
          console.warn('[WebView] Failed to load requested frame:', err);
          frameCounter.textContent = frameCounterText(currentFrame, ' (load failed)');
        });
    }

    // Playback Hooks
    function togglePlay() {
      isPlaying = !isPlaying;
      btnPlay.innerHTML = isPlaying ? '&#9646;&#9646;' : '&#9654;';
      if (isPlaying) lastFrameTime = performance.now();
    }

    btnPlay.addEventListener('click', togglePlay);
    document.getElementById('btn-prev').addEventListener('click', () => { isPlaying = false; btnPlay.innerHTML = '&#9654;'; setFrame(currentFrame - 1); });
    document.getElementById('btn-next').addEventListener('click', () => { isPlaying = false; btnPlay.innerHTML = '&#9654;'; setFrame(currentFrame + 1); });
    sliderPos.addEventListener('input', () => { isPlaying = false; btnPlay.innerHTML = '&#9654;'; setFrame(parseInt(sliderPos.value, 10)); });

    document.getElementById('fps-slider').addEventListener('input', (e) => {
      fps = parseInt(e.target.value, 10);
      document.getElementById('fps-value').textContent = fps;
    });

    window.addEventListener('keydown', (e) => {
      if (e.target !== document.body && e.target !== canvas) return;
      switch (e.code) {
        case 'Space':      e.preventDefault(); togglePlay(); break;
        case 'ArrowRight': setFrame(currentFrame + 1); break;
        case 'ArrowLeft':  setFrame(currentFrame - 1); break;
        case 'Home':       setFrame(0); break;
        case 'End':        setFrame(totalFrameCount - 1); break;
      }
    });

    function animate(now) {
      requestAnimationFrame(animate);
      syncDevicePixelRatioIfNeeded();
      if (isPlaying) {
        const interval = 1000 / fps;
        if (now - lastFrameTime >= interval) {
          setFrame((currentFrame + 1) % totalFrameCount);
          lastFrameTime = now;
        }
      }

      if (cameraTween) {
        cameraTween.progress = Math.min(1, cameraTween.progress + (cameraTween.speed || 0.08));
        const easeStr = cameraTween.progress * (2 - cameraTween.progress);
        orbitTarget.lerpVectors(cameraTween.startTarget, cameraTween.endTarget, easeStr);
        camera.position.lerpVectors(cameraTween.startPosition, cameraTween.endPosition, easeStr);
        if (cameraTween.startUp && cameraTween.endUp) {
          camera.up.lerpVectors(cameraTween.startUp, cameraTween.endUp, easeStr).normalize();
        }
        camera.lookAt(orbitTarget);
        if (cameraTween.progress >= 1) {
          cameraTween = null;
        }
      }

      if (!cameraTween && deselectCameraCheckpointPending) {
        const postState = cameraStateSnapshot();
        const postForward = cameraForwardVector();
        const orientationDeltaDeg = angleBetweenVectorsDeg(deselectCameraCheckpointPending.preForward, postForward);
        const defaultForward = defaultOverviewState
          ? new THREE.Vector3().subVectors(defaultOverviewState.target, defaultOverviewState.position).normalize()
          : null;
        const deltaToDefaultDeg = defaultForward ? angleBetweenVectorsDeg(defaultForward, postForward) : null;
        const orientationPreserved = orientationDeltaDeg !== null ? orientationDeltaDeg <= 12 : false;
        sendWebviewCheckpoint('CHK_UX_8_POST_DESELECT_CAMERA_STATE', {
          preDeselect: deselectCameraCheckpointPending.preState,
          postDeselect: postState,
        });
        sendWebviewCheckpoint('CHK_SOLV_2_POST_DESELECT_CAMERA_STATE', {
          ...checkpointContext,
          preDeselect: deselectCameraCheckpointPending.preState,
          postDeselect: postState,
        });
        sendWebviewCheckpoint('CHK_UX_9_ORIENTATION_PRESERVED', {
          orientationPreserved,
          orientationDeltaDeg,
          orientationDeltaToDefaultDeg: deltaToDefaultDeg,
          preForward: vectorToObject(deselectCameraCheckpointPending.preForward),
          postForward: vectorToObject(postForward),
        });
        deselectCycleCount += 1;
        const previousOverviewDistance = lastDeselectOverviewDistance;
        const currentOverviewDistance = Number(postState.distanceToTarget || 0);
        const baselineOverviewDistance = Number(deselectCameraCheckpointPending.computedOverviewDistance || 0);
        const cumulativeShrinkDetected = previousOverviewDistance !== null
          ? currentOverviewDistance < (previousOverviewDistance * 0.92)
          : false;
        sendWebviewCheckpoint('CHK_SOLV_4_CUMULATIVE_SHRINK_CHECK', {
          ...checkpointContext,
          deselectCycleCount,
          previousOverviewDistance: previousOverviewDistance === null ? null : roundNumber(previousOverviewDistance),
          currentOverviewDistance: roundNumber(currentOverviewDistance),
          baselineOverviewDistance: roundNumber(baselineOverviewDistance),
          distanceRatioVsPrevious: previousOverviewDistance
            ? roundNumber(currentOverviewDistance / previousOverviewDistance, 6)
            : null,
          distanceRatioVsBaseline: baselineOverviewDistance > 0
            ? roundNumber(currentOverviewDistance / baselineOverviewDistance, 6)
            : null,
          cumulativeShrinkDetected,
        });
        lastDeselectOverviewDistance = currentOverviewDistance;
        deselectCameraCheckpointPending = null;
      }

      updateCameraClipRange();
      renderScene();
    }

    console.log('[WebView] Init sequence finished. Booting render loop.');
    buildSequenceUI();
    applySequenceRegionState({ skipPersist: true, skipResize: true });
    applyControlPanelState({ skipPersist: true, skipResize: true });
    resize();
    setFrame(0);
    if (supportsFrameRequests && totalFrameCount > 1) {
      const prefetchCount = Math.max(1, Math.min(chunkSizeHint, totalFrameCount - 1));
      void requestFrameChunk(1, prefetchCount, 1).catch((err) => {
        console.warn('[WebView] Initial prefetch failed:', err);
      });
    }
    fitCamera();
    cacheDefaultOverviewState();
    applyViewerTheme();
    updateAbstractions();
    if (uxProbeAutodrive) {
      const probeResidueName = String(debugContext.uxProbeResidueName || '').trim().toUpperCase();
      let residueTarget = null;
      if (probeResidueName) {
        for (let i = 0; i < residueEntries.length; i++) {
          const resName = String(residueEntries[i]?.resName || '').toUpperCase();
          if (resName === probeResidueName) {
            residueTarget = i;
            break;
          }
        }
      }
      if (residueTarget === null && residueEntries.length > 0) {
        residueTarget = Math.floor(residueEntries.length / 2);
      }
      if (residueTarget !== null) {
        const deselectCycles = Math.max(1, Number(debugContext.uxProbeDeselectCycles || 2));
        const cycleDurationMs = 2000;
        for (let i = 0; i < deselectCycles; i++) {
          const baseDelay = 450 + (i * cycleDurationMs);
          window.setTimeout(() => {
            focusResidueById(residueTarget, 'ux_probe_autodrive');
          }, baseDelay);
          window.setTimeout(() => {
            resetSelectionAndOverview();
          }, baseDelay + 950);
        }
      }
      if (supportsFrameRequests && totalFrameCount > 2) {
        window.setTimeout(() => {
          setFrame(totalFrameCount - 1);
        }, 2200);
      }
    }
    if (
      reopenSettingsAutodrive
      && btnChangeSettings
      && (!debugContext.loadOptions || debugContext.loadOptions.source !== 'with_options')
    ) {
      window.setTimeout(() => {
        sendWebviewCheckpoint('CHK_REOPEN_2_BUTTON_CLICKED', {
          source: 'autodrive',
          hasOverrides: Boolean(reopenSettingsAutodriveOptions),
          autoConfirm: reopenSettingsAutodriveAutoConfirm,
          trajectoryPath: debugContext.trajectoryPath || null,
          topologyPath: debugContext.topologyPath || null,
        });
        btnChangeSettings.click();
      }, reopenSettingsAutodriveDelayMs);
    }
    requestAnimationFrame(animate);
    if (referenceHarness.enabled || dcdNcParityProbeEnabled) {
      const initDelay = referenceHarness.enabled
        ? Math.max(0, referenceHarness.initCaptureDelayMs)
        : 250;
      window.setTimeout(() => {
        void (async () => {
          if (referenceHarness.enabled) {
            emitReferenceViewerInitCapture();
            await runReferenceInteractionsCapture();
          }
          if (dcdNcParityProbeEnabled) {
            await runDcdNcSequenceClickParityProbe();
          }
        })().catch((err) => {
          sendWebviewCheckpoint('CHK_DCD_PARITY_SEQ_ERROR', {
            trajectoryExt,
            message: err && err.message ? err.message : String(err),
          });
        });
      }, initDelay);
    }
  }
})();
