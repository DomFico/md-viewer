(function () {
  const vscode = acquireVsCodeApi();

  const el = {
    summaryLine: document.getElementById('summary-line'),
    summaryTrajectory: document.getElementById('summary-trajectory'),
    summaryTopology: document.getElementById('summary-topology'),
    summaryTrajFormat: document.getElementById('summary-traj-format'),
    summaryTopFormat: document.getElementById('summary-top-format'),
    summaryStatus: document.getElementById('summary-status'),
    summaryAtomCount: document.getElementById('summary-atom-count'),
    summaryFrameCount: document.getElementById('summary-frame-count'),
    trajectorySelect: document.getElementById('trajectory-select'),
    topologySelect: document.getElementById('topology-select'),
    framesPerLoad: document.getElementById('frames-per-load'),
    frameStride: document.getElementById('frame-stride'),
    selectionPreset: document.getElementById('selection-preset'),
    solventHandling: document.getElementById('solvent-handling'),
    validationList: document.getElementById('validation-list'),
    browseTrajectory: document.getElementById('browse-trajectory'),
    browseTopology: document.getElementById('browse-topology'),
    clearTopology: document.getElementById('clear-topology'),
    loadDataset: document.getElementById('load-dataset'),
    resetDefaults: document.getElementById('reset-defaults'),
    cancelSetup: document.getElementById('cancel-setup'),
  };

  let latestState = null;

  function parseFramesPerLoadInput(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    if (text.toLowerCase() === 'all') return 'all';
    const parsed = Number.parseInt(text, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return null;
  }

  function post(type, payload) {
    vscode.postMessage({ type, ...payload });
  }

  function setOptions(select, options, selectedValue) {
    while (select.firstChild) {
      select.removeChild(select.firstChild);
    }
    options.forEach((optionDef) => {
      const option = document.createElement('option');
      option.value = optionDef.value;
      option.textContent = optionDef.label;
      if (optionDef.description) {
        option.title = optionDef.description;
      }
      select.appendChild(option);
    });

    if (selectedValue !== undefined && selectedValue !== null) {
      select.value = String(selectedValue);
    }
  }

  function renderValidation(messages) {
    while (el.validationList.firstChild) {
      el.validationList.removeChild(el.validationList.firstChild);
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      const li = document.createElement('li');
      li.className = 'level-info';
      li.textContent = 'No validation messages.';
      el.validationList.appendChild(li);
      return;
    }
    messages.forEach((msg) => {
      const li = document.createElement('li');
      li.className = `level-${msg.level || 'info'}`;
      li.textContent = msg.message || String(msg);
      el.validationList.appendChild(li);
    });
  }

  function render(state) {
    latestState = state;
    const summary = state.summary || {};
    const options = state.options || {};
    const behavior = options.behavior || {};
    const filtering = options.filtering || {};

    el.summaryLine.textContent = summary.overview || 'Configure dataset setup before loading.';
    el.summaryTrajectory.value = summary.trajectoryPath || '';
    el.summaryTopology.value = summary.topologyPath || 'None';
    el.summaryTrajFormat.value = summary.trajectoryFormat || 'unknown';
    el.summaryTopFormat.value = summary.topologyFormat || 'none';
    el.summaryStatus.value = summary.status || 'unknown';
    el.summaryAtomCount.value = summary.atomCount !== null && summary.atomCount !== undefined ? String(summary.atomCount) : 'unknown';
    el.summaryFrameCount.value = summary.frameCount !== null && summary.frameCount !== undefined ? String(summary.frameCount) : 'unknown';

    const trajectoryOptions = (state.candidates?.trajectory || []).map((candidate) => ({
      value: candidate.path,
      label: candidate.recommended ? `${candidate.label} (Recommended)` : candidate.label,
      description: candidate.path,
    }));
    setOptions(el.trajectorySelect, trajectoryOptions, options.resolution?.trajectoryPathOverride || summary.trajectoryPath);

    const topologyOptions = [
      { value: '__none__', label: 'None (No Companion Topology)', description: 'No companion topology file selected' },
      ...(state.candidates?.topology || []).map((candidate) => ({
        value: candidate.path,
        label: candidate.recommended ? `${candidate.label} (Recommended)` : candidate.label,
        description: candidate.path,
      })),
    ];
    const selectedTopology = options.resolution?.topologyPathOverride === null
      ? '__none__'
      : (options.resolution?.topologyPathOverride || summary.topologyPath || '__none__');
    setOptions(el.topologySelect, topologyOptions, selectedTopology);

    const framesPerLoadValue = behavior.framesPerLoad;
    el.framesPerLoad.value = framesPerLoadValue === 'all'
      ? 'All'
      : String(Number.isFinite(Number(framesPerLoadValue)) && Number(framesPerLoadValue) > 0 ? Number(framesPerLoadValue) : 25);
    el.frameStride.value = String(behavior.frameStride || 1);
    el.selectionPreset.value = filtering.selectionPreset || 'everything';
    el.solventHandling.value = filtering.solventHandling || 'keep_all';

    renderValidation(state.validation?.messages || []);
    el.loadDataset.disabled = Boolean(state.validation?.blocking);
  }

  el.trajectorySelect.addEventListener('change', () => {
    post('setupPanelSelectTrajectory', { trajectoryPath: el.trajectorySelect.value });
  });

  el.topologySelect.addEventListener('change', () => {
    const value = el.topologySelect.value;
    post('setupPanelSelectTopology', { topologyPath: value === '__none__' ? null : value });
  });

  el.browseTrajectory.addEventListener('click', () => {
    post('setupPanelBrowseTrajectory', {});
  });

  el.browseTopology.addEventListener('click', () => {
    post('setupPanelBrowseTopology', {});
  });

  el.clearTopology.addEventListener('click', () => {
    post('setupPanelSelectTopology', { topologyPath: null });
  });

  el.framesPerLoad.addEventListener('change', () => {
    const parsed = parseFramesPerLoadInput(el.framesPerLoad.value);
    if (parsed === null) {
      const fallback = latestState?.options?.behavior?.framesPerLoad;
      el.framesPerLoad.value = fallback === 'all' ? 'All' : String(fallback || 25);
      return;
    }
    el.framesPerLoad.value = parsed === 'all' ? 'All' : String(parsed);
    post('setupPanelUpdateBehavior', { framesPerLoad: parsed });
  });

  el.frameStride.addEventListener('change', () => {
    const parsed = Number.parseInt(el.frameStride.value || '1', 10);
    post('setupPanelUpdateBehavior', { frameStride: Number.isFinite(parsed) && parsed > 0 ? parsed : 1 });
  });

  el.selectionPreset.addEventListener('change', () => {
    post('setupPanelUpdateFiltering', { selectionPreset: el.selectionPreset.value });
  });

  el.solventHandling.addEventListener('change', () => {
    post('setupPanelUpdateFiltering', { solventHandling: el.solventHandling.value });
  });

  el.resetDefaults.addEventListener('click', () => {
    post('setupPanelResetDefaults', {});
  });

  el.cancelSetup.addEventListener('click', () => {
    post('setupPanelCancel', {});
  });

  el.loadDataset.addEventListener('click', () => {
    post('setupPanelConfirmLoad', {});
  });

  window.addEventListener('message', (event) => {
    const message = event.data || {};
    if (message.type === 'setupPanelState') {
      render(message.state || {});
      return;
    }
    if (message.type === 'setupPanelError') {
      const text = message.error || 'Unknown setup panel error';
      post('checkpoint', {
        checkpoint: 'CHK_SETUP_WEBVIEW_ERROR',
        payload: { error: text },
      });
      alert(text);
    }
  });

  post('setupPanelReady', {});
})();
