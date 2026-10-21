import { describe, expect, it } from "vite-plus/test";

import { linkedChatWorktreeTarget } from "./LinkedChatWorktrees.ts";

const isChatPath = (dir: string) => dir.startsWith("/home/me/.t3/chats/");
const own = "/home/me/.t3/chats/projects/everflow-1/gl-review-8221668f";
const linked = "/home/me/code/everflow";

describe("linkedChatWorktreeTarget", () => {
  it("moves chats of a linked project into the linked folder", () => {
    expect(
      linkedChatWorktreeTarget({ current: own, linkedFolder: linked, ownFolder: own, isChatPath }),
    ).toEqual({ worktreePath: linked });
    expect(
      linkedChatWorktreeTarget({
        current: null,
        linkedFolder: linked,
        ownFolder: undefined,
        isChatPath,
      }),
    ).toEqual({ worktreePath: linked });
  });

  it("leaves chats already in the linked folder alone", () => {
    expect(
      linkedChatWorktreeTarget({
        current: linked,
        linkedFolder: linked,
        ownFolder: own,
        isChatPath,
      }),
    ).toBeNull();
  });

  it("moves chats back when the link is removed", () => {
    expect(
      linkedChatWorktreeTarget({
        current: linked,
        linkedFolder: undefined,
        ownFolder: own,
        isChatPath,
      }),
    ).toEqual({ worktreePath: own });
    expect(
      linkedChatWorktreeTarget({
        current: linked,
        linkedFolder: undefined,
        ownFolder: undefined,
        isChatPath,
      }),
    ).toEqual({ worktreePath: null });
  });

  it("never touches unlinked chats in their own folders", () => {
    expect(
      linkedChatWorktreeTarget({
        current: own,
        linkedFolder: undefined,
        ownFolder: own,
        isChatPath,
      }),
    ).toBeNull();
    expect(
      linkedChatWorktreeTarget({
        current: null,
        linkedFolder: undefined,
        ownFolder: own,
        isChatPath,
      }),
    ).toBeNull();
  });
});
