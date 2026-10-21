import { expect, it } from "vite-plus/test";

import { selfSignArgs } from "./self-sign-macos.ts";

it("signs the whole bundle with the configured identity and keychain", () => {
  expect(
    selfSignArgs({
      appPath: "/tmp/out/T3 Code (Beta).app",
      identity: "T3 Fork Signing",
      keychain: "/tmp/fork.keychain-db",
    }),
  ).toEqual([
    "--force",
    "--deep",
    "--sign",
    "T3 Fork Signing",
    "--keychain",
    "/tmp/fork.keychain-db",
    "/tmp/out/T3 Code (Beta).app",
  ]);
  expect(
    selfSignArgs({ appPath: "/tmp/a.app", identity: "T3 Fork Signing", keychain: undefined }),
  ).toEqual(["--force", "--deep", "--sign", "T3 Fork Signing", "/tmp/a.app"]);
});
