import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/**
 * Besides conversations.json, Claude's export carries `memories/*.json` (what
 * Claude remembers about the user) and `projects/*.json` (Claude Projects with
 * custom instructions and knowledge docs). Fields are read leniently, like the
 * conversation parser, because the export format is not versioned.
 */
const MemoryExport = Schema.Struct({
  conversations_memory: Schema.optional(Schema.NullOr(Schema.String)),
  memory_files: Schema.optional(
    Schema.Array(
      Schema.Struct({
        path: Schema.optional(Schema.String),
        content: Schema.optional(Schema.String),
      }),
    ),
  ),
});

const ProjectExport = Schema.Struct({
  uuid: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  prompt_template: Schema.optional(Schema.NullOr(Schema.String)),
  is_starter_project: Schema.optional(Schema.Boolean),
  docs: Schema.optional(
    Schema.Array(
      Schema.Struct({
        filename: Schema.optional(Schema.String),
        content: Schema.optional(Schema.String),
      }),
    ),
  ),
});

const decodeMemory = Schema.decodeUnknownOption(MemoryExport);
const decodeProject = Schema.decodeUnknownOption(ProjectExport);

export interface ClaudeExportProjectDoc {
  readonly filename: string;
  readonly content: string;
}

export interface ClaudeExportProject {
  readonly uuid: string;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly docs: ReadonlyArray<ClaudeExportProjectDoc>;
}

const trimmed = (value: string | null | undefined) => value?.trim() ?? "";

/** Merges every memories/*.json into one Markdown document, or none if empty. */
export function renderClaudeMemory(memoryJsons: ReadonlyArray<unknown>): Option.Option<string> {
  const sections = memoryJsons.flatMap((json) =>
    Option.toArray(decodeMemory(json)).flatMap((memory) => {
      const summary = trimmed(memory.conversations_memory);
      const files = (memory.memory_files ?? [])
        .map((file) => ({ path: trimmed(file.path), content: trimmed(file.content) }))
        .filter((file) => file.content.length > 0)
        .map((file) => (file.path ? `### ${file.path}\n\n${file.content}` : file.content));
      return [...(summary ? [`## Summary\n\n${summary}`] : []), ...files];
    }),
  );
  return sections.length === 0
    ? Option.none()
    : Option.some(["# What Claude remembers about the user", "", ...sections].join("\n\n"));
}

/** Starter projects are Anthropic's samples, not the user's own work. */
export function parseClaudeProject(json: unknown): Option.Option<ClaudeExportProject> {
  return decodeProject(json).pipe(
    Option.filter((project) => project.is_starter_project !== true),
    Option.filter((project) => /^[0-9a-z-]{8,64}$/i.test(project.uuid)),
    Option.map((project) => ({
      uuid: project.uuid.toLowerCase(),
      name: trimmed(project.name) || "Untitled project",
      description: trimmed(project.description),
      instructions: trimmed(project.prompt_template),
      docs: (project.docs ?? [])
        .map((doc) => ({
          filename: trimmed(doc.filename) || "document",
          content: trimmed(doc.content),
        }))
        .filter((doc) => doc.content.length > 0),
    })),
  );
}

export function renderProjectContext(project: ClaudeExportProject): string {
  const parts = [`# Claude Project: ${project.name}`];
  if (project.description) parts.push(`## About this project\n\n${project.description}`);
  if (project.instructions) parts.push(`## Project instructions\n\n${project.instructions}`);
  for (const doc of project.docs) parts.push(`## Knowledge: ${doc.filename}\n\n${doc.content}`);
  return parts.join("\n\n");
}
