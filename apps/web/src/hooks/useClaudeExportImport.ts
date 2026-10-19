import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ClaudeExportImportResult } from "@t3tools/contracts";
import { useState } from "react";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { ensureLocalApi } from "~/localApi";
import { claudeExportImport } from "~/state/claudeExport";
import { useAtomCommand } from "~/state/use-atom-command";
import { useScratchProject } from "./useScratchProject";

export const CLAUDE_EXPORT_HELP =
  "In Claude, open Settings → Privacy → Export data. Claude emails you a zip; download it, then pick the folder it is in.";

export function describeClaudeImport(result: ClaudeExportImportResult): string {
  const parts = [
    `${result.importedCount} ${result.importedCount === 1 ? "chat" : "chats"} imported`,
  ];
  if (result.alreadyImportedCount > 0) {
    parts.push(`${result.alreadyImportedCount} already here`);
  }
  if (result.skippedCount > 0) parts.push(`${result.skippedCount} empty or unreadable skipped`);
  if (result.memoryImported === true) parts.push("memory saved");
  if (result.projectCount !== undefined && result.projectCount > 0) {
    parts.push(
      `${result.projectCount} ${result.projectCount === 1 ? "project" : "projects"} added`,
    );
  }
  return `${parts.join(", ")}.`;
}

function reportImportError(error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Could not import Claude conversations",
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

/**
 * The desktop picker returns a path on the server's machine. Browsers cannot
 * reveal local paths (and Electron has no window.prompt), so other clients
 * type the server-side path into the settings field instead.
 */
export async function pickExportFolder(): Promise<string | null> {
  if (!window.desktopBridge) return null;
  try {
    return await ensureLocalApi().dialogs.pickFolder();
  } catch (error) {
    reportImportError(error);
    return null;
  }
}

export function useClaudeExportImport() {
  const { chatEnvironmentId } = useScratchProject();
  const runImport = useAtomCommand(claudeExportImport, { reportFailure: false });
  const [importing, setImporting] = useState(false);
  const environmentId = chatEnvironmentId(null);

  /** Imports from `path`, or asks for a folder when none is given. */
  const importClaudeExport = async (givenPath?: string) => {
    if (importing) return;
    if (environmentId === null) {
      reportImportError(new Error("No connected environment offers chats."));
      return;
    }
    const path = givenPath?.trim() || (await pickExportFolder());
    if (!path) {
      if (!window.desktopBridge) {
        reportImportError(
          new Error("Type the export's full path in Settings → General → Chats, then Import."),
        );
      }
      return;
    }
    setImporting(true);
    try {
      const result = await runImport({ environmentId, input: { path } });
      if (result._tag === "Success") {
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: "Claude conversations imported",
            description: `${describeClaudeImport(result.value)} Find them under Chats.`,
          }),
        );
      } else if (!isAtomCommandInterrupted(result)) {
        reportImportError(squashAtomCommandFailure(result));
      }
    } catch (error) {
      reportImportError(error);
    } finally {
      setImporting(false);
    }
  };

  return { available: environmentId !== null, importing, importClaudeExport };
}
