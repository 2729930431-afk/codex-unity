"use strict";

const fs = require("fs");
const path = require("path");

const PACKAGE_NAME = "com.codex.editor-rpc";
const DEFAULT_PACKAGE_URL = "https://github.com/2729930431-afk/com.codex.editor-rpc.git";

function manifestPathFor(projectRoot) {
  if (!projectRoot) {
    throw new Error("projectRoot is required.");
  }
  return path.join(path.resolve(projectRoot), "Packages", "manifest.json");
}

function readManifest(projectRoot) {
  const manifestPath = manifestPathFor(projectRoot);
  if (!fs.existsSync(manifestPath)) {
    return {
      exists: false,
      manifestPath,
      manifest: null,
    };
  }
  const text = fs.readFileSync(manifestPath, "utf8");
  return {
    exists: true,
    manifestPath,
    manifest: JSON.parse(text),
  };
}

function getEditorRpcDependency(projectRoot) {
  const state = readManifest(projectRoot);
  const dependencies = state.manifest && state.manifest.dependencies ? state.manifest.dependencies : {};
  const dependency = dependencies[PACKAGE_NAME] || "";
  const embeddedPackagePath = path.join(path.resolve(projectRoot), "Packages", PACKAGE_NAME, "package.json");
  return {
    ...state,
    packageName: PACKAGE_NAME,
    dependency,
    hasDependency: Boolean(dependency),
    hasEmbeddedPackage: fs.existsSync(embeddedPackagePath),
    embeddedPackagePath,
  };
}

function addEditorRpcDependency(projectRoot, packageUrl = DEFAULT_PACKAGE_URL) {
  const state = readManifest(projectRoot);
  if (!state.exists) {
    throw new Error(`Unity manifest not found: ${state.manifestPath}`);
  }

  const manifest = state.manifest || {};
  manifest.dependencies = manifest.dependencies || {};
  const previous = manifest.dependencies[PACKAGE_NAME] || "";
  if (previous === packageUrl) {
    return {
      changed: false,
      manifestPath: state.manifestPath,
      packageName: PACKAGE_NAME,
      previous,
      current: previous,
    };
  }

  manifest.dependencies[PACKAGE_NAME] = packageUrl;
  fs.writeFileSync(state.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return {
    changed: true,
    manifestPath: state.manifestPath,
    packageName: PACKAGE_NAME,
    previous,
    current: packageUrl,
  };
}

module.exports = {
  DEFAULT_PACKAGE_URL,
  PACKAGE_NAME,
  addEditorRpcDependency,
  getEditorRpcDependency,
  manifestPathFor,
  readManifest,
};
