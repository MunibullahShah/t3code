import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  type ModelSelection,
  type OrchestrationV2AppThread,
  ProjectId,
  ProviderInstanceId,
  type RuntimeMode,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as ServerConfig from "../config.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as RuntimePolicy from "./RuntimePolicy.ts";

const projectId = ProjectId.make("project:runtime-policy");
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = {
  instanceId: providerInstanceId,
  model: "gpt-5.5",
} satisfies ModelSelection;

function makeThread(input: {
  readonly now: DateTime.Utc;
  readonly worktreePath: string | null;
  readonly runtimeMode?: RuntimeMode;
}): OrchestrationV2AppThread {
  const threadId = ThreadId.make("thread:runtime-policy");
  return {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId,
    title: "Runtime policy",
    providerInstanceId,
    modelSelection,
    runtimeMode: input.runtimeMode ?? "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: input.worktreePath,
    activeProviderThreadId: null,
    lineage: {
      parentThreadId: null,
      relationshipToParent: null,
      rootThreadId: threadId,
    },
    forkedFrom: null,
    createdAt: input.now,
    updatedAt: input.now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

const grokInstanceId = ProviderInstanceId.make("grok");
const supportedRuntimeModesByInstance = new Map<ProviderInstanceId, ReadonlyArray<RuntimeMode>>([
  [grokInstanceId, ["approval-required", "auto", "full-access"]],
]);
const providerInstanceFor = (instanceId: ProviderInstanceId) =>
  ({
    snapshot: {
      getSnapshot: Effect.succeed({
        supportedRuntimeModes: supportedRuntimeModesByInstance.get(instanceId),
      } as ServerProvider),
    },
  }) as ProviderInstance;

const policyDependencies = Layer.mergeAll(
  Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
    getInstance: (instanceId) => Effect.succeed(providerInstanceFor(instanceId)),
    listInstances: Effect.succeed([]),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.never,
  }),
  Layer.mock(ProjectStore.ProjectStoreV2)({
    get: () =>
      Effect.succeed(
        Option.some({
          projectId,
          title: "Project",
          workspaceRoot: "/project-root",
          defaultModelSelection: null,
          defaultThreadEnvMode: null,
          autoPull: false,
          faviconPath: null,
          projectIcon: null,
          scripts: [],
          createdAt: "2026-06-21T00:00:00.000Z",
          updatedAt: "2026-06-21T00:00:00.000Z",
          deletedAt: null,
        }),
      ),
  }),
);

const layerTest = RuntimePolicy.layerFromProjectStore.pipe(Layer.provide(policyDependencies));

const chatLayerTest = RuntimePolicy.layerFromProjectStore.pipe(
  Layer.provide(policyDependencies),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-runtime-policy-chat-" })),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(layerTest)("RuntimePolicyV2", (it) => {
  it.effect("uses the project root for local-checkout threads", () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      const resolved = yield* policy.resolve({
        thread: makeThread({ now, worktreePath: null }),
        modelSelection,
      });
      assert.equal(resolved.cwd, "/project-root");
    }),
  );

  it.effect("prefers a provisioned worktree over the project root", () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      const resolved = yield* policy.resolve({
        thread: makeThread({ now, worktreePath: "/project-worktree" }),
        modelSelection,
      });
      assert.equal(resolved.cwd, "/project-worktree");
    }),
  );

  it.effect("runs a mode the provider does not offer in Supervised", () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      const modeFor = (instanceId: ProviderInstanceId, runtimeMode: RuntimeMode) =>
        policy
          .resolve({
            thread: makeThread({ now, worktreePath: null, runtimeMode }),
            modelSelection: { instanceId, model: "test-model" },
          })
          .pipe(Effect.map((resolved) => resolved.runtimeMode));

      assert.equal(yield* modeFor(grokInstanceId, "auto-accept-edits"), "approval-required");
      assert.equal(yield* modeFor(grokInstanceId, "auto"), "auto");
      assert.equal(yield* modeFor(grokInstanceId, "full-access"), "full-access");
      assert.equal(yield* modeFor(providerInstanceId, "auto-accept-edits"), "auto-accept-edits");
    }),
  );
});

const writeLink = Effect.fn("writeLink")(function* (dir: string, text: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(dir, { recursive: true });
  yield* fs.writeFileString(path.join(dir, ".claude-linked-folder"), text);
});

it.layer(chatLayerTest)("RuntimePolicyV2 chats", (it) => {
  const resolveChat = Effect.fn("resolveChat")(function* (chatFolder: string) {
    const policy = yield* RuntimePolicy.RuntimePolicyV2;
    const now = yield* DateTime.now;
    return yield* policy.resolve({
      thread: makeThread({ now, worktreePath: chatFolder }),
      modelSelection,
    });
  });
  const chatPaths = Effect.fn("chatPaths")(function* (slug: string) {
    const { baseDir } = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    const chatRoot = path.join(baseDir, "chats");
    const project = path.join(chatRoot, "projects", slug);
    return {
      chatRoot,
      project,
      chat: path.join(project, "chat-1"),
      target: path.join(baseDir, slug),
    };
  });

  it.effect("keeps an unlinked chat tool-less in its own folder", () =>
    Effect.gen(function* () {
      const { chatRoot, chat } = yield* chatPaths("unlinked");
      const resolved = yield* resolveChat(chat);
      assert.equal(resolved.cwd, chat);
      assert.isTrue(resolved.chatOnly);
      assert.equal(resolved.chatRoot, chatRoot);
      assert.isUndefined(resolved.chatContextDir);
    }),
  );

  it.effect("runs a linked project's chats in the linked folder with their context", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { chatRoot, project, chat, target } = yield* chatPaths("linked");
      yield* fs.makeDirectory(target, { recursive: true });
      yield* writeLink(project, `${target}\n`);
      const resolved = yield* resolveChat(chat);
      assert.equal(resolved.cwd, target);
      assert.isUndefined(resolved.chatOnly);
      assert.equal(resolved.chatContextDir, chat);
      assert.equal(resolved.chatRoot, chatRoot);
    }),
  );

  it.effect("falls back to a tool-less chat when the linked folder is missing", () =>
    Effect.gen(function* () {
      const { project, chat, target } = yield* chatPaths("missing");
      yield* writeLink(project, target);
      const resolved = yield* resolveChat(chat);
      assert.equal(resolved.cwd, chat);
      assert.isTrue(resolved.chatOnly);
    }),
  );

  it.effect("ignores a link file at the chats root", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { chatRoot, target } = yield* chatPaths("root");
      yield* fs.makeDirectory(target, { recursive: true });
      yield* writeLink(chatRoot, target);
      const looseChat = path.join(chatRoot, "loose-chat");
      const resolved = yield* resolveChat(looseChat);
      assert.equal(resolved.cwd, looseChat);
      assert.isTrue(resolved.chatOnly);
      yield* fs.remove(path.join(chatRoot, ".claude-linked-folder"));
    }),
  );
});
