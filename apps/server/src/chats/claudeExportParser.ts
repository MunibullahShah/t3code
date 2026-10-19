import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/**
 * claude.ai "Export data" writes conversations.json: an array of conversations,
 * each with `chat_messages`. Fields beyond the ones read here vary between
 * export versions, so every field is optional and unknown ones are ignored.
 */
const ExportContentBlock = Schema.Struct({
  type: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
});

const ExportAttachment = Schema.Struct({
  file_name: Schema.optional(Schema.String),
});

const ExportMessage = Schema.Struct({
  uuid: Schema.optional(Schema.String),
  sender: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  content: Schema.optional(Schema.Array(ExportContentBlock)),
  attachments: Schema.optional(Schema.Array(ExportAttachment)),
  files: Schema.optional(Schema.Array(ExportAttachment)),
  created_at: Schema.optional(Schema.String),
});

const ExportConversation = Schema.Struct({
  uuid: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  created_at: Schema.optional(Schema.String),
  updated_at: Schema.optional(Schema.String),
  chat_messages: Schema.optional(Schema.Array(Schema.Unknown)),
});

const decodeConversation = Schema.decodeUnknownOption(ExportConversation);
const decodeMessage = Schema.decodeUnknownOption(ExportMessage);

export type ClaudeExportRole = "user" | "assistant";

export interface ClaudeExportMessage {
  readonly role: ClaudeExportRole;
  readonly text: string;
  readonly createdAt: string;
}

export interface ClaudeExportConversation {
  readonly uuid: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: ReadonlyArray<ClaudeExportMessage>;
}

export interface ClaudeExportParseResult {
  readonly conversations: ReadonlyArray<ClaudeExportConversation>;
  /** Entries that were not conversations, or had no readable messages. */
  readonly skippedCount: number;
}

export class ClaudeExportFormatError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "ClaudeExportFormatError";
  }
}

const UNTITLED = "Untitled chat";
const UUID_PATTERN = /^[0-9a-z-]{8,64}$/i;

function validIso(value: string | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  return DateTime.make(value).pipe(
    Option.map(DateTime.formatIso),
    Option.getOrElse(() => fallback),
  );
}

function messageText(message: typeof ExportMessage.Type): string {
  // Only text blocks are conversation: thinking, tool calls and their results
  // were Claude's working and would bury the actual replies.
  const fromBlocks = (message.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text?.trim() ?? "")
    .filter((text) => text.length > 0)
    .join("\n\n");
  const body = fromBlocks.length > 0 ? fromBlocks : (message.text ?? "").trim();
  const fileNames = [...(message.attachments ?? []), ...(message.files ?? [])]
    .map((file) => file.file_name?.trim() ?? "")
    .filter((name) => name.length > 0);
  const filesNote =
    fileNames.length === 0 ? "" : `_Attached: ${Array.from(new Set(fileNames)).join(", ")}_`;
  return [body, filesNote].filter((part) => part.length > 0).join("\n\n");
}

function parseMessage(raw: unknown, fallbackAt: string): Option.Option<ClaudeExportMessage> {
  return decodeMessage(raw).pipe(
    Option.flatMap((message) => {
      const role: ClaudeExportRole | null =
        message.sender === "human" ? "user" : message.sender === "assistant" ? "assistant" : null;
      const text = messageText(message);
      return role === null || text.length === 0
        ? Option.none()
        : Option.some({ role, text, createdAt: validIso(message.created_at, fallbackAt) });
    }),
  );
}

function parseConversation(raw: unknown, now: string): Option.Option<ClaudeExportConversation> {
  return decodeConversation(raw).pipe(
    Option.filter((conversation) => UUID_PATTERN.test(conversation.uuid)),
    Option.flatMap((conversation) => {
      const createdAt = validIso(conversation.created_at, now);
      const messages = (conversation.chat_messages ?? []).flatMap((message) =>
        Option.toArray(parseMessage(message, createdAt)),
      );
      if (messages.length === 0) return Option.none();
      const title = conversation.name?.trim() || UNTITLED;
      return Option.some({
        uuid: conversation.uuid.toLowerCase(),
        title,
        createdAt,
        updatedAt: validIso(conversation.updated_at, messages.at(-1)?.createdAt ?? createdAt),
        messages,
      });
    }),
  );
}

export function parseClaudeExport(json: unknown, now: string): ClaudeExportParseResult {
  if (!Array.isArray(json)) {
    throw new ClaudeExportFormatError(
      "This is not a Claude export: conversations.json should hold a list of conversations.",
    );
  }
  const conversations = json.flatMap((raw) => Option.toArray(parseConversation(raw, now)));
  return { conversations, skippedCount: json.length - conversations.length };
}

/** How many of the most recent characters Claude is given when a chat resumes. */
export const CHAT_HISTORY_CONTEXT_CHARS = 120_000;

/**
 * The transcript Claude reads back when an imported chat is continued, since
 * claude.ai conversations have no Claude Code session to resume.
 */
export function renderChatHistory(conversation: ClaudeExportConversation): string {
  const turns = conversation.messages.map(
    (message) => `### ${message.role === "user" ? "User" : "Claude"}\n\n${message.text}`,
  );
  return [`# ${conversation.title}`, "", ...turns.flatMap((turn) => [turn, ""])].join("\n");
}

/** Keeps the end of a long history, where the conversation left off. */
export function truncateChatHistory(
  history: string,
  maxChars = CHAT_HISTORY_CONTEXT_CHARS,
): string {
  if (history.length <= maxChars) return history;
  return `[Earlier messages omitted]\n\n${history.slice(history.length - maxChars)}`;
}
