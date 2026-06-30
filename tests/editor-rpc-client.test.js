"use strict";

const assert = require("assert");
const net = require("net");
const test = require("node:test");

const { callEditorRpc, isWriteMethod, listMethods } = require("../scripts/lib/editor-rpc-client");
const { buildValidationArgs } = require("../scripts/lib/validate-after-changes");

async function withServer(handler, callback) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      const index = buffer.indexOf("\n");
      if (index < 0) {
        return;
      }
      const request = JSON.parse(buffer.slice(0, index));
      const response = handler(request);
      if (response !== null) {
        socket.end(`${JSON.stringify(response)}\n`);
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(server.address().port);
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve) => server.close(resolve));
  }
}

test("listMethods parses payload_json", async () => {
  await withServer((request) => ({
    request_id: request.request_id,
    success: true,
    message: "ok",
    payload_json: JSON.stringify({ returnedCount: 1, methods: [{ name: "get_editor_state" }] }),
    processed_at_utc: "now",
  }), async (port) => {
    const response = await listMethods({ port });
    assert.equal(response.success, true);
    assert.equal(response.payload.methods[0].name, "get_editor_state");
  });
});

test("callEditorRpc preserves unsuccessful responses", async () => {
  await withServer((request) => ({
    request_id: request.request_id,
    success: false,
    message: "Unknown RPC method",
    payload_json: "",
    processed_at_utc: "now",
  }), async (port) => {
    const response = await callEditorRpc({ port, method: "missing" });
    assert.equal(response.success, false);
    assert.equal(response.message, "Unknown RPC method");
  });
});

test("callEditorRpc reports invalid response JSON", async () => {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.end("not-json\n");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(
      callEditorRpc({ port: server.address().port, method: "list_methods" }),
      /not valid JSON/
    );
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve) => server.close(resolve));
  }
});

test("callEditorRpc reports connection failure", async () => {
  await assert.rejects(
    callEditorRpc({ port: 9, method: "list_methods", timeoutSeconds: 1 }),
    /Could not connect|Timed out/
  );
});

test("write method detection covers mutating prefixes", () => {
  assert.equal(isWriteMethod("set_transform"), true);
  assert.equal(isWriteMethod("batch_assign_materials"), true);
  assert.equal(isWriteMethod("get_editor_state"), false);
  assert.equal(isWriteMethod("list_methods"), false);
});

test("validate-after-changes builds validate_workspace arguments", () => {
  assert.deepEqual(buildValidationArgs({
    consoleCount: 12,
    includeHierarchy: true,
    scenePath: "Assets/Scenes/Main.unity",
    hierarchyMaxDepth: 3,
  }), {
    refresh_assets: false,
    console_count: 12,
    include_loaded_scenes: true,
    include_hierarchy: true,
    scene_path: "Assets/Scenes/Main.unity",
    hierarchy_max_depth: 3,
  });
});
