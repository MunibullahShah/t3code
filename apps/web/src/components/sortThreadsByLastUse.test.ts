import { describe, expect, it } from "@effect/vitest";

import { sortThreadsByLastUse } from "./Sidebar.logic";

const chat = (
  id: string,
  latestUserMessageAt: string | null,
  updatedAt: string,
  createdAt = "2026-01-01T00:00:00.000Z",
) => ({ id, latestUserMessageAt, updatedAt, createdAt });

describe("sortThreadsByLastUse", () => {
  it("puts the most recently talked-in chat first", () => {
    const sorted = sortThreadsByLastUse([
      chat("old", "2026-03-01T00:00:00.000Z", "2026-10-20T00:00:00.000Z"),
      chat("newest", "2026-10-19T00:00:00.000Z", "2026-10-19T00:00:00.000Z"),
      chat("never-sent", null, "2026-05-01T00:00:00.000Z"),
    ]);
    expect(sorted.map((thread) => thread.id)).toEqual(["newest", "never-sent", "old"]);
  });

  it("moves an older thread above newer ones once it is used again", () => {
    const sorted = sortThreadsByLastUse([
      chat("started-today", null, "2026-10-21T09:00:00.000Z", "2026-10-21T09:00:00.000Z"),
      chat(
        "started-yesterday",
        "2026-10-21T10:00:00.000Z",
        "2026-10-21T10:00:05.000Z",
        "2026-10-20T09:00:00.000Z",
      ),
    ]);
    expect(sorted.map((thread) => thread.id)).toEqual(["started-yesterday", "started-today"]);
  });
});
