import { describe, expect, it } from "vite-plus/test";

import { chatFolderSuffixes } from "./linkedChatFolder.ts";

describe("chatFolderSuffixes", () => {
  it("matches imported chats by their Claude conversation id", () => {
    expect(
      chatFolderSuffixes("import:claude-ai:8221668f-62cd-40ef-a78d-a9744f234856:project")[0],
    ).toBe("8221668f");
  });

  it("matches chats started in T3 by the end or whole of their thread id", () => {
    expect(chatFolderSuffixes("65cd146c-6cc6-4123-8cdd-8fe7e5c16206")).toEqual([
      "e5c16206",
      "65cd146c6cc641238cdd8fe7e5c16206",
    ]);
  });
});
