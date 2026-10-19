import { ClaudeExportImportError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- type-only, to collect a yauzl Readable.
import type * as NodeStream from "node:stream";

import { openZipArchive } from "../zipArchive.ts";

export const CONVERSATIONS_FILE = "conversations.json";
// Large accounts export hundreds of MB; past this, JSON.parse would stall the server.
const MAX_EXPORT_BYTES = 1024 * 1024 * 1024;

const notFound = (detail: string) => new ClaudeExportImportError({ reason: "not-found", detail });
const unreadable = (detail: string) =>
  new ClaudeExportImportError({ reason: "unreadable", detail });

const NOT_AN_EXPORT =
  "No Claude export found there. Pick the folder with the export zip from Claude (Settings → Privacy → Export data), or the folder you unzipped it into.";

function collectText(readable: NodeStream.Readable) {
  return Effect.callback<string, ClaudeExportImportError>((resume) => {
    const chunks: Array<Buffer> = [];
    let size = 0;
    readable.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_EXPORT_BYTES) {
        readable.destroy();
        resume(Effect.fail(unreadable("The export is larger than 1 GB.")));
        return;
      }
      chunks.push(chunk);
    });
    readable.once("end", () => resume(Effect.succeed(Buffer.concat(chunks).toString("utf8"))));
    readable.once("error", (cause) =>
      resume(Effect.fail(unreadable(`Could not read the export: ${String(cause)}`))),
    );
  });
}

const readFromZip = Effect.fn("claudeExport.readFromZip")(function* (zipPath: string) {
  const path = yield* Path.Path;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const archive = yield* openZipArchive(zipPath, (detail) => unreadable(detail));
      for (let index = 0; index < archive.entryCount; index++) {
        const entry = yield* archive.next;
        if (entry === null) break;
        if (path.basename(entry.fileName) !== CONVERSATIONS_FILE) continue;
        const readable = yield* archive.streamEntry(entry);
        return yield* collectText(readable);
      }
      return yield* notFound(`${path.basename(zipPath)} has no ${CONVERSATIONS_FILE}.`);
    }),
  );
});

const readJsonFile = Effect.fn("claudeExport.readJsonFile")(function* (filePath: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const info = yield* fileSystem
    .stat(filePath)
    .pipe(Effect.mapError(() => unreadable(`Could not read ${filePath}.`)));
  if (Number(info.size) > MAX_EXPORT_BYTES) {
    return yield* unreadable("The export is larger than 1 GB.");
  }
  return yield* fileSystem
    .readFileString(filePath)
    .pipe(Effect.mapError(() => unreadable(`Could not read ${filePath}.`)));
});

/** Newest zip first: a Downloads folder may hold several exports. */
const zipsIn = Effect.fn("claudeExport.zipsIn")(function* (folder: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const names = yield* fileSystem
    .readDirectory(folder)
    .pipe(Effect.mapError(() => unreadable(`Could not open ${folder}.`)));
  const zips = yield* Effect.forEach(
    names.filter((name) => name.toLowerCase().endsWith(".zip")),
    (name) =>
      fileSystem.stat(path.join(folder, name)).pipe(
        Effect.map((info) => ({
          file: path.join(folder, name),
          mtime: info.mtime._tag === "Some" ? info.mtime.value.getTime() : 0,
        })),
        Effect.orElseSucceed(() => null),
      ),
  );
  return zips
    .filter((zip) => zip !== null)
    .toSorted((a, b) => b.mtime - a.mtime)
    .map((zip) => zip.file);
});

/** Returns the raw text of conversations.json from a folder, zip or json path. */
export const readClaudeExport = Effect.fn("claudeExport.read")(function* (inputPath: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!path.isAbsolute(inputPath)) return yield* notFound("Use the full path to the export.");
  const info = yield* fileSystem
    .stat(inputPath)
    .pipe(Effect.mapError(() => notFound(`${inputPath} does not exist.`)));

  if (info.type === "File") {
    const lower = inputPath.toLowerCase();
    if (lower.endsWith(".zip")) return yield* readFromZip(inputPath);
    if (lower.endsWith(".json")) return yield* readJsonFile(inputPath);
    return yield* notFound(NOT_AN_EXPORT);
  }
  if (info.type !== "Directory") return yield* notFound(NOT_AN_EXPORT);

  const unzipped = path.join(inputPath, CONVERSATIONS_FILE);
  if (yield* fileSystem.exists(unzipped).pipe(Effect.orElseSucceed(() => false))) {
    return yield* readJsonFile(unzipped);
  }
  for (const zip of yield* zipsIn(inputPath)) {
    const text = yield* readFromZip(zip).pipe(
      Effect.catchIf(
        (error) => error.reason === "not-found",
        () => Effect.succeed(null),
      ),
    );
    if (text !== null) return text;
  }
  return yield* notFound(NOT_AN_EXPORT);
});
