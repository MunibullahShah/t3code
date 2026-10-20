import * as Schema from "effect/Schema";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * A path on the server's machine: the folder Claude's "Export data" zip was
 * saved or unzipped into, the zip itself, or its conversations.json.
 */
export const ClaudeExportImportInput = Schema.Struct({
  path: TrimmedNonEmptyString,
});
export type ClaudeExportImportInput = typeof ClaudeExportImportInput.Type;

export const ClaudeExportImportResult = Schema.Struct({
  importedCount: NonNegativeInt,
  alreadyImportedCount: NonNegativeInt,
  skippedCount: NonNegativeInt,
  /** Whether Claude's memory about the user was found and saved for chats. */
  memoryImported: Schema.optionalKey(Schema.Boolean),
  /** Claude Projects made into chat projects (new or refreshed). */
  projectCount: Schema.optionalKey(NonNegativeInt),
  /** Chats placed in (or moved into) their Claude Project. */
  placedInProjectCount: Schema.optionalKey(NonNegativeInt),
});
export type ClaudeExportImportResult = typeof ClaudeExportImportResult.Type;

export class ClaudeExportImportError extends Schema.TaggedError<ClaudeExportImportError>()(
  "ClaudeExportImportError",
  {
    reason: Schema.Literals(["not-found", "unreadable", "invalid", "chats-unavailable"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}
