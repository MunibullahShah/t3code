export interface KeepAwakeCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

/**
 * The OS tool that blocks idle sleep for as long as it runs, or null where
 * there is none. The display may still sleep. On macOS `-w` ties it to the
 * server, so it exits by itself if the server ever dies without cleaning up.
 */
export function keepAwakeCommand(platform: string, serverPid: number): KeepAwakeCommand | null {
  switch (platform) {
    case "darwin":
      return { command: "caffeinate", args: ["-i", "-w", String(serverPid)] };
    case "linux":
      return {
        command: "systemd-inhibit",
        args: [
          "--what=idle:sleep",
          "--who=T3 Code",
          "--why=Keep awake is on",
          "--mode=block",
          "sleep",
          "infinity",
        ],
      };
    default:
      return null;
  }
}
