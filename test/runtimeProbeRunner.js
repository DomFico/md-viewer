const path = require('path');
const fs = require('fs');
const vscode = require('vscode');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openDataset(targetPath, label, command = 'md-viewer.launch', commandInput = undefined) {
  const absoluteTarget = path.resolve(targetPath);
  console.log(`[RuntimeProbe] Opening ${label}: ${absoluteTarget} via ${command}`);
  appendProbeLine(`OPEN_START ${label} ${absoluteTarget} command=${command}`);
  const uri = vscode.Uri.file(absoluteTarget);
  if (commandInput !== undefined) {
    await vscode.commands.executeCommand(command, commandInput);
  } else {
    await vscode.commands.executeCommand(command, uri);
  }
  const waitMsRaw = process.env.MD_VIEWER_RUNTIME_WAIT_MS;
  const waitMs = waitMsRaw ? Math.max(0, parseInt(waitMsRaw, 10) || 0) : 3500;
  await delay(waitMs);
  await vscode.commands.executeCommand('workbench.action.closeSidebar');
  await vscode.commands.executeCommand('workbench.action.closePanel');
  await delay(300);
  appendProbeLine(`OPEN_DONE ${label}`);
}

function appendProbeLine(line) {
  const outputPath = process.env.MD_VIEWER_CHECKPOINT_LOG;
  if (!outputPath) return;
  try {
    fs.appendFileSync(outputPath, `[RUNTIME_PROBE] ${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch (err) {
    console.error(`[RuntimeProbe] Failed to append line: ${String(err)}`);
  }
}

async function runScenarioList() {
  const scenariosRaw = process.env.MD_VIEWER_RUNTIME_SCENARIOS;
  if (!scenariosRaw) {
    throw new Error('MD_VIEWER_RUNTIME_SCENARIOS env var is required');
  }

  let scenarios;
  try {
    scenarios = JSON.parse(scenariosRaw);
  } catch (err) {
    throw new Error(`Failed to parse MD_VIEWER_RUNTIME_SCENARIOS JSON: ${String(err)}`);
  }

  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error('MD_VIEWER_RUNTIME_SCENARIOS must be a non-empty array');
  }

  for (const scenario of scenarios) {
    if (!scenario || typeof scenario.path !== 'string' || typeof scenario.label !== 'string') {
      throw new Error('Each scenario must contain string fields: path and label');
    }
    const command = typeof scenario.command === 'string' ? scenario.command : 'md-viewer.launch';
    let commandInput = undefined;
    if (scenario.commandInput !== undefined && typeof scenario.commandInput === 'object') {
      commandInput = scenario.commandInput;
    } else if (
      (command === 'md-viewer.launch' || command === 'md-viewer.openDataset' || command === 'md-viewer.openDatasetWithOptions') &&
      (scenario.options !== undefined || scenario.autoConfirm === true)
    ) {
      commandInput = {
        uri: vscode.Uri.file(path.resolve(scenario.path)),
        options: scenario.options,
        autoConfirm: scenario.autoConfirm === true,
      };
    }
    await openDataset(scenario.path, scenario.label, command, commandInput);
  }
}

async function applyRuntimeConfigOverrides() {
  const raw = process.env.MD_VIEWER_RUNTIME_CONFIG_JSON;
  if (!raw) return;

  let updates;
  try {
    updates = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse MD_VIEWER_RUNTIME_CONFIG_JSON: ${String(err)}`);
  }

  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new Error('MD_VIEWER_RUNTIME_CONFIG_JSON must be a JSON object.');
  }

  for (const [key, value] of Object.entries(updates)) {
    await vscode.workspace.getConfiguration('mdViewer').update(
      key,
      value,
      vscode.ConfigurationTarget.Global
    );
    appendProbeLine(`CONFIG_UPDATE mdViewer.${key}=${JSON.stringify(value)}`);
  }
}

async function run() {
  console.log('[RuntimeProbe] Runner started');
  appendProbeLine(`RUN_START scenarios=${process.env.MD_VIEWER_RUNTIME_SCENARIOS || '<missing>'}`);
  await delay(1500);
  await applyRuntimeConfigOverrides();
  await runScenarioList();
  await delay(2500);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  appendProbeLine('RUN_COMPLETE');
  console.log('[RuntimeProbe] Runner completed');
}

module.exports = {
  run,
};
