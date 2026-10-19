import { assert, describe, it } from "@effect/vitest";
import * as Option from "effect/Option";

import {
  parseClaudeProject,
  renderClaudeMemory,
  renderProjectContext,
} from "./claudeExportExtras.ts";

describe("renderClaudeMemory", () => {
  it("merges the summary and memory files into one document", () => {
    const memory = renderClaudeMemory([
      {
        conversations_memory: "Builds apps with Effect.",
        memory_files: [
          { path: "work.md", content: "Works at Docwise." },
          { path: "empty.md", content: "  " },
        ],
      },
    ]);
    const text = Option.getOrThrow(memory);
    assert.include(text, "## Summary\n\nBuilds apps with Effect.");
    assert.include(text, "### work.md\n\nWorks at Docwise.");
    assert.notInclude(text, "empty.md");
  });

  it("is empty when there is nothing remembered", () => {
    assert.isTrue(Option.isNone(renderClaudeMemory([{ memory_files: [] }, "junk"])));
  });
});

describe("parseClaudeProject", () => {
  const project = {
    uuid: "019d0341-04b0-7359-a7e3-4d83cbb5f10d",
    name: "Marketing",
    description: "Launch copy",
    prompt_template: "Write in a friendly tone.",
    is_starter_project: false,
    docs: [
      { filename: "brief.md", content: "The product is T3." },
      { filename: "blank.md", content: "" },
    ],
  };

  it("keeps instructions and non-empty docs", () => {
    const parsed = Option.getOrThrow(parseClaudeProject(project));
    assert.equal(parsed.name, "Marketing");
    assert.deepEqual(parsed.docs, [{ filename: "brief.md", content: "The product is T3." }]);
    const context = renderProjectContext(parsed);
    assert.include(context, "## Project instructions\n\nWrite in a friendly tone.");
    assert.include(context, "## Knowledge: brief.md\n\nThe product is T3.");
  });

  it("skips Anthropic's starter projects and malformed entries", () => {
    assert.isTrue(Option.isNone(parseClaudeProject({ ...project, is_starter_project: true })));
    assert.isTrue(Option.isNone(parseClaudeProject({ name: "No id" })));
  });
});
