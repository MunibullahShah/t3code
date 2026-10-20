import { ClaudeExportImportError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- type-only, to collect a yauzl Readable.
import type * as NodeStream from "node:stream";

import { openZipArchive } from "../zipArchive.ts";

export const CONVERSATIONS_FILE = "conversations.json";
/**
 * Optional, written beside conversations.json: `{ conversationUuid: projectUuid }`.
 * Claude's export does not record which project a chat was in, so this map
 * (built from the user's own project lists) puts chats back in their projects.
 */
export const PROJECT_ASSIGNMENTS_FILE = "t3-project-assignments.json";
const EXTRA_FOLDERS = ["memories", "projects"] as const;
type ExtraFolder = (typeof EXTRA_FOLDERS)[number];

export interface ClaudeExportFiles {
  readonly conversations: string;
  /** Raw text of each memories/*.json and projects/*.json, when present. */
  readonly memories: ReadonlyArray<string>;
  readonly projects: ReadonlyArray<string>;
  readonly assignments?: string;
}
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
      let conversations: string | null = null;
      const extras: Record<ExtraFolder, Array<string>> = { memories: [], projects: [] };
      for (let index = 0; index < archive.entryCount; index++) {
        const entry = yield* archive.next;
        if (entry === null) break;
        const name = path.basename(entry.fileName);
        const folder = path.basename(path.dirname(entry.fileName));
        const extra = EXTRA_FOLDERS.find((candidate) => candidate === folder);
        if (name === CONVERSATIONS_FILE) {
          conversations = yield* Effect.scoped(
            Effect.flatMap(archive.streamEntry(entry), collectText),
          );
        } else if (extra !== undefined && name.endsWith(".json")) {
          extras[extra].push(
            yield* Effect.scoped(Effect.flatMap(archive.streamEntry(entry), collectText)),
          );
        }
      }
      if (conversations === null) {
        return yield* notFound(`${path.basename(zipPath)} has no ${CONVERSATIONS_FILE}.`);
      }
      return { conversations, memories: extras.memories, projects: extras.projects };
    }),
  );
});

/** memories/ and projects/ beside an unzipped conversations.json. */
const readExtrasBeside = Effect.fn("claudeExport.readExtrasBeside")(function* (folder: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const readFolder = (extra: ExtraFolder) =>
    fileSystem.readDirectory(path.join(folder, extra)).pipe(
      Effect.orElseSucceed(() => [] as Array<string>),
      Effect.flatMap((names) =>
        Effect.forEach(
          names.filter((name) => name.endsWith(".json")),
          (name) => readJsonFile(path.join(folder, extra, name)).pipe(Effect.option),
        ),
      ),
      Effect.map((texts) => texts.flatMap((text) => (text._tag === "Some" ? [text.value] : []))),
    );
  const assignments = yield* readJsonFile(path.join(folder, PROJECT_ASSIGNMENTS_FILE)).pipe(
    Effect.option,
  );
  return {
    memories: yield* readFolder("memories"),
    projects: yield* readFolder("projects"),
    ...(assignments._tag === "Some" ? { assignments: assignments.value } : {}),
  };
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

/** Reads conversations.json, plus memories and projects, from a folder, zip or json path. */
export const readClaudeExport = Effect.fn("claudeExport.read")(function* (
  inputPath: string,
): Effect.fn.Return<ClaudeExportFiles, ClaudeExportImportError, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!path.isAbsolute(inputPath)) return yield* notFound("Use the full path to the export.");
  const info = yield* fileSystem
    .stat(inputPath)
    .pipe(Effect.mapError(() => notFound(`${inputPath} does not exist.`)));

  if (info.type === "File") {
    const lower = inputPath.toLowerCase();
    if (lower.endsWith(".zip")) return yield* readFromZip(inputPath);
    if (lower.endsWith(".json")) {
      const conversations = yield* readJsonFile(inputPath);
      return { conversations, ...(yield* readExtrasBeside(path.dirname(inputPath))) };
    }
    return yield* notFound(NOT_AN_EXPORT);
  }
  if (info.type !== "Directory") return yield* notFound(NOT_AN_EXPORT);

  const unzipped = path.join(inputPath, CONVERSATIONS_FILE);
  if (yield* fileSystem.exists(unzipped).pipe(Effect.orElseSucceed(() => false))) {
    const conversations = yield* readJsonFile(unzipped);
    return { conversations, ...(yield* readExtrasBeside(inputPath)) };
  }
  for (const zip of yield* zipsIn(inputPath)) {
    const files = yield* readFromZip(zip).pipe(
      Effect.catchIf(
        (error) => error.reason === "not-found",
        () => Effect.succeed(null),
      ),
    );
    if (files !== null) return files;
  }
  return yield* notFound(NOT_AN_EXPORT);
});
