"use strict";

const crypto = require("crypto");
const net = require("net");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 47841;
const DEFAULT_TIMEOUT_SECONDS = 30;
const WRITE_METHOD_PATTERN =
  /^(add_|assign_|batch_|clear_|close_|create_|delete_|duplicate_|ensure_|enter_|execute_|exit_|instantiate_|invoke_|open_|refresh_|reimport_|remove_|reparent_|save_|select_|set_)/i;

function isWriteMethod(method) {
  return WRITE_METHOD_PATTERN.test(String(method || ""));
}

function parseArguments({ args, arguments: objectArgs, argumentsJson }) {
  if (argumentsJson !== undefined && argumentsJson !== null && String(argumentsJson).trim() !== "") {
    return JSON.parse(String(argumentsJson));
  }
  if (objectArgs !== undefined) {
    return objectArgs || {};
  }
  return args || {};
}

function parsePayload(payloadJson) {
  if (payloadJson === undefined || payloadJson === null || payloadJson === "") {
    return null;
  }
  if (typeof payloadJson !== "string") {
    return payloadJson;
  }
  try {
    return JSON.parse(payloadJson);
  } catch {
    return payloadJson;
  }
}

function normalizeResponse(rawLine) {
  const raw = JSON.parse(rawLine);
  return {
    request_id: String(raw.request_id || ""),
    success: Boolean(raw.success),
    message: String(raw.message || ""),
    payload: parsePayload(raw.payload_json),
    processed_at_utc: String(raw.processed_at_utc || ""),
    raw,
  };
}

function callEditorRpc(options) {
  const method = String(options.method || "");
  if (!method) {
    return Promise.reject(new Error("EditorRpc method is required."));
  }

  const request = {
    request_id: options.requestId || crypto.randomUUID().replace(/-/g, ""),
    method,
    args: parseArguments(options),
  };

  const host = options.host || DEFAULT_HOST;
  const port = Number.isFinite(Number(options.port)) ? Number(options.port) : DEFAULT_PORT;
  const timeoutMs = Math.max(1, Number(options.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS)) * 1000;

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    let buffer = "";

    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    const timer = setTimeout(() => {
      finish(new Error(`Timed out waiting for EditorRpc at ${host}:${port}.`));
    }, timeoutMs);

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`, "utf8");
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }
      const line = buffer.slice(0, newlineIndex).trim();
      if (!line) {
        finish(new Error("EditorRpc returned an empty response."));
        return;
      }
      try {
        finish(null, normalizeResponse(line));
      } catch (error) {
        finish(new Error(`EditorRpc response is not valid JSON: ${error.message}`));
      }
    });
    socket.on("error", (error) => {
      finish(new Error(`Could not connect to EditorRpc at ${host}:${port}: ${error.message}`));
    });
    socket.on("end", () => {
      if (!settled) {
        finish(new Error("EditorRpc closed the connection without a response."));
      }
    });
  });
}

async function listMethods(options = {}) {
  return callEditorRpc({
    host: options.host,
    port: options.port,
    timeoutSeconds: options.timeoutSeconds,
    method: "list_methods",
    args: {},
  });
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_TIMEOUT_SECONDS,
  WRITE_METHOD_PATTERN,
  callEditorRpc,
  isWriteMethod,
  listMethods,
  parseArguments,
  parsePayload,
};
