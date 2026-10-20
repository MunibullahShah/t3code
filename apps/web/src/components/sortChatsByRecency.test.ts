import { describe, expect, it } from "vitest";

import { sortChatsByRecency } from "./Sidebar.logic";

const chat = (id: string, latestUserMessageAt: string | null, updatedAt: string) => ({
  id,
  latestUserMessageAt,
  updatedAt,
  createdAt: "2026-01-01T00:00:00.000Z",
});

describe("sortChatsByRecency", () => {
  it("puts the most recently talked-in chat first", () => {
    const sorted = sortChatsByRecency([
      chat("old", "2026-03-01T00:00:00.000Z", "2026-10-20T00:00:00.000Z"),
      chat("newest", "2026-10-19T00:00:00.000Z", "2026-10-19T00:00:00.000Z"),
      chat("never-sent", null, "2026-05-01T00:00:00.000Z"),
    ]);
    expect(sorted.map((thread) => thread.id)).toEqual(["newest", "never-sent", "old"]);
  });
});
