import type * as Path from "effect/Path";

/** Folder under the server's base dir that holds one folder per chat thread. */
export const CHAT_FOLDER_NAME = "chats";

export const CHAT_PROJECT_TITLE = "Chats";

/** Written into an imported chat's folder; Claude reads it back on resume. */
export const CHAT_HISTORY_FILE = ".claude-chat-history.md";

/** At the chats root: what Claude remembers about the user, for every chat. */
export const CHAT_MEMORY_FILE = ".claude-memory.md";

/** At a Claude Project's root: its custom instructions and knowledge docs. */
export const CHAT_PROJECT_CONTEXT_FILE = ".claude-project.md";

/**
 * At a Claude Project's root: an absolute folder its chats run in, with tools,
 * instead of chatting tool-less in their own folders.
 */
export const CHAT_LINKED_FOLDER_FILE = ".claude-linked-folder";

/** Claude Projects imported from an export live in folders under here. */
export const CHAT_PROJECTS_FOLDER = "projects";

type PathOps = Pick<Path.Path, "resolve" | "sep">;

type LinkPathOps = Pick<Path.Path, "isAbsolute" | "resolve">;

export function chatRootFor(path: PathOps, baseDir: string): string {
  return path.resolve(baseDir, CHAT_FOLDER_NAME);
}

/**
 * Chat threads run in `<baseDir>/chats` or one of its per-thread folders, so a
 * cwd there marks a conversational thread rather than a coding one.
 */
export function isChatWorkspacePath(
  path: PathOps,
  baseDir: string,
  cwd: string | null | undefined,
): boolean {
  if (cwd == null || cwd.length === 0) return false;
  const root = chatRootFor(path, baseDir);
  const resolved = path.resolve(cwd);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

/** A link file names its folder on the first non-blank line; relative paths are ignored. */
export function parseLinkedFolder(path: LinkPathOps, text: string): string | undefined {
  const folder = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return folder !== undefined && path.isAbsolute(folder) ? path.resolve(folder) : undefined;
}
