import { assert, it } from "@effect/vitest";

import { keepAwakeCommand } from "./keepAwakeCommand.ts";

it("holds macOS awake with caffeinate tied to the server process", () => {
  assert.deepEqual(keepAwakeCommand("darwin", 4242), {
    command: "caffeinate",
    args: ["-i", "-w", "4242"],
  });
});

it("blocks idle sleep on Linux through systemd-inhibit", () => {
  const command = keepAwakeCommand("linux", 1);
  assert.equal(command?.command, "systemd-inhibit");
  assert.include(command?.args ?? [], "--what=idle:sleep");
});

it("reports no command where the platform has no supported tool", () => {
  assert.isNull(keepAwakeCommand("win32", 1));
});
