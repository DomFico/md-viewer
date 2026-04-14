import * as vscode from 'vscode';
import * as path from 'path';
import { TrajectoryData } from '../parsing/IParser';

/**
 * Generates the full HTML document for the MD Viewer webview.
 * Trajectory data is serialised as JSON and injected into the page
 * so the webview JS can consume it without any further round-trips.
 */
export function getWebviewHtml(
  panel: vscode.WebviewPanel,
  sourceName: string,
  extensionUri: vscode.Uri
): string {
  // Use a nonce for the Content-Security-Policy
  const nonce = getNonce();

  // Resolve the media URIs that the webview is allowed to load
  const viewerScriptUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'viewer.js')
  );
  const viewerStyleUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'viewer.css')
  );
  const threeUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'three.min.js')
  );
  const lineSegmentsGeometryUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'LineSegmentsGeometry.js')
  );
  const lineMaterialUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'LineMaterial.js')
  );
  const lineSegments2Uri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'LineSegments2.js')
  );

  return /* html */ `<!DOCTYPE html>
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
  <title>MD Viewer: ${escapeHtml(sourceName)}</title>
  <link rel="stylesheet" href="${viewerStyleUri}" />
</head>
<body>
  <div id="app">
    <header id="sequence-region" data-collapsed="false">
      <div id="sequence-toolbar">
        <div id="sequence-toolbar-main">
          <button id="btn-sequence-toggle" type="button" title="Collapse sequence region" aria-expanded="true">SEQ</button>
          <button id="btn-seq-mode" type="button" title="Toggle residue label format">1L</button>
        </div>
        <span id="sequence-selection">Click a residue to focus the view</span>
      </div>
      <div id="sequence-scroll">
        <div id="sequence-content" data-sequence-mode="one"></div>
      </div>
      <div id="sequence-resizer" title="Resize sequence region" aria-hidden="true"></div>
    </header>
    <div id="workspace">
      <div id="canvas-container">
        <canvas id="viewer-canvas"></canvas>
      </div>
      <aside id="control-panel" data-collapsed="false">
        <div id="panel-resizer" title="Resize controls" aria-hidden="true"></div>
        <button id="btn-panel-toggle" type="button" title="Collapse controls" aria-expanded="true">CTRL</button>
        <div id="control-panel-body">
          <section class="panel-section">
            <h2 class="panel-heading">Playback</h2>
            <div class="control-row control-row-buttons">
              <button id="btn-prev" title="Previous frame">&#9664;</button>
              <button id="btn-play" title="Play / Pause">&#9654;</button>
              <button id="btn-next" title="Next frame">&#9654;&#9654;</button>
              <span id="frame-counter">- / -</span>
            </div>
            <input id="slider" type="range" min="0" max="0" value="0" step="1" />
          </section>
          <section class="panel-section">
            <h2 class="panel-heading">Rendering</h2>
            <label id="fps-label" class="panel-field">
              <span>FPS</span>
              <span id="fps-value">15</span>
            </label>
            <input id="fps-slider" type="range" min="1" max="60" value="15" step="1" />
            <label id="abstraction-label" class="panel-field" title="Manually control the structural abstraction visualization">
              <span>Abstraction</span>
            </label>
            <input id="abstraction-slider" type="range" min="0" max="100" value="50" step="1" />
            <label id="local-radius-label" class="panel-field" title="Local neighborhood radius for the selected residue context">
              <span>Local</span>
              <span id="local-radius-value">6.0 A</span>
            </label>
            <input id="local-radius-slider" type="range" min="0" max="12" value="6" step="0.5" />
            <div class="control-row control-row-buttons">
              <button id="btn-background" title="Toggle viewer background">Bg: Black</button>
            </div>
          </section>
        </div>
      </aside>
    </div>
    <div id="status-bar">
      <span id="status-atoms">Stage 1: HTML loaded</span>
      <span id="status-frames"></span>
      <span id="status-mode" style="margin-left: auto; color: var(--accent);"></span>
    </div>
  </div>

  <!-- We no longer inject inline JSON. Trajectory and config will come via postMessage. -->

  <!-- Three.js (local bundle) -->
  <script nonce="${nonce}" src="${threeUri}"></script>
  <script nonce="${nonce}" src="${lineSegmentsGeometryUri}"></script>
  <script nonce="${nonce}" src="${lineMaterialUri}"></script>
  <script nonce="${nonce}" src="${lineSegments2Uri}"></script>

  <!-- Our viewer logic -->
  <script nonce="${nonce}" src="${viewerScriptUri}"></script>
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
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
