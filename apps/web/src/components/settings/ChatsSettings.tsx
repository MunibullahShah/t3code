import { AppMode } from "@t3tools/contracts";

import { useState } from "react";

import {
  CLAUDE_EXPORT_HELP,
  pickExportFolder,
  useClaudeExportImport,
} from "../../hooks/useClaudeExportImport";
import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
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
  const [exportPath, setExportPath] = useState("");
  const canBrowse = typeof window !== "undefined" && window.desktopBridge !== undefined;

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
      >
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void importClaudeExport(exportPath);
          }}
        >
          <Input
            size="sm"
            aria-label="Claude export folder or zip"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            placeholder="/Users/you/Downloads/claude-export"
            className="min-w-0 flex-1"
            value={exportPath}
            disabled={!available || importing}
            onChange={(event) => setExportPath(event.currentTarget.value)}
          />
          {canBrowse ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!available || importing}
              onClick={() =>
                void pickExportFolder().then((picked) => {
                  if (picked) setExportPath(picked);
                })
              }
            >
              Browse…
            </Button>
          ) : null}
          <Button
            type="submit"
            size="sm"
            disabled={!available || importing || exportPath.trim().length === 0}
          >
            {importing ? "Importing…" : "Import"}
          </Button>
        </form>
      </SettingsRow>
    </SettingsSection>
  );
}
