"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { DEFAULT_PACKAGE_URL, getEditorRpcDependency } = require("./unity-manifest");

const DEFAULT_CACHE_TTL_SECONDS = 300;
const DEFAULT_GIT_TIMEOUT_SECONDS = 20;
const CODEX_UNITY_REMOTE = "https://github.com/2729930431-afk/codex-unity.git";
const EDITOR_RPC_REMOTE = DEFAULT_PACKAGE_URL;

let cachedStatus = null;

function shortSha(value) {
  return value ? String(value).slice(0, 7) : "";
}

function uniquePaths(paths) {
  const seen = new Set();
  const results = [];
  for (const item of paths) {
    if (!item) {
      continue;
    }
    const fullPath = path.resolve(String(item));
    const key = process.platform === "win32" ? fullPath.toLowerCase() : fullPath;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(fullPath);
    }
  }
  return results;
}

function normalizeProxy(proxy) {
  if (!proxy) {
    return "";
  }
  let value = String(proxy).trim();
  if (!value) {
    return "";
  }
  if (value.includes(";")) {
    const parts = value.split(";").map((part) => part.trim());
    const httpsPart = parts.find((part) => part.toLowerCase().startsWith("https="));
    const httpPart = parts.find((part) => part.toLowerCase().startsWith("http="));
    value = (httpsPart || httpPart || parts[0]).replace(/^[^=]+=/, "");
  }
  if (!/^https?:\/\//i.test(value)) {
    value = `http://${value}`;
  }
  return value;
}

function normalizeRemoteUrl(remoteUrl) {
  let value = String(remoteUrl || "").trim();
  if (!value) {
    return "";
  }
  value = value.replace(/^git@github\.com:/i, "https://github.com/");
  value = value.replace(/^ssh:\/\/git@github\.com\//i, "https://github.com/");
  value = value.replace(/\.git\/?$/i, "");
  return value.toLowerCase();
}

function remoteMatches(actual, expected) {
  const normalizedActual = normalizeRemoteUrl(actual);
  const normalizedExpected = normalizeRemoteUrl(expected);
  return Boolean(normalizedActual && normalizedExpected && normalizedActual === normalizedExpected);
}

function detectWindowsProxy() {
  if (process.platform !== "win32") {
    return "";
  }
  const result = spawnSync("reg", [
    "query",
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
  ], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 3000,
  });
  if (result.status !== 0) {
    return "";
  }
  const text = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(text)) {
    return "";
  }
  const match = text.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i);
  return normalizeProxy(match && match[1]);
}

function resolveGitProxy(options = {}) {
  return normalizeProxy(
    options.gitProxy ||
      process.env.CODEX_UNITY_GIT_PROXY ||
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY ||
      detectWindowsProxy()
  );
}

function runGit(repoPath, args, options = {}) {
  const gitArgs = [];
  if (options.useProxy) {
    const proxy = resolveGitProxy(options);
    if (proxy) {
      gitArgs.push("-c", `http.proxy=${proxy}`);
    }
  }
  gitArgs.push(...args);

  const result = spawnSync("git", gitArgs, {
    cwd: repoPath,
    encoding: "utf8",
    windowsHide: true,
    timeout: Math.max(1, Number(options.gitTimeoutSeconds || DEFAULT_GIT_TIMEOUT_SECONDS)) * 1000,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
    error: result.error ? result.error.message : "",
  };
}

function findGitRepo(candidatePaths, expectedRemoteUrl, options = {}) {
  for (const candidatePath of uniquePaths(candidatePaths)) {
    if (!fs.existsSync(candidatePath)) {
      continue;
    }
    const result = runGit(candidatePath, ["rev-parse", "--show-toplevel"], options);
    if (result.ok && result.stdout) {
      const repoPath = path.resolve(result.stdout);
      const remoteUrl = runGit(repoPath, ["config", "--get", "remote.origin.url"], options);
      if (!remoteUrl.stdout || remoteMatches(remoteUrl.stdout, expectedRemoteUrl)) {
        return repoPath;
      }
    }
  }
  return "";
}

function manifestFilePackagePath(projectRoot, dependency) {
  if (!projectRoot || !dependency || !String(dependency).startsWith("file:")) {
    return "";
  }
  const relativePath = String(dependency).slice("file:".length);
  const manifestFolder = path.join(path.resolve(projectRoot), "Packages");
  return path.resolve(manifestFolder, relativePath);
}

function getEditorRpcManifest(projectRoot) {
  if (!projectRoot) {
    return null;
  }
  try {
    return getEditorRpcDependency(projectRoot);
  } catch {
    return null;
  }
}

function buildUpdateCheckTargets(options = {}) {
  const home = os.homedir();
  const projectRoot = options.projectRoot ? path.resolve(String(options.projectRoot)) : "";
  const editorRpcManifest = getEditorRpcManifest(projectRoot);
  const editorRpcFilePath = editorRpcManifest
    ? manifestFilePackagePath(projectRoot, editorRpcManifest.dependency)
    : "";

  return [
    {
      name: "codex-unity",
      remoteUrl: CODEX_UNITY_REMOTE,
      candidatePaths: uniquePaths([
        options.codexUnityRepoPath,
        process.env.CODEX_UNITY_REPO,
        process.env.CODEX_UNITY_PLUGIN_REPO,
        "D:\\codex\u63d2\u4ef6\\codex-unity",
        path.join(home, "plugins", "codex-unity"),
        options.pluginRoot,
      ]),
    },
    {
      name: "com.codex.editor-rpc",
      remoteUrl: EDITOR_RPC_REMOTE,
      candidatePaths: uniquePaths([
        options.editorRpcRepoPath,
        process.env.CODEX_UNITY_EDITOR_RPC_REPO,
        process.env.CODEX_EDITOR_RPC_REPO,
        editorRpcFilePath,
        editorRpcManifest && editorRpcManifest.embeddedPackagePath
          ? path.dirname(editorRpcManifest.embeddedPackagePath)
          : "",
        "D:\\unity\\unity\u63d2\u4ef6\\com.codex.editor-rpc",
        path.join(home, "plugins", "com.codex.editor-rpc"),
      ]),
    },
  ];
}

function parseRemoteHead(output) {
  const line = String(output || "").split(/\r?\n/).find(Boolean);
  if (!line) {
    return "";
  }
  const parts = line.split(/\s+/);
  return parts[0] || "";
}

function buildCheckMessage(check) {
  if (check.status === "current") {
    return `Local ${shortSha(check.localHead)} matches ${check.remoteRef}.`;
  }
  if (check.status === "dirty") {
    return check.remoteHead
      ? `Local ${shortSha(check.localHead)} matches ${check.remoteRef}, but the repo has uncommitted changes.`
      : "The repo has uncommitted changes; remote status was not checked.";
  }
  if (check.status === "outdated") {
    return `Remote ${check.remoteRef} is ${shortSha(check.remoteHead)}, local is ${shortSha(check.localHead)}. Update before using.`;
  }
  if (check.status === "unknown") {
    return check.message || "No local Git repository was found for this plugin.";
  }
  return check.message || "Git update status check failed.";
}

function checkGitTarget(target, options = {}) {
  const repoPath = findGitRepo(target.candidatePaths, target.remoteUrl, options);
  const base = {
    name: target.name,
    repoPath,
    remoteUrl: target.remoteUrl,
    status: "unknown",
    updateAvailable: false,
    blocking: false,
    dirty: false,
    localHead: "",
    remoteHead: "",
    branch: "",
    remoteRef: "",
    candidatePaths: target.candidatePaths,
  };

  if (!repoPath) {
    return {
      ...base,
      message: "No local Git repository was found. Pass a repo path or set the matching environment variable.",
    };
  }

  const localHead = runGit(repoPath, ["rev-parse", "HEAD"], options);
  const branch = runGit(repoPath, ["branch", "--show-current"], options);
  const remoteUrl = runGit(repoPath, ["config", "--get", "remote.origin.url"], options);
  const dirtyState = runGit(repoPath, ["status", "--porcelain"], options);

  if (!localHead.ok || !localHead.stdout) {
    return {
      ...base,
      status: "error",
      repoPath,
      message: localHead.stderr || localHead.error || "Could not read local Git HEAD.",
    };
  }

  const currentBranch = branch.stdout || "HEAD";
  const remoteRef = currentBranch === "HEAD" ? "HEAD" : `refs/heads/${currentBranch}`;
  const localDirty = Boolean(dirtyState.stdout);
  const resolvedRemote = remoteUrl.stdout || target.remoteUrl;
  let check = {
    ...base,
    repoPath,
    remoteUrl: resolvedRemote,
    branch: currentBranch,
    remoteRef,
    localHead: localHead.stdout,
    dirty: localDirty,
  };

  if (options.skipRemoteCheck === true) {
    check = {
      ...check,
      status: localDirty ? "dirty" : "current",
      message: localDirty
        ? "Remote check skipped; local repo has uncommitted changes."
        : "Remote check skipped; local repo is clean.",
    };
    return { ...check, message: buildCheckMessage(check) };
  }

  const remote = runGit(repoPath, ["ls-remote", "origin", remoteRef], {
    ...options,
    useProxy: true,
  });
  if (!remote.ok || !parseRemoteHead(remote.stdout)) {
    check = {
      ...check,
      status: localDirty ? "dirty" : "unknown",
      message: remote.stderr || remote.error || "Could not reach remote Git repository.",
    };
    return { ...check, message: buildCheckMessage(check) };
  }

  const remoteHead = parseRemoteHead(remote.stdout);
  const updateAvailable = remoteHead !== localHead.stdout;
  check = {
    ...check,
    remoteHead,
    updateAvailable,
    blocking: updateAvailable,
    status: updateAvailable ? "outdated" : localDirty ? "dirty" : "current",
  };
  return { ...check, message: buildCheckMessage(check) };
}

function summarizeUpdateStatus(checks) {
  const updateCount = checks.filter((check) => check.updateAvailable).length;
  const errorCount = checks.filter((check) => check.status === "error").length;
  const unknownCount = checks.filter((check) => check.status === "unknown").length;
  const dirtyCount = checks.filter((check) => check.status === "dirty").length;
  const overall = updateCount > 0
    ? "outdated"
    : errorCount > 0
      ? "error"
      : unknownCount > 0
        ? "partial"
        : dirtyCount > 0
          ? "dirty"
          : "current";

  return {
    ok: updateCount === 0,
    overall,
    updateCount,
    errorCount,
    unknownCount,
    dirtyCount,
    blockingChecks: checks.filter((check) => check.blocking),
  };
}

function buildCacheKey(options = {}) {
  return JSON.stringify({
    projectRoot: options.projectRoot || "",
    codexUnityRepoPath: options.codexUnityRepoPath || "",
    editorRpcRepoPath: options.editorRpcRepoPath || "",
    gitProxy: options.gitProxy || "",
    skipRemoteCheck: options.skipRemoteCheck === true,
  });
}

function checkUpdateStatus(options = {}) {
  const targets = buildUpdateCheckTargets(options);
  const checks = targets.map((target) => checkGitTarget(target, options));
  const summary = summarizeUpdateStatus(checks);
  return {
    checkedAt: new Date().toISOString(),
    ok: summary.ok,
    overall: summary.overall,
    updateCount: summary.updateCount,
    errorCount: summary.errorCount,
    unknownCount: summary.unknownCount,
    dirtyCount: summary.dirtyCount,
    blockingChecks: summary.blockingChecks,
    checks,
  };
}

function getUpdateStatus(options = {}) {
  const ttlSeconds = Math.max(0, Number(options.updateCheckTtlSeconds || DEFAULT_CACHE_TTL_SECONDS));
  const cacheKey = buildCacheKey(options);
  const now = Date.now();
  if (
    options.forceUpdateCheck !== true &&
    cachedStatus &&
    cachedStatus.cacheKey === cacheKey &&
    now - cachedStatus.createdAt <= ttlSeconds * 1000
  ) {
    return {
      ...cachedStatus.status,
      cached: true,
      cacheTtlSeconds: ttlSeconds,
    };
  }

  const status = {
    ...checkUpdateStatus(options),
    cached: false,
    cacheTtlSeconds: ttlSeconds,
  };
  cachedStatus = {
    cacheKey,
    createdAt: now,
    status,
  };
  return status;
}

function hasBlockingUpdates(status) {
  return Boolean(status && Array.isArray(status.blockingChecks) && status.blockingChecks.length > 0);
}

module.exports = {
  CODEX_UNITY_REMOTE,
  EDITOR_RPC_REMOTE,
  buildUpdateCheckTargets,
  checkUpdateStatus,
  getUpdateStatus,
  hasBlockingUpdates,
  normalizeProxy,
  normalizeRemoteUrl,
  remoteMatches,
  summarizeUpdateStatus,
};
