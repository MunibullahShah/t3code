import { CommandId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { chatRootFor, isChatWorkspacePath } from "../project/chatProject.ts";
import { makeLinkedChatFolderResolver } from "../project/linkedChatFolder.ts";

/**
 * Where a thread in a Claude Project should work: the project's linked folder
 * while it has one, otherwise back in the chat's own folder (or the project's,
 * for chats started in T3). Null leaves the thread alone.
 */
export function linkedChatWorktreeTarget(input: {
  readonly current: string | null;
  readonly linkedFolder: string | undefined;
  readonly ownFolder: string | undefined;
  readonly isChatPath: (dir: string) => boolean;
}): { readonly worktreePath: string | null } | null {
  if (input.linkedFolder !== undefined) {
    return input.current === input.linkedFolder ? null : { worktreePath: input.linkedFolder };
  }
  // Unlinked: only undo a move into a folder outside the chats tree.
  if (input.current === null || input.isChatPath(input.current)) return null;
  return { worktreePath: input.ownFolder ?? null };
}

const ACTIVE_STATUSES: ReadonlySet<OrchestrationV2ThreadShell["status"]> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);
const isRunning = (thread: OrchestrationV2ThreadShell) => ACTIVE_STATUSES.has(thread.status);

/**
 * Fork: makes every chat in a linked Claude Project work in the linked folder,
 * the way a coding thread works in its worktree, so the app, the agent and the
 * file panel agree on one folder. Removing the link moves chats back. Runs at
 * startup; a running thread is skipped and picked up next time.
 */
export const syncLinkedChatWorktrees = Effect.fn("LinkedChatWorktrees.sync")(function* () {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const linkedChats = yield* makeLinkedChatFolderResolver;
  const chatRoot = chatRootFor(path, serverConfig.baseDir);
  const isChatPath = (dir: string) => isChatWorkspacePath(path, serverConfig.baseDir, dir);

  for (const project of yield* projects.list()) {
    const projectRoot = project.workspaceRoot;
    if (project.deletedAt !== null || !isChatPath(projectRoot)) continue;
    if (path.resolve(projectRoot) === chatRoot) continue;
    const linkedFolder = yield* linkedChats.linkedFolder(projectRoot);
    const projectThreads = yield* threads.listProjectThreads({
      projectId: project.projectId,
      includeSubagents: false,
    });
    for (const thread of projectThreads) {
      if (thread.deletedAt !== null || isRunning(thread)) continue;
      const target = linkedChatWorktreeTarget({
        current: thread.worktreePath,
        linkedFolder,
        ownFolder: yield* linkedChats.chatFolder(projectRoot, thread.id),
        isChatPath,
      });
      if (target === null) continue;
      const uuid = yield* randomUuidV4;
      yield* threads
        .dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make(`linked-chat-worktree:${uuid}`),
          threadId: thread.id,
          worktreePath: target.worktreePath,
          expectedWorktreePath: thread.worktreePath,
        })
        .pipe(
          Effect.tap(() =>
            Effect.logInfo("Moved a linked chat's working folder", {
              threadId: thread.id,
              worktreePath: target.worktreePath,
            }),
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("Could not move a linked chat's working folder", {
              threadId: thread.id,
              cause,
            }),
          ),
        );
    }
  }
});

export const runLinkedChatWorktreeSync = syncLinkedChatWorktrees().pipe(
  Effect.catchCause((cause) => Effect.logWarning("Linked chat folder sync failed", { cause })),
);
