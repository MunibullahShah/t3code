import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId, type OrchestrationV2DomainEvent, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { CHAT_HISTORY_FILE } from "../project/chatProject.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ClaudeExportImporter from "./ClaudeExportImporter.ts";

const projectId = ProjectId.make("chats-project");
const UUID = "0f3a2b1c-1111-4222-8333-444455556666";

const exportJson = JSON.stringify([
  {
    uuid: UUID,
    name: "Trip to Lisbon",
    created_at: "2026-03-01T10:00:00Z",
    updated_at: "2026-03-01T10:05:00Z",
    chat_messages: [
      { sender: "human", text: "Plan a weekend in Lisbon", created_at: "2026-03-01T10:00:00Z" },
      {
        sender: "assistant",
        content: [{ type: "text", text: "Day 1: Alfama." }],
        created_at: "2026-03-01T10:01:00Z",
      },
    ],
  },
  { uuid: "11111111-2222-4333-8444-555555555555", name: "Empty", chat_messages: [] },
]);

const harness = (root: string) => {
  const writes: Array<ReadonlyArray<OrchestrationV2DomainEvent>> = [];
  const existing = new Set<ThreadId>();
  const subProjects: Array<string> = [];
  const layer = ClaudeExportImporter.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          namedProjectsRoot: root,
          chatRoot: Effect.succeed(Option.some(root)),
          ensureChatProject: Effect.succeed({ projectId }),
          ensureChatSubProject: ({ key, title }) =>
            Effect.gen(function* () {
              const fileSystem = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const workspaceRoot = path.join(root, "projects", key);
              yield* fileSystem
                .makeDirectory(workspaceRoot, { recursive: true })
                .pipe(Effect.orDie);
              subProjects.push(title);
              return { projectId: ProjectId.make(`sub-${key}`), workspaceRoot };
            }).pipe(Effect.provide(NodeServices.layer)),
          folderForThread: ({ threadId }) =>
            Effect.gen(function* () {
              const fileSystem = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const folder = path.join(root, threadId.replaceAll(":", "-"));
              yield* fileSystem.makeDirectory(folder, { recursive: true }).pipe(Effect.orDie);
              return Option.some(folder);
            }).pipe(Effect.provide(NodeServices.layer)),
        }),
        Layer.mock(Orchestrator.OrchestratorV2)({
          getThreadRecords: (threadId) =>
            existing.has(threadId)
              ? Effect.succeed({ thread: { id: threadId } } as never)
              : Effect.fail(new Orchestrator.OrchestratorProjectionError({ threadId })),
        }),
        Layer.mock(EventSink.EventSinkV2)({
          write: (input) =>
            Effect.sync(() => {
              writes.push(input.events);
              for (const event of input.events) existing.add(event.threadId);
              return [];
            }),
        }),
      ),
    ),
  );
  return { layer, writes, subProjects };
};

it.effect("imports a claude.ai export into Chats once, with a history file per chat", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const exportDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "claude-export-" });
    const chatsRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "chats-" });
    yield* fileSystem.writeFileString(path.join(exportDir, "conversations.json"), exportJson);
    yield* fileSystem.makeDirectory(path.join(exportDir, "memories"));
    yield* fileSystem.writeFileString(
      path.join(exportDir, "memories", "m.json"),
      JSON.stringify({ conversations_memory: "Likes Lisbon.", memory_files: [] }),
    );
    yield* fileSystem.makeDirectory(path.join(exportDir, "projects"));
    yield* fileSystem.writeFileString(
      path.join(exportDir, "projects", "p.json"),
      JSON.stringify({
        uuid: "019d0341-04b0-7359-a7e3-4d83cbb5f10d",
        name: "Travel",
        prompt_template: "Be concise.",
        docs: [],
      }),
    );
    const { layer, writes, subProjects } = harness(chatsRoot);

    yield* Effect.gen(function* () {
      const importer = yield* ClaudeExportImporter.ClaudeExportImporter;
      const first = yield* importer.importExport({ path: exportDir });
      assert.deepEqual(first, {
        importedCount: 1,
        alreadyImportedCount: 0,
        skippedCount: 1,
        memoryImported: true,
        projectCount: 1,
      });
      const again = yield* importer.importExport({
        path: path.join(exportDir, "conversations.json"),
      });
      assert.include(again, { importedCount: 0, alreadyImportedCount: 1, skippedCount: 1 });
    }).pipe(Effect.provide(layer));

    assert.lengthOf(writes, 1);
    const created = writes[0]?.find((event) => event.type === "thread.created");
    const threadId = ClaudeExportImporter.importedChatThreadId(UUID);
    assert.equal(created?.threadId, threadId);
    assert.include(created?.payload as object, {
      projectId,
      title: "Trip to Lisbon",
      activeProviderThreadId: null,
      historyOrigin: "v1_import",
    });
    const texts = writes[0]
      ?.filter((event) => event.type === "message.updated")
      .map((event) => (event.payload as { text: string }).text);
    assert.deepEqual(texts, ["Plan a weekend in Lisbon", "Day 1: Alfama."]);

    assert.isDefined(created);
    const worktreePath = (created!.payload as { worktreePath: string }).worktreePath;
    const history = yield* fileSystem.readFileString(path.join(worktreePath, CHAT_HISTORY_FILE));
    assert.include(history, "### Claude\n\nDay 1: Alfama.");

    const memory = yield* fileSystem.readFileString(path.join(chatsRoot, ".claude-memory.md"));
    assert.include(memory, "Likes Lisbon.");
    assert.deepEqual(subProjects, ["Travel", "Travel"]);
    const projectContext = yield* fileSystem.readFileString(
      path.join(
        chatsRoot,
        "projects",
        "019d0341-04b0-7359-a7e3-4d83cbb5f10d",
        ".claude-project.md",
      ),
    );
    assert.include(projectContext, "## Project instructions\n\nBe concise.");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("explains when the folder holds no export", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const emptyDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "not-export-" });
    const { layer } = harness(emptyDir);
    const error = yield* ClaudeExportImporter.ClaudeExportImporter.pipe(
      Effect.flatMap((importer) => importer.importExport({ path: emptyDir })),
      Effect.flip,
      Effect.provide(layer),
    );
    assert.equal(error.reason, "not-found");
    assert.include(error.message, "Export data");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("rejects JSON that is not a Claude export", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "bad-export-" });
    yield* fileSystem.writeFileString(path.join(dir, "conversations.json"), "{not json");
    const { layer } = harness(dir);
    const error = yield* ClaudeExportImporter.ClaudeExportImporter.pipe(
      Effect.flatMap((importer) => importer.importExport({ path: dir })),
      Effect.flip,
      Effect.provide(layer),
    );
    assert.equal(error.reason, "invalid");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
