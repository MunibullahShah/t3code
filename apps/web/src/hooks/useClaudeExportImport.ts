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
  return `${parts.join(", ")}.`;
}

async function askForExportPath(): Promise<string | null> {
  // The desktop picker returns a path on the server's machine. Browsers cannot
  // reveal local paths, so a remote web client types the server-side path.
  if (window.desktopBridge) {
    return ensureLocalApi().dialogs.pickFolder();
  }
  const typed = window.prompt(`${CLAUDE_EXPORT_HELP}\n\nFull path to the export folder or zip:`);
  return typed?.trim() || null;
}

export function useClaudeExportImport() {
  const { chatEnvironmentId } = useScratchProject();
  const runImport = useAtomCommand(claudeExportImport, { reportFailure: false });
  const [importing, setImporting] = useState(false);
  const environmentId = chatEnvironmentId(null);

  const importClaudeExport = async () => {
    if (environmentId === null || importing) return;
    const path = await askForExportPath();
    if (path === null) return;
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
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not import Claude conversations",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    } finally {
      setImporting(false);
    }
  };

  return { available: environmentId !== null, importing, importClaudeExport };
}
