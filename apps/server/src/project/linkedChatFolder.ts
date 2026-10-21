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
  /** `cwd`, or the linked folder standing in for a linked chat's own folder. */
  readonly workspaceFor: (cwd: string) => Effect.Effect<string>;
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

    return {
      linkedFolder,
      workspaceFor: (cwd) => linkedFolder(cwd).pipe(Effect.map((folder) => folder ?? cwd)),
    };
  },
);
