"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const { callEditorRpc, isWriteMethod, listMethods } = require("./lib/editor-rpc-client");
const { getUpdateStatus, hasBlockingUpdates } = require("./lib/update-status");
const { runValidateAfterChanges } = require("./lib/validate-after-changes");
const {
  DEFAULT_PACKAGE_URL,
  addEditorRpcDependency,
  getEditorRpcDependency,
} = require("./lib/unity-manifest");

const pluginRoot = path.resolve(__dirname, "..");
const serverVersion = "0.1.0";

const updateCheckProperties = {
  skipUpdateCheck: { type: "boolean", description: "Skip the pre-use plugin update gate for this call." },
  forceUpdateCheck: { type: "boolean", description: "Bypass the cached update status and query Git again." },
  codexUnityRepoPath: { type: "string", description: "Optional local Git repo path for codex-unity." },
  editorRpcRepoPath: { type: "string", description: "Optional local Git repo path for com.codex.editor-rpc." },
  gitProxy: { type: "string", description: "Optional Git HTTP proxy, for example http://127.0.0.1:6789." },
  updateCheckTtlSeconds: { type: "number", description: "Update status cache TTL. Default 300 seconds." },
  skipRemoteCheck: { type: "boolean", description: "Only inspect local Git state without querying remotes." },
};

const tools = [
  {
    name: "codex_unity_doctor",
    description:
      "Check CodexUnity, both plugin update states, optional Unity manifest state, and optional EditorRpc connectivity.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string", description: "Optional Unity project root." },
        host: { type: "string", description: "EditorRpc host. Default 127.0.0.1." },
        port: { type: "number", description: "EditorRpc port. Default 47841." },
        timeoutSeconds: { type: "number", description: "Connection timeout. Default 3 for doctor." },
        ...updateCheckProperties,
      },
    },
  },
  {
    name: "codex_unity_update_status",
    description: "Check whether codex-unity and com.codex.editor-rpc local repos match their GitHub remotes.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string", description: "Optional Unity project root for embedded/package path detection." },
        ...updateCheckProperties,
      },
    },
  },
  {
    name: "codex_unity_rpc_methods",
    description: "Call EditorRpc list_methods and return the live method schema from Unity.",
    inputSchema: {
      type: "object",
      properties: {
        host: { type: "string" },
        port: { type: "number" },
        timeoutSeconds: { type: "number" },
        ...updateCheckProperties,
      },
    },
  },
  {
    name: "codex_unity_rpc_call",
    description: "Call any Unity EditorRpc method through the dynamic guarded interface.",
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string", description: "EditorRpc method name." },
        arguments: { type: "object", description: "Method arguments as an object." },
        argumentsJson: { type: "string", description: "Method arguments as a JSON object string." },
        host: { type: "string", description: "EditorRpc host. Default 127.0.0.1." },
        port: { type: "number", description: "EditorRpc port. Default 47841." },
        timeoutSeconds: { type: "number", description: "Connection timeout. Default 30." },
        allowWrite: { type: "boolean", description: "Required for mutating method prefixes." },
        ...updateCheckProperties,
      },
      required: ["method"],
    },
  },
  {
    name: "codex_unity_validate_after_changes",
    description:
      "After Unity C# or asset edits, refresh assets, wait for domain reload, then validate editor state and console errors.",
    inputSchema: {
      type: "object",
      properties: {
        host: { type: "string", description: "EditorRpc host. Default 127.0.0.1." },
        port: { type: "number", description: "EditorRpc port. Default 47841." },
        timeoutSeconds: { type: "number", description: "Per-RPC timeout. Default 30." },
        initialWaitSeconds: { type: "number", description: "Seconds to wait after refresh_assets. Default 10." },
        retryDelaySeconds: { type: "number", description: "Seconds between get_editor_state retries. Default 5." },
        maxStateAttempts: { type: "number", description: "Maximum get_editor_state attempts. Default 5." },
        consoleCount: { type: "number", description: "Recent console entry count. Default 30." },
        clearConsoleFirst: { type: "boolean", description: "Clear console before refreshing. Default true." },
        includeLoadedScenes: { type: "boolean", description: "Include loaded scene summary. Default true." },
        includeHierarchy: { type: "boolean", description: "Include hierarchy snapshot. Default false." },
        scenePath: { type: "string", description: "Optional scene path for hierarchy snapshot." },
        hierarchyMaxDepth: { type: "number", description: "Hierarchy snapshot max depth. Default 2." },
        hierarchyLimit: { type: "number", description: "Hierarchy snapshot node limit. Default 120." },
        allowWrite: { type: "boolean", description: "Required because this clears console and refreshes assets." },
        ...updateCheckProperties,
      },
      required: ["allowWrite"],
    },
  },
  {
    name: "codex_unity_install_editor_rpc",
    description: "Add com.codex.editor-rpc as a Unity Package Manager Git dependency.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string", description: "Unity project root containing Packages/manifest.json." },
        packageUrl: { type: "string", description: `Package URL. Default ${DEFAULT_PACKAGE_URL}.` },
        allowWrite: { type: "boolean", description: "Must be true because this edits manifest.json." },
        ...updateCheckProperties,
      },
      required: ["projectRoot", "allowWrite"],
    },
  },
];

function toolResult(value, isError = false) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text", text }],
    isError,
  };
}

function updateStatusCheckName(check) {
  return `update:${check.name}`;
}

function updateStatusToDoctorCheck(check) {
  const status = check.status === "current" || check.status === "dirty" ? "pass" : "warn";
  return {
    name: updateStatusCheckName(check),
    status,
    message: check.message,
    repoPath: check.repoPath,
    remoteUrl: check.remoteUrl,
    localHead: check.localHead,
    remoteHead: check.remoteHead,
    dirty: check.dirty,
    updateAvailable: check.updateAvailable,
  };
}

async function runDoctor(args = {}) {
  const checks = [
    { name: "pluginRoot", status: "pass", message: pluginRoot },
    { name: "node", status: "pass", message: process.version },
    {
      name: "mcpConfig",
      status: fs.existsSync(path.join(pluginRoot, ".mcp.json")) ? "pass" : "fail",
      message: ".mcp.json",
    },
  ];

  const updateStatus = getUpdateStatus({ ...args, pluginRoot });
  for (const check of updateStatus.checks) {
    checks.push(updateStatusToDoctorCheck(check));
  }

  if (args.projectRoot) {
    try {
      const manifest = getEditorRpcDependency(args.projectRoot);
      checks.push({
        name: "unityManifest",
        status: manifest.exists ? "pass" : "fail",
        message: manifest.manifestPath,
      });
      checks.push({
        name: "editorRpcDependency",
        status: manifest.hasDependency || manifest.hasEmbeddedPackage ? "pass" : "warn",
        message: manifest.dependency || manifest.embeddedPackagePath,
      });
    } catch (error) {
      checks.push({ name: "unityManifest", status: "fail", message: error.message });
    }
  }

  try {
    const response = await listMethods({
      host: args.host,
      port: args.port,
      timeoutSeconds: args.timeoutSeconds || 3,
    });
    const methods = response.payload && response.payload.methods ? response.payload.methods : [];
    checks.push({
      name: "editorRpc",
      status: response.success ? "pass" : "fail",
      message: response.message || `${methods.length} methods`,
      methodCount: methods.length,
    });
  } catch (error) {
    checks.push({ name: "editorRpc", status: "warn", message: error.message });
  }

  return {
    ok: checks.every((check) => check.status !== "fail") && updateStatus.ok,
    checks,
    updateStatus,
  };
}

function shouldRunUpdateGate(name, args) {
  if (args && args.skipUpdateCheck === true) {
    return false;
  }
  return name !== "codex_unity_doctor" && name !== "codex_unity_update_status";
}

function runUpdateGate(name, args) {
  if (!shouldRunUpdateGate(name, args)) {
    return null;
  }
  const updateStatus = getUpdateStatus({ ...args, pluginRoot });
  if (!hasBlockingUpdates(updateStatus)) {
    return null;
  }
  return toolResult({
    message: "One or more Unity automation plugins are not up to date. Update them or retry with skipUpdateCheck:true if you intentionally want to continue.",
    updateStatus,
  }, true);
}

async function callTool(name, args = {}) {
  if (name === "codex_unity_doctor") {
    return toolResult(await runDoctor(args));
  }

  if (name === "codex_unity_update_status") {
    return toolResult(getUpdateStatus({ ...args, pluginRoot, forceUpdateCheck: args.forceUpdateCheck !== false }));
  }

  const updateGate = runUpdateGate(name, args);
  if (updateGate) {
    return updateGate;
  }

  if (name === "codex_unity_rpc_methods") {
    return toolResult(await listMethods(args));
  }

  if (name === "codex_unity_rpc_call") {
    const method = String(args.method || "");
    if (!method) {
      return toolResult("codex_unity_rpc_call requires method.", true);
    }
    if (isWriteMethod(method) && args.allowWrite !== true) {
      return toolResult(`EditorRpc method '${method}' looks mutating. Retry with allowWrite:true when this write is intended.`, true);
    }
    return toolResult(await callEditorRpc(args));
  }

  if (name === "codex_unity_validate_after_changes") {
    if (args.allowWrite !== true) {
      return toolResult(
        "codex_unity_validate_after_changes refreshes Unity assets and clears the console by default; retry with allowWrite:true when validation is intended.",
        true
      );
    }
    const result = await runValidateAfterChanges(args);
    return toolResult(result, !result.ok);
  }

  if (name === "codex_unity_install_editor_rpc") {
    if (args.allowWrite !== true) {
      return toolResult("codex_unity_install_editor_rpc edits Packages/manifest.json and requires allowWrite:true.", true);
    }
    return toolResult(addEditorRpcDependency(args.projectRoot, args.packageUrl || DEFAULT_PACKAGE_URL));
  }

  return toolResult(`Unknown tool: ${name}`, true);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", async (line) => {
  if (!line.trim()) {
    return;
  }

  let request;
  try {
    request = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } });
    return;
  }

  const id = request.id;
  const method = request.method;

  try {
    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: request.params && request.params.protocolVersion ? request.params.protocolVersion : "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "codex-unity", version: serverVersion },
        },
      });
      return;
    }
    if (method === "notifications/initialized") {
      return;
    }
    if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools } });
      return;
    }
    if (method === "tools/call") {
      const params = request.params || {};
      send({ jsonrpc: "2.0", id, result: await callTool(params.name, params.arguments || {}) });
      return;
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: error && error.message ? error.message : String(error) },
    });
  }
});

module.exports = { callTool, runDoctor, tools };
