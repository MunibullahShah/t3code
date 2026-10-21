// @effect-diagnostics nodeBuiltinImport:off - electron-builder calls this hook as a plain async function, outside any Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

const execFileAsync = NodeUtil.promisify(NodeChildProcess.execFile);

/** The parts of electron-builder's afterPack context this hook reads. */
export interface SelfSignPackContext {
  readonly appOutDir: string;
  readonly electronPlatformName: string;
  readonly packager: { readonly appInfo: { readonly productFilename: string } };
}

export function selfSignArgs(input: {
  readonly appPath: string;
  readonly identity: string;
  readonly keychain: string | undefined;
}): ReadonlyArray<string> {
  return [
    "--force",
    "--deep",
    "--sign",
    input.identity,
    ...(input.keychain ? ["--keychain", input.keychain] : []),
    input.appPath,
  ];
}

/**
 * Fork-only afterPack hook: seals an unsigned macOS build with one stable
 * self-signed identity. macOS's updater installs an update only when it meets
 * the running app's designated requirement, and an ad-hoc signature pins that
 * requirement to one build's hash, so only a reused identity lets the next
 * build pass. It runs before electron-builder zips the app and writes
 * latest-mac.yml, so every artifact carries this signature.
 */
export default async function selfSign(context: SelfSignPackContext): Promise<void> {
  if (context.electronPlatformName !== "darwin") return;
  const identity = process.env.T3CODE_MAC_SELF_SIGN_IDENTITY?.trim();
  if (!identity) return;
  const appPath = NodePath.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const keychain = process.env.T3CODE_MAC_SELF_SIGN_KEYCHAIN?.trim() || undefined;
  await execFileAsync("codesign", [...selfSignArgs({ appPath, identity, keychain })]);
  await execFileAsync("codesign", ["--verify", "--deep", "--strict", appPath]);
}
