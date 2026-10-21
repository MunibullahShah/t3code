import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { chatRootFor, isChatWorkspacePath, parseLinkedFolder } from "./chatProject.ts";

const baseDir = "/home/user/.t3";

const withPath = (body: (path: Path.Path) => void) =>
  Path.Path.pipe(Effect.map(body), Effect.provide(NodeServices.layer));

it.effect("roots chats under the base dir", () =>
  withPath((path) => assert.equal(chatRootFor(path, baseDir), "/home/user/.t3/chats")),
);

it.effect("recognizes the chat root and its per-thread folders", () =>
  withPath((path) => {
    assert.isTrue(isChatWorkspacePath(path, baseDir, "/home/user/.t3/chats"));
    assert.isTrue(isChatWorkspacePath(path, baseDir, "/home/user/.t3/chats/2026-10-19-hello-abc"));
  }),
);

it.effect("rejects other folders, look-alike prefixes and missing paths", () =>
  withPath((path) => {
    assert.isFalse(isChatWorkspacePath(path, baseDir, "/home/user/.t3/scratch/x"));
    assert.isFalse(isChatWorkspacePath(path, baseDir, "/home/user/.t3/chats-old"));
    assert.isFalse(isChatWorkspacePath(path, baseDir, "/home/user/code/app"));
    assert.isFalse(isChatWorkspacePath(path, baseDir, null));
    assert.isFalse(isChatWorkspacePath(path, baseDir, ""));
  }),
);

it.effect("reads a linked folder from the first non-blank line", () =>
  withPath((path) => {
    assert.equal(
      parseLinkedFolder(path, "\n  /home/user/code/app/  \nignored"),
      "/home/user/code/app",
    );
    assert.equal(parseLinkedFolder(path, "/home/user/My Repo\r\n"), "/home/user/My Repo");
  }),
);

it.effect("ignores link files without an absolute path", () =>
  withPath((path) => {
    assert.isUndefined(parseLinkedFolder(path, ""));
    assert.isUndefined(parseLinkedFolder(path, "   \n"));
    assert.isUndefined(parseLinkedFolder(path, "code/app"));
    assert.isUndefined(parseLinkedFolder(path, "~/code/app"));
  }),
);
