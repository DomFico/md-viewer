import * as vscode from 'vscode';

export function getSetupPanelHtml(
  panel: vscode.WebviewPanel,
  title: string,
  extensionUri: vscode.Uri
): string {
  const nonce = getNonce();
  const scriptUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'setupPanel.js')
  );
  const styleUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'setupPanel.css')
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="
      default-src 'none';
      script-src 'nonce-${nonce}' ${panel.webview.cspSource};
      style-src ${panel.webview.cspSource} 'unsafe-inline';
      img-src ${panel.webview.cspSource} data:;
    "
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MD Dataset Setup: ${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="app">
    <header class="page-header">
      <h1>MD Dataset Setup</h1>
      <p id="summary-line">Preparing defaults…</p>
    </header>

    <section class="card" id="section-summary">
      <h2>A. Resolved Dataset Summary</h2>
      <div class="grid-two">
        <label>
          <span>Trajectory</span>
          <input id="summary-trajectory" type="text" readonly />
        </label>
        <label>
          <span>Topology</span>
          <input id="summary-topology" type="text" readonly />
        </label>
      </div>
      <div class="grid-two">
        <label>
          <span>Trajectory Format</span>
          <input id="summary-traj-format" type="text" readonly />
        </label>
        <label>
          <span>Topology Format</span>
          <input id="summary-top-format" type="text" readonly />
        </label>
      </div>
      <div class="grid-three">
        <label>
          <span>Status</span>
          <input id="summary-status" type="text" readonly />
        </label>
        <label>
          <span>Atom Count</span>
          <input id="summary-atom-count" type="text" readonly />
        </label>
        <label>
          <span>Frame Count</span>
          <input id="summary-frame-count" type="text" readonly />
        </label>
      </div>
    </section>

    <section class="card" id="section-candidates">
      <h2>B. Candidate Selection / Override</h2>
      <div class="grid-actions">
        <label>
          <span>Trajectory Candidate</span>
          <select id="trajectory-select"></select>
        </label>
        <div class="actions">
          <button id="browse-trajectory" type="button">Browse Trajectory…</button>
        </div>
      </div>
      <div class="grid-actions">
        <label>
          <span>Topology Candidate</span>
          <select id="topology-select"></select>
        </label>
        <div class="actions">
          <button id="browse-topology" type="button">Browse Topology…</button>
          <button id="clear-topology" type="button">Use No Topology</button>
        </div>
      </div>
      <p class="hint">Selections can point to files in other directories.</p>
    </section>

    <section class="card" id="section-load-behavior">
      <h2>C. Load Behavior</h2>
      <div class="grid-two">
        <label>
          <span>Load Mode</span>
          <select id="load-mode">
            <option value="fast_preview">Fast preview</option>
            <option value="standard">Standard</option>
            <option value="fuller_initial">Fuller initial load</option>
          </select>
        </label>
        <label>
          <span>Frame Stride (Sample Every Nth Frame)</span>
          <input id="frame-stride" type="number" min="1" step="1" />
        </label>
      </div>
      <p class="hint">Stride applies to both initial load and streamed chunk requests.</p>
    </section>

    <section class="card" id="section-filtering">
      <h2>D. Filtering</h2>
      <div class="grid-two">
        <label>
          <span>Base Visible Classes</span>
          <select id="selection-preset">
            <option value="everything">Everything</option>
            <option value="protein_ligand_ions">Protein + ligand + ions</option>
            <option value="protein_ligand">Protein + ligand</option>
            <option value="protein_only">Protein only</option>
          </select>
        </label>
        <label>
          <span>Solvent Visibility</span>
          <select id="solvent-handling">
            <option value="keep_all">Keep all</option>
            <option value="hide_common_solvent">Hide common solvent</option>
          </select>
        </label>
      </div>
      <p class="hint" id="filter-model-note">Base classes are always shown. Solvent visibility is controlled separately and can be added/removed regardless of base class preset.</p>
    </section>

    <section class="card" id="section-validation">
      <h2>E. Validation / Warnings</h2>
      <ul id="validation-list"></ul>
    </section>

    <section class="card" id="section-actions">
      <h2>F. Final Action</h2>
      <div class="actions-row">
        <button id="load-dataset" class="primary" type="button">Load Dataset</button>
        <button id="reset-defaults" type="button">Reset to Auto Defaults</button>
        <button id="cancel-setup" type="button">Cancel</button>
      </div>
    </section>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
