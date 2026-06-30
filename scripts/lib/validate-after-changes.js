"use strict";

const { callEditorRpc } = require("./editor-rpc-client");

const DEFAULT_INITIAL_WAIT_SECONDS = 10;
const DEFAULT_RETRY_DELAY_SECONDS = 5;
const DEFAULT_STATE_ATTEMPTS = 5;
const DEFAULT_CONSOLE_COUNT = 30;

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds) * 1000));
}

function numberOption(value, fallback, min = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, parsed);
}

function integerOption(value, fallback, min = 1) {
  return Math.floor(numberOption(value, fallback, min));
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function buildRpcOptions(options, method, args = {}) {
  return {
    host: options.host,
    port: options.port,
    timeoutSeconds: options.timeoutSeconds,
    method,
    args,
  };
}

async function callStep(options, steps, method, args = {}) {
  try {
    const response = await callEditorRpc(buildRpcOptions(options, method, args));
    steps.push({
      step: method,
      success: response.success,
      message: response.message,
    });
    return response;
  } catch (error) {
    steps.push({
      step: method,
      success: false,
      message: errorMessage(error),
    });
    return null;
  }
}

function isEditorIdle(response) {
  const state = response && response.payload;
  return Boolean(
    response &&
      response.success &&
      state &&
      state.isCompiling === false &&
      state.isUpdating === false
  );
}

function buildValidationArgs(options) {
  const args = {
    refresh_assets: false,
    console_count: integerOption(options.consoleCount, DEFAULT_CONSOLE_COUNT, 1),
    include_loaded_scenes: options.includeLoadedScenes !== false,
    include_hierarchy: options.includeHierarchy === true,
  };

  if (options.scenePath) {
    args.scene_path = String(options.scenePath);
  }
  if (options.hierarchyMaxDepth !== undefined) {
    args.hierarchy_max_depth = integerOption(options.hierarchyMaxDepth, 2, 0);
  }
  if (options.hierarchyLimit !== undefined) {
    args.hierarchy_limit = integerOption(options.hierarchyLimit, 120, 1);
  }

  return args;
}

function buildResult({ steps, stateResponse, validationResponse }) {
  const editorState = stateResponse && stateResponse.payload ? stateResponse.payload : null;
  const validation = validationResponse && validationResponse.payload ? validationResponse.payload : null;
  const errorCount = validation && Number.isFinite(Number(validation.errorCount)) ? Number(validation.errorCount) : null;
  const warningCount =
    validation && Number.isFinite(Number(validation.warningCount)) ? Number(validation.warningCount) : null;
  const editorIdle = editorState && editorState.isCompiling === false && editorState.isUpdating === false;
  const validationSucceeded = Boolean(validationResponse && validationResponse.success);
  const ok = Boolean(editorIdle && validationSucceeded && errorCount === 0);

  return {
    ok,
    message: ok
      ? "Unity refreshed, domain reload settled, and console validation is clean."
      : "Unity validation after changes did not finish cleanly.",
    editorIdle,
    errorCount,
    warningCount,
    editorState,
    validation,
    steps,
  };
}

async function runValidateAfterChanges(options = {}) {
  const steps = [];
  const initialWaitSeconds = numberOption(
    options.initialWaitSeconds !== undefined ? options.initialWaitSeconds : options.waitSeconds,
    DEFAULT_INITIAL_WAIT_SECONDS,
    0
  );
  const retryDelaySeconds = numberOption(options.retryDelaySeconds, DEFAULT_RETRY_DELAY_SECONDS, 0);
  const maxStateAttempts = integerOption(options.maxStateAttempts, DEFAULT_STATE_ATTEMPTS, 1);

  if (options.clearConsoleFirst !== false) {
    await callStep(options, steps, "clear_console");
  }

  await callStep(options, steps, "refresh_assets");

  if (initialWaitSeconds > 0) {
    steps.push({ step: "wait_after_refresh", success: true, seconds: initialWaitSeconds });
    await sleep(initialWaitSeconds);
  }

  let stateResponse = null;
  for (let attempt = 1; attempt <= maxStateAttempts; attempt += 1) {
    stateResponse = await callStep(options, steps, "get_editor_state");
    if (isEditorIdle(stateResponse)) {
      break;
    }
    if (attempt < maxStateAttempts && retryDelaySeconds > 0) {
      steps.push({ step: "wait_for_editor_idle", success: true, attempt, seconds: retryDelaySeconds });
      await sleep(retryDelaySeconds);
    }
  }

  const validationResponse = await callStep(options, steps, "validate_workspace", buildValidationArgs(options));
  return buildResult({ steps, stateResponse, validationResponse });
}

module.exports = {
  runValidateAfterChanges,
  buildValidationArgs,
};
