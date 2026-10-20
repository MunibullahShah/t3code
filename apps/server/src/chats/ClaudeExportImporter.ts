import {
  ClaudeExportImportError,
  CommandId,
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

const decodeAssignments = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.String));

interface ImportedProject {
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
}

const importedMessages = (conversation: ClaudeExportConversation) =>
  conversation.messages.slice(-MAX_IMPORTED_MESSAGES);

export const importedProjectChatThreadId = (conversationUuid: string) =>
  ThreadId.make(`import:claude-ai:${conversationUuid}:project`);

function chatFolderName(conversation: ClaudeExportConversation): string {
  const words = conversation.title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 6)
    .join("-")
    .slice(0, 48);
  return [words || "chat", conversation.uuid.replace(/-/g, "").slice(0, 8)].join("-");
}

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

  const writeChat = Effect.fn("ClaudeExportImporter.writeChat")(function* (input: {
    readonly threadId: ThreadId;
    readonly projectId: ProjectId;
    readonly folder: string;
    readonly conversation: ClaudeExportConversation;
  }) {
    const { threadId, conversation } = input;
    yield* fileSystem.writeFileString(
      path.join(input.folder, CHAT_HISTORY_FILE),
      renderChatHistory(conversation),
    );
    const thread = chatThread({
      threadId,
      projectId: input.projectId,
      conversation,
      worktreePath: input.folder,
    });
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
        ...importedMessages(conversation).flatMap((message, index) =>
          messageEvents({ threadId, index, message }),
        ),
      ],
    });
  });

  const importToChats = Effect.fn("ClaudeExportImporter.importToChats")(function* (
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
    yield* writeChat({ threadId, projectId, folder: folder.value, conversation });
    return "imported" as const;
  });

  /**
   * Inside the project's folder, so the chat finds the project's context file
   * one level up. A copy imported earlier into Chats moves here only while it
   * still holds exactly what was imported; a chat the user continued stays put.
   */
  const importToProject = Effect.fn("ClaudeExportImporter.importToProject")(function* (
    project: ImportedProject,
    conversation: ClaudeExportConversation,
  ) {
    const threadId = importedProjectChatThreadId(conversation.uuid);
    if (yield* threadExists(threadId)) return "already-imported" as const;
    const earlierId = importedChatThreadId(conversation.uuid);
    if (yield* threadExists(earlierId)) {
      const messageCount = yield* orchestrator
        .getMessageCount(earlierId)
        .pipe(Effect.orElseSucceed(() => -1));
      if (messageCount !== importedMessages(conversation).length) return "kept" as const;
      yield* orchestrator.dispatch({
        type: "thread.delete",
        commandId: CommandId.make(`${IMPORT_EVENT_PREFIX}:move:${earlierId}`),
        threadId: earlierId,
      });
    }
    const folder = path.join(project.workspaceRoot, chatFolderName(conversation));
    yield* fileSystem.makeDirectory(folder, { recursive: true });
    yield* writeChat({ threadId, projectId: project.projectId, folder, conversation });
    return "placed" as const;
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
    const imported = new Map<string, ImportedProject>();
    for (const project of projects) {
      const saved = yield* folders
        .ensureChatSubProject({ key: project.uuid, title: project.name })
        .pipe(
          Effect.tap(({ workspaceRoot }) =>
            fileSystem.writeFileString(
              path.join(workspaceRoot, CHAT_PROJECT_CONTEXT_FILE),
              renderProjectContext(project),
            ),
          ),
          Effect.map(Option.some),
          Effect.catch((cause) =>
            Effect.logWarning("Could not import a Claude Project", {
              project: project.uuid,
              cause,
            }).pipe(Effect.as(Option.none<ImportedProject>())),
          ),
        );
      if (Option.isSome(saved)) imported.set(project.uuid, saved.value);
    }
    return imported;
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
    // Projects first: assigned chats are created inside them.
    const projects = yield* importProjects(files.projects);
    const assignments =
      files.assignments === undefined
        ? {}
        : Option.getOrElse(
            Option.flatMap(
              yield* decodeJson(files.assignments).pipe(Effect.option),
              decodeAssignments,
            ),
            () => ({}),
          );
    let importedCount = 0;
    let alreadyImportedCount = 0;
    let placedInProjectCount = 0;
    let skippedCount = parsed.skippedCount;
    for (const conversation of parsed.conversations) {
      const projectUuid = assignments[conversation.uuid]?.toLowerCase();
      const project = projectUuid === undefined ? undefined : projects.get(projectUuid);
      const failed = (cause: unknown) =>
        Effect.logWarning("Could not import a Claude conversation", {
          conversation: conversation.uuid,
          cause,
        }).pipe(Effect.as("failed" as const));
      const outcome =
        project === undefined
          ? yield* importToChats(projectId, conversation).pipe(Effect.catch(failed))
          : yield* importToProject(project, conversation).pipe(Effect.catch(failed));
      if (outcome === "imported") importedCount += 1;
      else if (outcome === "placed") {
        importedCount += 1;
        placedInProjectCount += 1;
      } else if (outcome === "already-imported" || outcome === "kept") alreadyImportedCount += 1;
      else skippedCount += 1;
    }
    const memoryImported = yield* importMemory(files.memories);
    return {
      importedCount,
      alreadyImportedCount,
      skippedCount,
      memoryImported,
      projectCount: projects.size,
      placedInProjectCount,
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
