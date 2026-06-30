"use strict";

const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const test = require("node:test");

const SERVER_PATH = path.resolve(__dirname, "..", "scripts", "mcp-server.js");
const PACKAGE_NAME = "com.codex.editor-rpc";

function startMcp() {
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: path.resolve(__dirname, ".."),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let buffer = "";

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const index = buffer.indexOf("\n");
      if (index < 0) {
        break;
      }
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) {
        continue;
      }
      const message = JSON.parse(line);
      const slot = pending.get(message.id);
      if (slot) {
        pending.delete(message.id);
        slot.resolve(message);
      }
    }
  });

  let nextId = 1;
  return {
    child,
    request(method, params) {
      const id = nextId;
      nextId += 1;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`Timed out waiting for ${method}`));
          }
        }, 3000);
      });
    },
    stop() {
      child.kill();
    },
  };
}

async function withRpcServer(handler, callback) {
  const server = net.createServer((socket) => {
    socket.once("data", (chunk) => {
      const request = JSON.parse(String(chunk).trim());
      socket.write(`${JSON.stringify(handler(request))}\n`);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function makeUnityProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-unity-mcp-"));
  fs.mkdirSync(path.join(root, "Packages"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "Packages", "manifest.json"),
    `${JSON.stringify({ dependencies: { "com.unity.ugui": "1.0.0" } }, null, 2)}\n`,
    "utf8"
  );
  return root;
}

test("MCP initialize and tools/list work", async () => {
  const mcp = startMcp();
  try {
    const init = await mcp.request("initialize", { protocolVersion: "2024-11-05" });
    assert.equal(init.result.serverInfo.name, "codex-unity");
    const list = await mcp.request("tools/list", {});
    const names = list.result.tools.map((tool) => tool.name);
    assert.ok(names.includes("codex_unity_rpc_call"));
    assert.ok(names.includes("codex_unity_rpc_methods"));
  } finally {
    mcp.stop();
  }
});

test("MCP write guard blocks mutating calls without allowWrite", async () => {
  const mcp = startMcp();
  try {
    const response = await mcp.request("tools/call", {
      name: "codex_unity_rpc_call",
      arguments: { method: "set_transform" },
    });
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /allowWrite/);
  } finally {
    mcp.stop();
  }
});

test("MCP write guard allows mutating calls with allowWrite", async () => {
  await withRpcServer((request) => ({
    request_id: request.request_id,
    success: true,
    message: "ok",
    payload_json: JSON.stringify({ method: request.method }),
    processed_at_utc: "now",
  }), async (port) => {
    const mcp = startMcp();
    try {
      const response = await mcp.request("tools/call", {
        name: "codex_unity_rpc_call",
        arguments: { method: "set_transform", port, allowWrite: true },
      });
      assert.equal(response.result.isError, false);
      assert.match(response.result.content[0].text, /set_transform/);
    } finally {
      mcp.stop();
    }
  });
});

test("MCP validate-after-changes refuses to run without allowWrite", async () => {
  const mcp = startMcp();
  try {
    const response = await mcp.request("tools/call", {
      name: "codex_unity_validate_after_changes",
      arguments: {},
    });
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /allowWrite/);
  } finally {
    mcp.stop();
  }
});

test("MCP validate-after-changes refreshes, waits for idle, and validates console", async () => {
  const methods = [];
  await withRpcServer((request) => {
    methods.push(request.method);
    if (request.method === "get_editor_state") {
      return {
        request_id: request.request_id,
        success: true,
        message: "state",
        payload_json: JSON.stringify({ isCompiling: false, isUpdating: false }),
        processed_at_utc: "now",
      };
    }
    if (request.method === "validate_workspace") {
      return {
        request_id: request.request_id,
        success: true,
        message: "validated",
        payload_json: JSON.stringify({
          errorCount: 0,
          warningCount: 0,
          editorState: { isCompiling: false, isUpdating: false },
        }),
        processed_at_utc: "now",
      };
    }
    return {
      request_id: request.request_id,
      success: true,
      message: request.method,
      payload_json: "",
      processed_at_utc: "now",
    };
  }, async (port) => {
    const mcp = startMcp();
    try {
      const response = await mcp.request("tools/call", {
        name: "codex_unity_validate_after_changes",
        arguments: {
          port,
          allowWrite: true,
          initialWaitSeconds: 0,
          retryDelaySeconds: 0,
        },
      });
      const payload = JSON.parse(response.result.content[0].text);
      assert.equal(response.result.isError, false);
      assert.equal(payload.ok, true);
      assert.deepEqual(methods, ["clear_console", "refresh_assets", "get_editor_state", "validate_workspace"]);
    } finally {
      mcp.stop();
    }
  });
});

test("MCP install tool refuses to edit without allowWrite", async () => {
  const root = makeUnityProject();
  const mcp = startMcp();
  try {
    const response = await mcp.request("tools/call", {
      name: "codex_unity_install_editor_rpc",
      arguments: { projectRoot: root },
    });
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "Packages", "manifest.json"), "utf8"));
    assert.equal(response.result.isError, true);
    assert.equal(manifest.dependencies[PACKAGE_NAME], undefined);
  } finally {
    mcp.stop();
  }
});

test("MCP install tool writes manifest with allowWrite", async () => {
  const root = makeUnityProject();
  const mcp = startMcp();
  try {
    const response = await mcp.request("tools/call", {
      name: "codex_unity_install_editor_rpc",
      arguments: { projectRoot: root, allowWrite: true },
    });
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "Packages", "manifest.json"), "utf8"));
    assert.equal(response.result.isError, false);
    assert.match(manifest.dependencies[PACKAGE_NAME], /com\.codex\.editor-rpc/);
  } finally {
    mcp.stop();
  }
});
