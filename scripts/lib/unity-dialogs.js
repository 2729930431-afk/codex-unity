"use strict";

const { spawn } = require("child_process");

const DISMISS_RELOAD_DIALOG_PS = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CodexUnityDialogInterop
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", SetLastError = true)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll", SetLastError = true)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
}
"@
function Text($h) { $b = New-Object System.Text.StringBuilder 512; [void][CodexUnityDialogInterop]::GetWindowText($h, $b, $b.Capacity); $b.ToString() }
function ClassName($h) { $b = New-Object System.Text.StringBuilder 256; [void][CodexUnityDialogInterop]::GetClassName($h, $b, $b.Capacity); $b.ToString() }
function Children($h) {
    $script:children = New-Object System.Collections.ArrayList
    $cb = [CodexUnityDialogInterop+EnumWindowsProc]{ param([IntPtr]$c,[IntPtr]$p)
        [void]$script:children.Add([pscustomobject]@{ Handle = $c; Text = (Text $c); ClassName = (ClassName $c) })
        $true
    }
    [void][CodexUnityDialogInterop]::EnumChildWindows($h, $cb, [IntPtr]::Zero)
    @($script:children)
}
$script:dismissed = $false
$cb = [CodexUnityDialogInterop+EnumWindowsProc]{ param([IntPtr]$h,[IntPtr]$p)
    if (-not [CodexUnityDialogInterop]::IsWindowVisible($h)) { return $true }
    [uint32]$pid = 0
    [void][CodexUnityDialogInterop]::GetWindowThreadProcessId($h, [ref]$pid)
    if ($pid -eq 0) { return $true }
    try { $proc = Get-Process -Id $pid -ErrorAction Stop } catch { return $true }
    if ($proc.ProcessName -notlike "Unity*") { return $true }
    $children = Children $h
    $dialogText = (@(Text $h) + @($children | ForEach-Object { $_.Text })) -join [Environment]::NewLine
    $looksLikeReload =
        (($dialogText -match "(?i)reload") -and ($dialogText -match "(?i)scene|modified outside|external|changed")) -or
        (($dialogText -match "重新(加载|载入)") -and ($dialogText -match "场景|外部|修改|更改"))
    if (-not $looksLikeReload) { return $true }
    $button = $children | Where-Object {
        $_.ClassName -eq "Button" -and ($_.Text -match "^(?i)&?Reload(\\s.*)?$" -or $_.Text -match "^重新(加载|载入)")
    } | Select-Object -First 1
    if ($null -eq $button) { return $true }
    [void][CodexUnityDialogInterop]::SendMessage($button.Handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
    $script:dismissed = $true
    $false
}
[void][CodexUnityDialogInterop]::EnumWindows($cb, [IntPtr]::Zero)
@{ dismissed = $script:dismissed } | ConvertTo-Json -Compress
`;

const ENCODED_DISMISS_COMMAND = Buffer.from(DISMISS_RELOAD_DIALOG_PS, "utf16le").toString("base64");
let pendingDismiss = null;
let lastDismissStartedAt = 0;

function dismissUnityReloadSceneDialog() {
  if (process.platform !== "win32") {
    return Promise.resolve({ dismissed: false, skipped: true });
  }
  if (pendingDismiss) {
    return pendingDismiss;
  }
  if (Date.now() - lastDismissStartedAt < 1000) {
    return Promise.resolve({ dismissed: false, throttled: true });
  }

  lastDismissStartedAt = Date.now();
  pendingDismiss = new Promise((resolve) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      ENCODED_DISMISS_COMMAND,
    ], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", (error) => {
      resolve({ dismissed: false, error: error.message });
    });
    child.on("close", () => {
      try {
        resolve(JSON.parse(stdout.trim() || "{}"));
      } catch {
        resolve({ dismissed: false });
      }
    });
  }).finally(() => {
    pendingDismiss = null;
  });

  return pendingDismiss;
}

module.exports = {
  dismissUnityReloadSceneDialog,
};
