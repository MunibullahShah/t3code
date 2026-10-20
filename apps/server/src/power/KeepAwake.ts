import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import { keepAwakeCommand } from "./keepAwakeCommand.ts";

export interface KeepAwakeShape {
  /** Whether this machine has a tool the server can hold awake with. */
  readonly supported: boolean;
  /**
   * Follows the keepAwake setting for the server's lifetime: the helper runs
   * while the setting is on and is stopped the moment it turns off.
   */
  readonly run: Effect.Effect<void>;
}

export class KeepAwake extends Context.Service<KeepAwake, KeepAwakeShape>()("t3/power/KeepAwake") {}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const platform = yield* HostProcess.Platform;
  const command = keepAwakeCommand(platform, process.pid);

  // The helper lives in this scope: interrupting it (setting off, server
  // stopping) closes the scope, which kills the helper.
  const holdAwake = (helper: NonNullable<typeof command>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const child = yield* spawner.spawn(ChildProcess.make(helper.command, [...helper.args]));
        yield* Effect.logInfo("Keep awake is on", { helper: helper.command });
        const exitCode = yield* child.exitCode;
        yield* Effect.logWarning("Keep awake helper stopped on its own", {
          helper: helper.command,
          exitCode,
        });
      }),
    ).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not keep this machine awake", {
          helper: helper.command,
          cause,
        }),
      ),
      Effect.ensuring(Effect.logInfo("Keep awake is off")),
    );

  const run =
    command === null
      ? Effect.void
      : Stream.concat(Stream.fromEffect(settings.getSettings), settings.streamChanges).pipe(
          Stream.map((current) => current.keepAwake),
          Stream.changes,
          Stream.switchMap((enabled) =>
            enabled ? Stream.fromEffect(holdAwake(command)) : Stream.empty,
          ),
          Stream.runDrain,
          Effect.catch((cause) =>
            Effect.logWarning("Keep awake stopped following settings", { cause }),
          ),
        );

  return KeepAwake.of({ supported: command !== null, run });
});

export const layer = Layer.effect(KeepAwake, make);
