"use strict";

const assert = require("assert");
const path = require("path");
const test = require("node:test");

const {
  buildUpdateCheckTargets,
  normalizeProxy,
  normalizeRemoteUrl,
  remoteMatches,
  summarizeUpdateStatus,
} = require("../scripts/lib/update-status");

test("normalizeProxy accepts Windows proxy forms", () => {
  assert.equal(normalizeProxy("127.0.0.1:6789"), "http://127.0.0.1:6789");
  assert.equal(normalizeProxy("https=127.0.0.1:7890;http=127.0.0.1:6789"), "http://127.0.0.1:7890");
  assert.equal(normalizeProxy("http://127.0.0.1:6789"), "http://127.0.0.1:6789");
});

test("remote URL comparison handles common GitHub forms", () => {
  assert.equal(
    normalizeRemoteUrl("git@github.com:2729930431-afk/codex-unity.git"),
    "https://github.com/2729930431-afk/codex-unity"
  );
  assert.equal(
    remoteMatches(
      "git@github.com:2729930431-afk/com.codex.editor-rpc.git",
      "https://github.com/2729930431-afk/com.codex.editor-rpc.git"
    ),
    true
  );
  assert.equal(
    remoteMatches(
      "https://git.example.com/team/other.git",
      "https://github.com/2729930431-afk/com.codex.editor-rpc.git"
    ),
    false
  );
});

test("buildUpdateCheckTargets includes explicit repo paths", () => {
  const codexUnityRepoPath = path.resolve("tmp", "codex-unity");
  const editorRpcRepoPath = path.resolve("tmp", "editor-rpc");
  const targets = buildUpdateCheckTargets({ codexUnityRepoPath, editorRpcRepoPath });

  assert.equal(targets[0].name, "codex-unity");
  assert.ok(targets[0].candidatePaths.includes(codexUnityRepoPath));
  assert.equal(targets[1].name, "com.codex.editor-rpc");
  assert.ok(targets[1].candidatePaths.includes(editorRpcRepoPath));
});

test("summarizeUpdateStatus marks remote mismatch as not ok", () => {
  const summary = summarizeUpdateStatus([
    { status: "current", updateAvailable: false },
    { status: "outdated", updateAvailable: true, blocking: true },
  ]);

  assert.equal(summary.ok, false);
  assert.equal(summary.overall, "outdated");
  assert.equal(summary.updateCount, 1);
  assert.equal(summary.blockingChecks.length, 1);
});
