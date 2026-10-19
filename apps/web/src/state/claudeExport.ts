import { WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

export const claudeExportImport = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:chats:import-claude-export",
  tag: WS_METHODS.chatsImportClaudeExport,
});
