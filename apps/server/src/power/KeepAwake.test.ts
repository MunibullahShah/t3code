import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import type { ServerSettings } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as ServerSettingsModule from "../serverSettings.ts";
import * as KeepAwake from "./KeepAwake.ts";

const settingsWith = (keepAwake: boolean) => ({ keepAwake }) as ServerSettings;

it.effect("runs the helper only while keepAwake is on, and kills it when turned off", () =>
  Effect.gen(function* () {
    const changes = yield* Queue.unbounded<ServerSettings>();
    const spawned: Array<string> = [];
    const started = yield* Deferred.make<void>();
    const stopped = yield* Deferred.make<void>();

    const spawner = ChildProcessSpawner.make((command) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          spawned.push(String((command as { readonly command: string }).command));
          Deferred.doneUnsafe(started, Effect.void);
          return { exitCode: Effect.never } as unknown as ChildProcessSpawner.ChildProcessHandle;
        }),
        () => Deferred.succeed(stopped, undefined),
      ),
    );

    const layer = KeepAwake.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ServerSettingsModule.ServerSettingsService)({
            getSettings: Effect.succeed(settingsWith(false)),
            streamChanges: Stream.fromQueue(changes),
          }),
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
      ),
    );

    yield* Effect.gen(function* () {
      const keepAwake = yield* KeepAwake.KeepAwake;
      assert.isTrue(keepAwake.supported);
      const fiber = yield* Effect.forkChild(keepAwake.run);

      yield* Queue.offer(changes, settingsWith(true));
      yield* Deferred.await(started);
      assert.deepEqual(spawned, ["caffeinate"]);

      // Unrelated setting changes must not restart the helper.
      yield* Queue.offer(changes, settingsWith(true));
      yield* Queue.offer(changes, settingsWith(false));
      yield* Deferred.await(stopped);
      assert.deepEqual(spawned, ["caffeinate"]);

      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.provide(layer), Effect.provideService(HostProcess.Platform, "darwin"));
  }),
);

it.effect("does nothing where the platform has no keep-awake tool", () =>
  Effect.gen(function* () {
    const keepAwake = yield* KeepAwake.KeepAwake;
    assert.isFalse(keepAwake.supported);
    yield* keepAwake.run;
  }).pipe(
    Effect.provide(
      KeepAwake.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ServerSettingsModule.ServerSettingsService)({}),
            Layer.mock(ChildProcessSpawner.ChildProcessSpawner)({}),
          ),
        ),
      ),
    ),
    Effect.provideService(HostProcess.Platform, "win32"),
  ),
);
