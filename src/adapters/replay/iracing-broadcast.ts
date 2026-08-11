import { spawn } from "node:child_process";

import type { Logger } from "@/src/ports/logger";

/** Matches irsdk BroadcastMsg / VideoCaptureMode / RpySrchMode. */
export const IracingBroadcastMsg = {
  ReplaySetPlaySpeed: 3,
  ReplaySearch: 5,
  VideoCapture: 13,
} as const;

export const IracingVideoCaptureMode = {
  Start: 1,
  End: 2,
  HideTimer: 5,
} as const;

export const IracingReplaySearchMode = {
  ToStart: 0,
  ToEnd: 1,
} as const;

export type IracingBroadcastPort = {
  send(msg: number, var1?: number, var2?: number, var3?: number): Promise<void>;
};

/**
 * Sends iRacing remote-control broadcasts via Win32 SendNotifyMessage.
 * Requires iRacing to be running on this Windows machine.
 */
export function createPowershellIracingBroadcast(deps: {
  logger: Logger;
}): IracingBroadcastPort {
  const log = deps.logger.child({ component: "IracingBroadcast" });

  return {
    async send(msg, var1 = 0, var2 = 0, var3 = 0) {
      const startedAt = performance.now();
      const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class IrSdkNative {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern uint RegisterWindowMessage(string lpString);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool SendNotifyMessage(IntPtr hWnd, uint Msg, UIntPtr wParam, UIntPtr lParam);
}
"@
$msgId = [IrSdkNative]::RegisterWindowMessage('IRSDK_BROADCASTMSG')
if ($msgId -eq 0) { throw 'RegisterWindowMessage failed' }
$wParam = [uint32]((${var1} -shl 16) -bor (${msg} -band 0xFFFF))
$lParam = [uint32]((${var3} -shl 16) -bor (${var2} -band 0xFFFF))
$ok = [IrSdkNative]::SendNotifyMessage([IntPtr]0xFFFF, $msgId, [UIntPtr]$wParam, [UIntPtr]$lParam)
if (-not $ok) { throw 'SendNotifyMessage failed' }
`.trim();

      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", script],
          { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
        );
        let stderr = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.once("error", reject);
        child.once("close", (code) => {
          if (code === 0) {
            log.debug("iRacing broadcast sent", {
              msg,
              var1,
              var2,
              var3,
              durationMs: Math.round(performance.now() - startedAt),
            });
            resolve();
            return;
          }
          reject(
            new Error(
              `iRacing broadcast failed (code ${code}): ${stderr.trim() || "no stderr"}`,
            ),
          );
        });
      });
    },
  };
}
