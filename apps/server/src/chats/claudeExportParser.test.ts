import { assert, describe, it } from "@effect/vitest";

import {
  ClaudeExportFormatError,
  parseClaudeExport,
  renderChatHistory,
  truncateChatHistory,
} from "./claudeExportParser.ts";

const NOW = "2026-10-20T00:00:00.000Z";

const conversation = (overrides: Record<string, unknown> = {}) => ({
  uuid: "0f3a2b1c-1111-4222-8333-444455556666",
  name: "Trip to Lisbon",
  created_at: "2026-03-01T10:00:00.000000+00:00",
  updated_at: "2026-03-01T10:05:00.000000+00:00",
  chat_messages: [
    {
      uuid: "m1",
      sender: "human",
      text: "Plan a weekend in Lisbon",
      content: [{ type: "text", text: "Plan a weekend in Lisbon" }],
      attachments: [{ file_name: "itinerary.pdf" }],
      files: [],
      created_at: "2026-03-01T10:00:00.000000+00:00",
    },
    {
      uuid: "m2",
      sender: "assistant",
      text: "",
      content: [
        { type: "thinking", thinking: "hmm" },
        { type: "text", text: "Day 1: Alfama." },
        { type: "tool_use", name: "web_search" },
        { type: "text", text: "Day 2: Belém." },
      ],
      created_at: "2026-03-01T10:01:00.000000+00:00",
    },
  ],
  ...overrides,
});

describe("parseClaudeExport", () => {
  it("reads conversations, keeping only text and noting attachments", () => {
    const result = parseClaudeExport([conversation()], NOW);
    assert.equal(result.skippedCount, 0);
    const [parsed] = result.conversations;
    assert.equal(parsed?.title, "Trip to Lisbon");
    assert.equal(parsed?.createdAt, "2026-03-01T10:00:00.000Z");
    assert.deepEqual(
      parsed?.messages.map((message) => [message.role, message.text]),
      [
        ["user", "Plan a weekend in Lisbon\n\n_Attached: itinerary.pdf_"],
        ["assistant", "Day 1: Alfama.\n\nDay 2: Belém."],
      ],
    );
  });

  it("falls back to the plain text field and names untitled chats", () => {
    const result = parseClaudeExport(
      [
        conversation({
          name: "",
          chat_messages: [{ sender: "human", text: "Hello", created_at: "bad date" }],
        }),
      ],
      NOW,
    );
    const [parsed] = result.conversations;
    assert.equal(parsed?.title, "Untitled chat");
    assert.equal(parsed?.messages[0]?.text, "Hello");
    assert.equal(parsed?.messages[0]?.createdAt, "2026-03-01T10:00:00.000Z");
  });

  it("skips empty conversations and entries that are not conversations", () => {
    const result = parseClaudeExport(
      [conversation({ chat_messages: [] }), { nope: true }, "text", conversation()],
      NOW,
    );
    assert.equal(result.conversations.length, 1);
    assert.equal(result.skippedCount, 3);
  });

  it("rejects files that are not a list of conversations", () => {
    assert.throws(() => parseClaudeExport({ conversations: [] }, NOW), ClaudeExportFormatError);
  });
});

describe("chat history", () => {
  it("renders a readable transcript", () => {
    const [parsed] = parseClaudeExport([conversation()], NOW).conversations;
    const history = renderChatHistory(parsed!);
    assert.include(history, "# Trip to Lisbon");
    assert.include(history, "### User\n\nPlan a weekend in Lisbon");
    assert.include(history, "### Claude\n\nDay 1: Alfama.");
  });

  it("keeps the end of a long history", () => {
    const truncated = truncateChatHistory(`${"a".repeat(50)}END`, 10);
    assert.isTrue(truncated.startsWith("[Earlier messages omitted]"));
    assert.isTrue(truncated.endsWith("aaaaaaaEND"));
    assert.equal(truncateChatHistory("short", 10), "short");
  });
});
