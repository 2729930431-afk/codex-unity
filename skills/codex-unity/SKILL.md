---
name: codex-unity
description: Use when Codex needs to control, inspect, validate, install, or troubleshoot a Unity project through the com.codex.editor-rpc protocol layer; triggers include Unity EditorRpc, CodexUnity, Unity scene/prefab/asset/console/Play Mode automation, Unity MCP calls, or adding com.codex.editor-rpc to a Unity project.
---

# Codex Unity

Use this skill to operate Unity through the reusable `com.codex.editor-rpc` package. The Unity side is a separate UPM package; this plugin only provides Codex-side MCP tools, workflow rules, and diagnostics.

## First Steps

1. Run `codex_unity_doctor` with `projectRoot` when a Unity project is known. The doctor checks both `codex-unity` and `com.codex.editor-rpc` update status before normal use.
2. If the project lacks `com.codex.editor-rpc`, call `codex_unity_install_editor_rpc` only when the user intends to edit `Packages/manifest.json` and pass `allowWrite:true`.
3. Ask the user to open Unity and enable `AI Tools > Editor RPC` when `codex_unity_doctor` cannot connect.
4. Run `codex_unity_rpc_methods` before guessing method names.

## Update Gate

- Normal MCP tools run a pre-use update gate for both local repos: `codex-unity` and `com.codex.editor-rpc`.
- If either repo is behind its GitHub remote, the call is blocked with update status details. Update the repo first, or pass `skipUpdateCheck:true` only when the user explicitly wants to continue with a known old version.
- Use `codex_unity_update_status` to inspect the two plugin repos directly. Pass `projectRoot` so the checker can also find embedded or file-based `com.codex.editor-rpc` packages.
- If local repo paths are non-standard, pass `codexUnityRepoPath` and `editorRpcRepoPath`, or set `CODEX_UNITY_PLUGIN_REPO` and `CODEX_UNITY_EDITOR_RPC_REPO`.

## RPC Calls

Use `codex_unity_rpc_call` for all EditorRpc methods:

```json
{
  "method": "find_assets",
  "arguments": {
    "filter": "t:Scene",
    "limit": 20
  }
}
```

Use snake_case argument names exactly as returned by `codex_unity_rpc_methods`. Do not invent PowerShell-style named parameters such as `-filter` or camelCase names such as `assetPath`.

## Write Boundary

Read methods may run directly. Mutating method prefixes such as `set_`, `create_`, `delete_`, `save_`, `refresh_`, `reimport_`, `open_`, `execute_`, `invoke_`, `batch_`, `enter_`, `exit_`, and `assign_` require `allowWrite:true`.

Treat `allowWrite:true` as task-local consent for the specific call, not as permanent permission.

## Validation Pattern

- After C# script changes, always run EditorRpc validation before finishing. If the task changed no scripts, RPC refresh can be skipped unless Unity-side state, assets, scenes, prefabs, or serialized data must be verified.
- Prefer `codex_unity_validate_after_changes` with `allowWrite:true` after C# or asset changes. It clears the Console by default, runs `refresh_assets`, waits for Unity domain reload, polls `get_editor_state`, then calls `validate_workspace`.
- When using raw RPC calls instead, run `refresh_assets`, wait for Unity domain reload, then call `get_editor_state`.
- If refresh or domain reload temporarily stops the RPC server, wait 8 to 15 seconds and retry once or twice.
- Use `read_console` and `validate_workspace` when available to check compile and import errors.
- If Unity is unreachable, state which MCP call failed and use static checks only as a fallback.

## Script Editing Bias

- When modifying C# scripts, prefer changes that reduce or simplify the net code where practical: remove obsolete branches, reuse existing helpers, and avoid adding new code when a smaller change preserves the same behavior.
- Treat this as a directional bias, not a hard line-count rule. Correct behavior, maintainability, tests, and Unity validation still take priority.

## Temporary Editor Scripts

Principle: do not add one-off editor scripts to Unity projects. Prefer existing EditorRpc methods and `codex_unity_rpc_call` for inspection, mutation, validation, scene/prefab edits, asset repair, and orchestration.

Before considering a script, run `codex_unity_rpc_methods` and check whether the task can be expressed through existing RPC calls. If a capability is genuinely missing and likely to recur, add or request a reusable method in `com.codex.editor-rpc` instead of leaving a project-local helper.

Create a temporary `Assets/Editor/*.cs` script only as a last resort for a narrow capability gap. If you do, it must be task-scoped, named as temporary, and removed together with its `.meta` file before finishing. After deletion, refresh assets and validate the workspace so the project is not left with one-off builders, binders, repair tools, migration helpers, or test runners unless the user explicitly asked to keep a reusable project tool.

## Known Calling Traps

- `invoke_editor_static_method.arguments` expects objects like `{"type":"string","value":"x"}`, not bare values.
- `inspect_asset_object` needs `include_properties:true` to list serialized properties.
- `read_console` uses `count`, not `limit`.
- `list_hierarchy` filters by scene and depth; use `find_game_objects` first when locating a specific object.
- Avoid shell or file round-trips for JSON containing non-ASCII paths or `&`; pass structured objects through MCP when possible.
- `codex_unity_validate_after_changes` is the preferred post-edit compile gate; if it returns `ok:false`, inspect its `validation.consoleEntries` before claiming the Unity compile is clean.
