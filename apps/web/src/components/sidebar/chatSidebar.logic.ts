import { isChatProject, isScratchProject } from "@t3tools/client-runtime/state/projects";

import { sortChatsByRecency } from "../Sidebar.logic";

/** Claude Desktop shows this many chats under a project before "View all". */
export const CHAT_PROJECT_PREVIEW_COUNT = 4;

interface ChatSidebarThread {
  readonly id: string;
  readonly environmentId: string;
  readonly projectId: string;
  readonly title: string;
  readonly archivedAt: string | null;
  readonly latestUserMessageAt: string | null;
  readonly updatedAt: string;
  readonly createdAt: string;
  readonly lineage: { readonly relationshipToParent: string | null };
}

interface ChatSidebarProject {
  readonly id: string;
  readonly environmentId: string;
  readonly title: string;
  readonly workspaceRoot: string;
}

export interface ChatSidebarProjectGroup<T, P> {
  readonly key: string;
  readonly project: P;
  readonly chats: ReadonlyArray<T>;
}

export interface ChatSidebarModel<T, P> {
  /** Claude Projects, most recently used first; empty ones last, by name. */
  readonly projects: ReadonlyArray<ChatSidebarProjectGroup<T, P>>;
  /** Chats outside any project, most recent first. */
  readonly chats: ReadonlyArray<T>;
}

const projectKey = (item: { readonly environmentId: string; readonly id: string }) =>
  `${item.environmentId}:${item.id}`;

/**
 * Lays chats out like Claude Desktop: each Claude Project with its chats, then
 * the chats that belong to no project. A search keeps only matching chats and
 * the projects that hold them or whose name matches.
 */
export function buildChatSidebarModel<
  T extends ChatSidebarThread,
  P extends ChatSidebarProject,
>(input: {
  readonly threads: ReadonlyArray<T>;
  readonly projects: ReadonlyArray<P>;
  readonly chatWorkspaceRootFor: (environmentId: string) => string | null | undefined;
  readonly query?: string;
}): ChatSidebarModel<T, P> {
  const query = input.query?.trim().toLowerCase() ?? "";
  const matches = (text: string) => query.length === 0 || text.toLowerCase().includes(query);
  const generalKeys = new Set<string>();
  const projectsByKey = new Map<string, P>();
  for (const project of input.projects) {
    const root = input.chatWorkspaceRootFor(project.environmentId);
    if (isScratchProject(project, root)) generalKeys.add(projectKey(project));
    else if (isChatProject(project, root)) projectsByKey.set(projectKey(project), project);
  }

  const chatsByProject = new Map<string, T[]>();
  const looseChats: T[] = [];
  for (const thread of input.threads) {
    if (thread.archivedAt !== null || thread.lineage.relationshipToParent === "subagent") continue;
    const key = `${thread.environmentId}:${thread.projectId}`;
    if (generalKeys.has(key)) {
      if (matches(thread.title)) looseChats.push(thread);
    } else if (projectsByKey.has(key)) {
      const projectMatches = matches(projectsByKey.get(key)!.title);
      if (projectMatches || matches(thread.title)) {
        chatsByProject.set(key, [...(chatsByProject.get(key) ?? []), thread]);
      }
    }
  }

  const groups = [...projectsByKey.entries()]
    .map(([key, project]) => ({
      key,
      project,
      chats: sortChatsByRecency(chatsByProject.get(key) ?? []),
    }))
    .filter(
      (group) => query.length === 0 || group.chats.length > 0 || matches(group.project.title),
    );
  const latest = (group: (typeof groups)[number]) => {
    const newest = group.chats[0];
    return newest === undefined
      ? Number.NEGATIVE_INFINITY
      : Date.parse(newest.latestUserMessageAt ?? newest.updatedAt);
  };
  const projects = groups.toSorted(
    (left, right) =>
      latest(right) - latest(left) || left.project.title.localeCompare(right.project.title),
  );
  return { projects, chats: sortChatsByRecency(looseChats) };
}
