import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  availableChatWorkspaceRoot,
  availableScratchWorkspaceRoot,
} from "@t3tools/client-runtime/operations/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ManagedProjectKind } from "@t3tools/contracts";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useEnvironments } from "~/state/environments";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { useNewThreadHandler } from "./useHandleNewThread";

const FAILURE_TITLE: Record<ManagedProjectKind, string> = {
  scratch: "Could not start without a project",
  chat: "Could not start a Claude chat",
};

function reportScratchFailure(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

export function useScratchProject() {
  const { environments } = useEnvironments();
  const openScratch = useAtomCommand(projectEnvironment.openScratch, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();

  const environmentFor = (environmentId: EnvironmentId | null) =>
    environments.find((entry) => entry.environmentId === environmentId);

  const scratchWorkspaceRootFor = (environmentId: EnvironmentId | null): string | null => {
    const environment = environmentFor(environmentId);
    return availableScratchWorkspaceRoot(environment?.connection.phase, environment?.serverConfig);
  };

  const chatWorkspaceRootFor = (environmentId: EnvironmentId | null): string | null => {
    const environment = environmentFor(environmentId);
    return availableChatWorkspaceRoot(environment?.connection.phase, environment?.serverConfig);
  };

  const pickEnvironment = (
    current: EnvironmentId | null,
    rootFor: (environmentId: EnvironmentId | null) => string | null,
  ): EnvironmentId | null => {
    if (current !== null) return rootFor(current) !== null ? current : null;
    const offering = environments.filter((entry) => rootFor(entry.environmentId) !== null);
    return offering.length === 1 ? (offering[0]?.environmentId ?? null) : null;
  };

  const scratchEnvironmentId = (current: EnvironmentId | null) =>
    pickEnvironment(current, scratchWorkspaceRootFor);

  // Chats prefer the current environment but fall back to the first one that
  // offers them, so the sidebar button works from any route.
  const chatEnvironmentId = (current: EnvironmentId | null): EnvironmentId | null =>
    (current !== null && chatWorkspaceRootFor(current) !== null ? current : null) ??
    environments.find((entry) => chatWorkspaceRootFor(entry.environmentId) !== null)
      ?.environmentId ??
    null;

  const openManagedProject = async (
    environmentId: EnvironmentId,
    kind: ManagedProjectKind,
    failureTitle = FAILURE_TITLE[kind],
  ): Promise<EnvironmentProject | null> => {
    const result = await openScratch({
      environmentId,
      input: kind === "scratch" ? {} : { kind },
    });
    if (result._tag === "Success") return result.value;
    if (!isAtomCommandInterrupted(result)) {
      reportScratchFailure(failureTitle, squashAtomCommandFailure(result));
    }
    return null;
  };

  const openScratchProject = (environmentId: EnvironmentId, failureTitle?: string) =>
    openManagedProject(environmentId, "scratch", failureTitle);

  const startManagedThread = async (
    environmentId: EnvironmentId,
    kind: ManagedProjectKind,
    options?: { readonly replace?: boolean },
  ) => {
    const project = await openManagedProject(environmentId, kind);
    if (project) {
      await handleNewThread(scopeProjectRef(project.environmentId, project.id), options).catch(
        (error: unknown) => reportScratchFailure(FAILURE_TITLE[kind], error),
      );
    }
  };

  const startScratchThread = (environmentId: EnvironmentId) =>
    startManagedThread(environmentId, "scratch");

  const startChatThread = (
    environmentId: EnvironmentId,
    options?: { readonly replace?: boolean },
  ) => startManagedThread(environmentId, "chat", options);

  return {
    scratchWorkspaceRootFor,
    scratchEnvironmentId,
    openScratchProject,
    startScratchThread,
    chatWorkspaceRootFor,
    chatEnvironmentId,
    startChatThread,
  };
}
