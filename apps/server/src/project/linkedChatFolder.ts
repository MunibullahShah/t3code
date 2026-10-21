import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import {
  CHAT_LINKED_FOLDER_FILE,
  chatRootFor,
  isChatWorkspacePath,
  parseLinkedFolder,
} from "./chatProject.ts";

export interface LinkedChatFolderResolver {
  /** The folder a linked Claude Project's chat works in, when `cwd` is such a chat. */
  readonly linkedFolder: (cwd: string) => Effect.Effect<string | undefined>;
  /**
   * The chat's own folder inside a Claude Project's folder, where an imported
   * chat keeps its earlier conversation. Chats started in T3 have none.
   */
  readonly chatFolder: (projectRoot: string, threadId: string) => Effect.Effect<string | undefined>;
}

/**
 * Chat folders end in an id suffix: the first eight characters of the Claude
 * conversation for imported chats, otherwise the end of the T3 thread id.
 */
export function chatFolderSuffixes(threadId: string): ReadonlyArray<string> {
  const imported = /^import:claude-ai:([0-9a-f-]+)/i.exec(threadId);
  const compact = threadId.toLowerCase().replace(/[^a-z0-9]/g, "");
  return [
    ...(imported?.[1] ? [imported[1].replace(/-/g, "").slice(0, 8).toLowerCase()] : []),
    compact.slice(-8),
    compact,
  ].filter((suffix, index, all) => suffix.length > 0 && all.indexOf(suffix) === index);
}

/**
 * Services optional, so embedders and tests without a data dir keep working;
 * without them nothing is ever linked.
 */
export const makeLinkedChatFolderResolver: Effect.Effect<LinkedChatFolderResolver> = Effect.gen(
  function* () {
    const serverConfig = yield* Effect.serviceOption(ServerConfig.ServerConfig);
    const pathService = yield* Effect.serviceOption(Path.Path);
    const fileSystem = yield* Effect.serviceOption(FileSystem.FileSystem);

    const linkedFolder = Effect.fn("LinkedChatFolder.linkedFolder")(function* (cwd: string) {
      if (Option.isNone(serverConfig) || Option.isNone(pathService) || Option.isNone(fileSystem)) {
        return undefined;
      }
      const path = pathService.value;
      if (!isChatWorkspacePath(path, serverConfig.value.baseDir, cwd)) return undefined;
      const chatRoot = chatRootFor(path, serverConfig.value.baseDir);
      // A Claude Project's chats sit one folder below the project, so the link
      // file is looked up in the chat's folder, then its parent. The chats root
      // itself is never a project, so a stray file there links nothing.
      const candidates = [cwd, path.dirname(cwd)].filter((dir) => path.resolve(dir) !== chatRoot);
      for (const dir of candidates) {
        const text = yield* fileSystem.value
          .readFileString(path.join(dir, CHAT_LINKED_FOLDER_FILE))
          .pipe(Effect.option);
        if (Option.isNone(text)) continue;
        const folder = parseLinkedFolder(path, text.value);
        if (folder === undefined) {
          yield* Effect.logWarning("Ignoring a chat link file without an absolute path", { dir });
          return undefined;
        }
        const info = yield* fileSystem.value.stat(folder).pipe(Effect.option);
        if (Option.isNone(info) || info.value.type !== "Directory") {
          yield* Effect.logWarning("Ignoring a chat link to a missing folder", { dir, folder });
          return undefined;
        }
        return folder;
      }
      return undefined;
    });

    const chatFolder = Effect.fn("LinkedChatFolder.chatFolder")(function* (
      projectRoot: string,
      threadId: string,
    ) {
      if (Option.isNone(pathService) || Option.isNone(fileSystem)) return undefined;
      const names = yield* fileSystem.value
        .readDirectory(projectRoot)
        .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
      for (const suffix of chatFolderSuffixes(threadId)) {
        const name = names.find((candidate) => candidate.toLowerCase().endsWith(`-${suffix}`));
        if (name !== undefined) return pathService.value.join(projectRoot, name);
      }
      return undefined;
    });

    return { linkedFolder, chatFolder };
  },
);
