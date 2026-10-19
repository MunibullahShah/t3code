import { describe, expect, it } from "@effect/vitest";

import { chatProjectScopeKeys } from "./projects.ts";

describe("chatProjectScopeKeys", () => {
  const projects = [
    { environmentId: "local", id: "chats", workspaceRoot: "/Users/me/.t3/chats" },
    { environmentId: "local", id: "app", workspaceRoot: "/Users/me/code/app" },
    { environmentId: "remote", id: "chats-r", workspaceRoot: "/home/me/.t3/chats/" },
    { environmentId: "old", id: "chats-o", workspaceRoot: "/srv/.t3/chats" },
  ];
  const roots: Record<string, string | undefined> = {
    local: "/Users/me/.t3/chats",
    remote: "/home/me/.t3/chats",
  };

  it("keys each environment's Chats project and nothing else", () => {
    expect(chatProjectScopeKeys(projects, (environmentId) => roots[environmentId])).toEqual(
      new Set(["local:chats", "remote:chats-r"]),
    );
  });

  it("is empty when no environment offers chats", () => {
    expect(chatProjectScopeKeys(projects, () => null).size).toBe(0);
  });
});
