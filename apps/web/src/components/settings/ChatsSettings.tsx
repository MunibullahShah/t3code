import { AppMode } from "@t3tools/contracts";

import { CLAUDE_EXPORT_HELP, useClaudeExportImport } from "../../hooks/useClaudeExportImport";
import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export const APP_MODE_LABELS: Record<AppMode, string> = {
  code: "Code (projects)",
  chat: "Chat (like Claude)",
};

const isAppMode = (value: unknown): value is AppMode => AppMode.literals.includes(value as AppMode);

export function ChatsSettingsSection() {
  const appMode = useClientSettings((settings) => settings.appMode);
  const { available, importing, importClaudeExport } = useClaudeExportImport();

  return (
    <SettingsSection id="chats" title="Chats">
      <SettingsRow
        {...searchableSetting("app-mode")}
        description="Chat lists your Claude chats and starts new ones, like Claude Desktop. Code is the project-based layout for coding work."
        control={
          <Select
            value={appMode}
            onValueChange={(value) => {
              if (isAppMode(value)) void updateClientSettings({ appMode: value });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Mode">
              <SelectValue>{APP_MODE_LABELS[appMode]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {AppMode.literals.map((mode) => (
                <SelectItem hideIndicator key={mode} value={mode}>
                  {APP_MODE_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        {...searchableSetting("import-claude-chats")}
        description={
          available
            ? `Bring your claude.ai and Claude Desktop conversations into Chats, where you can keep going. ${CLAUDE_EXPORT_HELP}`
            : "Connect to an environment that offers chats to import."
        }
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={!available || importing}
            onClick={() => void importClaudeExport()}
          >
            {importing ? "Importing…" : "Choose export…"}
          </Button>
        }
      />
    </SettingsSection>
  );
}
