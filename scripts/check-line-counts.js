"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MAX_LINES = 800;
const EXTENSIONS = new Set([".js", ".ps1"]);

function walk(directory, results = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, results);
    } else if (EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }
  return results;
}

const failures = [];
for (const filePath of walk(ROOT)) {
  const lineCount = fs.readFileSync(filePath, "utf8").split(/\r\n|\r|\n/).length;
  if (lineCount > MAX_LINES) {
    failures.push({ filePath, lineCount });
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`${failure.filePath}: ${failure.lineCount} lines`);
  }
  process.exit(1);
}

console.log(`All checked scripts are <= ${MAX_LINES} lines.`);
