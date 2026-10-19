import { CLAUDE_EXPORT_HELP, useClaudeExportImport } from "../../hooks/useClaudeExportImport";
import { Button } from "../ui/button";

/** claude.ai chats live on Anthropic's servers, so they come from Claude's export. */
export function ClaudeChatsImportCallout() {
  const { available, importing, importClaudeExport } = useClaudeExportImport();
  if (!available) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Claude Desktop and claude.ai chats</p>
        <p className="text-xs text-muted-foreground">{CLAUDE_EXPORT_HELP}</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={importing}
        onClick={() => void importClaudeExport()}
      >
        {importing ? "Importing…" : "Import chats…"}
      </Button>
    </div>
  );
}
