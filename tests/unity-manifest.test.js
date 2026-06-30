"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const {
  DEFAULT_PACKAGE_URL,
  PACKAGE_NAME,
  addEditorRpcDependency,
  getEditorRpcDependency,
} = require("../scripts/lib/unity-manifest");

function makeProject(manifest) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-unity-"));
  fs.mkdirSync(path.join(root, "Packages"), { recursive: true });
  fs.writeFileSync(path.join(root, "Packages", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return root;
}

test("addEditorRpcDependency adds missing dependency", () => {
  const root = makeProject({ dependencies: { "com.unity.ugui": "1.0.0" } });
  const result = addEditorRpcDependency(root);
  const state = getEditorRpcDependency(root);
  assert.equal(result.changed, true);
  assert.equal(state.dependency, DEFAULT_PACKAGE_URL);
});

test("addEditorRpcDependency is idempotent", () => {
  const root = makeProject({ dependencies: { [PACKAGE_NAME]: DEFAULT_PACKAGE_URL } });
  const result = addEditorRpcDependency(root);
  assert.equal(result.changed, false);
  assert.equal(result.previous, DEFAULT_PACKAGE_URL);
});

test("getEditorRpcDependency reports missing manifest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-unity-"));
  const state = getEditorRpcDependency(root);
  assert.equal(state.exists, false);
  assert.equal(state.hasDependency, false);
});
