import {
  ClaudeExportImportError,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ClaudeExportImportInput,
  type ClaudeExportImportResult,
  type OrchestrationV2AppThread,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { messageEvents } from "../project/AgentSessionImporter.ts";
import {
  CHAT_HISTORY_FILE,
  CHAT_MEMORY_FILE,
  CHAT_PROJECT_CONTEXT_FILE,
} from "../project/chatProject.ts";
import {
  parseClaudeProject,
  renderClaudeMemory,
  renderProjectContext,
} from "./claudeExportExtras.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import {
  ClaudeExportFormatError,
  parseClaudeExport,
  renderChatHistory,
  type ClaudeExportConversation,
} from "./claudeExportParser.ts";
import { readClaudeExport } from "./claudeExportSource.ts";

const IMPORT_EVENT_PREFIX = "claude-export-import:v1";
const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");
// Projections and the thread view stay fast; the full text still reaches
// Claude through the history file.
const MAX_IMPORTED_MESSAGES = 1000;

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const invalid = (detail: string) => new ClaudeExportImportError({ reason: "invalid", detail });

export const importedChatThreadId = (conversationUuid: string) =>
  ThreadId.make(`import:claude-ai:${conversationUuid}`);

function chatThread(input: {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly conversation: ClaudeExportConversation;
  readonly worktreePath: string;
}): OrchestrationV2AppThread {
  const instanceId = ProviderInstanceId.make(CLAUDE_DRIVER);
  const createdAt = DateTime.makeUnsafe(input.conversation.createdAt);
  const updatedAt = DateTime.makeUnsafe(input.conversation.updatedAt);
  return {
    createdBy: "system",
    creationSource: "server",
    id: input.threadId,
    projectId: input.projectId,
    title: input.conversation.title,
    providerInstanceId: instanceId,
    modelSelection: {
      instanceId,
      model: DEFAULT_MODEL_BY_PROVIDER[CLAUDE_DRIVER] ?? "claude-fable-5-1",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    branch: null,
    worktreePath: input.worktreePath,
    linkedPullRequest: null,
    branchPullRequest: null,
    activeProviderThreadId: null,
    historyOrigin: "v1_import",
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: input.threadId },
    forkedFrom: null,
    createdAt,
    updatedAt,
    archivedAt: null,
    // Imported chats are ordinary conversations, not finished inbox items.
    settledOverride: null,
    settledAt: null,
    unsettledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    activeOrderKey: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const eventSink = yield* EventSink.EventSinkV2;

  const threadExists = (threadId: ThreadId) =>
    Effect.option(orchestrator.getThreadRecords(threadId, [])).pipe(Effect.map(Option.isSome));

  const importConversation = Effect.fn("ClaudeExportImporter.importConversation")(function* (
    projectId: ProjectId,
    conversation: ClaudeExportConversation,
  ) {
    const threadId = importedChatThreadId(conversation.uuid);
    if (yield* threadExists(threadId)) return "already-imported" as const;
    const folder = yield* folders.folderForThread({
      projectId,
      threadId,
      text: conversation.title,
    });
    if (Option.isNone(folder)) {
      return yield* new ClaudeExportImportError({
        reason: "chats-unavailable",
        detail: "Chats are not available on this machine.",
      });
    }
    yield* fileSystem.writeFileString(
      path.join(folder.value, CHAT_HISTORY_FILE),
      renderChatHistory(conversation),
    );
    const thread = chatThread({ threadId, projectId, conversation, worktreePath: folder.value });
    const messages = conversation.messages.slice(-MAX_IMPORTED_MESSAGES);
    yield* eventSink.write({
      events: [
        {
          id: EventId.make(`${IMPORT_EVENT_PREFIX}:thread:${threadId}:created`),
          type: "thread.created",
          threadId,
          providerInstanceId: thread.providerInstanceId,
          occurredAt: thread.createdAt,
          payload: thread,
        },
        ...messages.flatMap((message, index) => messageEvents({ threadId, index, message })),
      ],
    });
    return "imported" as const;
  });

  const parseJsonTexts = (texts: ReadonlyArray<string>) =>
    Effect.forEach(texts, (text) => decodeJson(text).pipe(Effect.option)).pipe(
      Effect.map((decoded) => decoded.flatMap(Option.toArray)),
    );

  // Re-importing replaces the saved memory: the newest export is the truth.
  const importMemory = Effect.fn("ClaudeExportImporter.importMemory")(function* (
    texts: ReadonlyArray<string>,
  ) {
    const memory = renderClaudeMemory(yield* parseJsonTexts(texts));
    const chats = yield* folders.chatRoot;
    if (Option.isNone(memory) || Option.isNone(chats)) return false;
    return yield* fileSystem
      .writeFileString(path.join(chats.value, CHAT_MEMORY_FILE), memory.value)
      .pipe(
        Effect.as(true),
        Effect.catch((cause) =>
          Effect.logWarning("Could not save Claude memory", { cause }).pipe(Effect.as(false)),
        ),
      );
  });

  const importProjects = Effect.fn("ClaudeExportImporter.importProjects")(function* (
    texts: ReadonlyArray<string>,
  ) {
    const projects = (yield* parseJsonTexts(texts)).flatMap((json) =>
      Option.toArray(parseClaudeProject(json)),
    );
    let count = 0;
    for (const project of projects) {
      const saved = yield* folders
        .ensureChatSubProject({ key: project.uuid, title: project.name })
        .pipe(
          Effect.flatMap(({ workspaceRoot }) =>
            fileSystem.writeFileString(
              path.join(workspaceRoot, CHAT_PROJECT_CONTEXT_FILE),
              renderProjectContext(project),
            ),
          ),
          Effect.as(true),
          Effect.catch((cause) =>
            Effect.logWarning("Could not import a Claude Project", {
              project: project.uuid,
              cause,
            }).pipe(Effect.as(false)),
          ),
        );
      if (saved) count += 1;
    }
    return count;
  });

  const importExport = Effect.fn("ClaudeExportImporter.importExport")(function* (
    input: ClaudeExportImportInput,
  ) {
    const files = yield* readClaudeExport(input.path).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
    const json = yield* decodeJson(files.conversations).pipe(
      Effect.mapError(() =>
        invalid("conversations.json is not valid JSON. Download the export again."),
      ),
    );
    const now = DateTime.formatIso(yield* DateTime.now);
    const parsed = yield* Effect.try({
      try: () => parseClaudeExport(json, now),
      catch: (cause) =>
        invalid(
          cause instanceof ClaudeExportFormatError ? cause.message : "Could not read the export.",
        ),
    });
    const { projectId } = yield* folders.ensureChatProject.pipe(
      Effect.mapError(
        (cause) =>
          new ClaudeExportImportError({ reason: "chats-unavailable", detail: cause.message }),
      ),
    );
    let importedCount = 0;
    let alreadyImportedCount = 0;
    let skippedCount = parsed.skippedCount;
    for (const conversation of parsed.conversations) {
      const outcome = yield* importConversation(projectId, conversation).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not import a Claude conversation", {
            conversation: conversation.uuid,
            cause,
          }).pipe(Effect.as("failed" as const)),
        ),
      );
      if (outcome === "imported") importedCount += 1;
      else if (outcome === "already-imported") alreadyImportedCount += 1;
      else skippedCount += 1;
    }
    const memoryImported = yield* importMemory(files.memories);
    const projectCount = yield* importProjects(files.projects);
    return {
      importedCount,
      alreadyImportedCount,
      skippedCount,
      memoryImported,
      projectCount,
    } satisfies ClaudeExportImportResult;
  });

  return { importExport } satisfies ClaudeExportImporterShape;
});

export interface ClaudeExportImporterShape {
  readonly importExport: (
    input: ClaudeExportImportInput,
  ) => Effect.Effect<ClaudeExportImportResult, ClaudeExportImportError>;
}

export class ClaudeExportImporter extends Context.Service<
  ClaudeExportImporter,
  ClaudeExportImporterShape
>()("t3/chats/ClaudeExportImporter") {}

export const layer = Layer.effect(ClaudeExportImporter, make);
