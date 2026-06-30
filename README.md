# Codex Unity

Codex Unity is the Codex-side companion for the Unity package
[`com.codex.editor-rpc`](https://github.com/2729930431-afk/com.codex.editor-rpc).

It provides:

- A Codex plugin manifest and skill.
- An MCP stdio server.
- Dynamic Unity EditorRpc method discovery through `list_methods`.
- A guarded generic RPC call tool for all current and future EditorRpc methods.
- A Unity `Packages/manifest.json` helper for installing the EditorRpc UPM package.

The Unity-side protocol layer remains a separate package. This repository does not vendor or replace it.

## MCP Tools

- `codex_unity_doctor`
- `codex_unity_rpc_methods`
- `codex_unity_rpc_call`
- `codex_unity_install_editor_rpc`

Mutating RPC method prefixes are blocked unless the caller passes `allowWrite:true`.

## Development

```powershell
node scripts/check-line-counts.js
node --test tests/*.test.js
```

All scripts are expected to stay under 800 lines.
