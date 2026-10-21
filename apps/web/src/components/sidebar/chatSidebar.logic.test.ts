import { describe, expect, it } from "@effect/vitest";

import { buildChatSidebarModel } from "./chatSidebar.logic";

const ROOT = "/Users/me/.t3/chats";
const projects = [
  { id: "chats", environmentId: "local", title: "Chats", workspaceRoot: ROOT },
  {
    id: "docwise",
    environmentId: "local",
    title: "Docwise",
    workspaceRoot: `${ROOT}/projects/docwise-1`,
  },
  {
    id: "branding",
    environmentId: "local",
    title: "Personal branding",
    workspaceRoot: `${ROOT}/projects/branding-2`,
  },
  {
    id: "empty",
    environmentId: "local",
    title: "Accounting agent",
    workspaceRoot: `${ROOT}/projects/acc-3`,
  },
  { id: "code", environmentId: "local", title: "My app", workspaceRoot: "/Users/me/code/app" },
];

const thread = (id: string, projectId: string, at: string, title = id) => ({
  id,
  environmentId: "local",
  projectId,
  title,
  archivedAt: null,
  latestUserMessageAt: at,
  updatedAt: at,
  createdAt: at,
  lineage: { relationshipToParent: null },
});

const threads = [
  thread("loose-old", "chats", "2026-01-01T00:00:00Z", "Budget recall"),
  thread("loose-new", "chats", "2026-10-01T00:00:00Z", "Tailored resume"),
  thread("doc-1", "docwise", "2026-09-01T00:00:00Z", "Typebot setup"),
  thread("brand-1", "branding", "2026-10-10T00:00:00Z", "Job application"),
  thread("code-1", "code", "2026-10-15T00:00:00Z", "Fix build"),
  { ...thread("archived", "chats", "2026-10-19T00:00:00Z"), archivedAt: "2026-10-19T00:00:00Z" },
];

const model = (query?: string) =>
  buildChatSidebarModel({
    threads,
    projects,
    chatWorkspaceRootFor: () => ROOT,
    ...(query === undefined ? {} : { query }),
  });

describe("buildChatSidebarModel", () => {
  it("nests project chats under their projects and lists the rest below", () => {
    const { projects: groups, chats } = model();
    expect(
      groups.map((group) => [group.project.title, group.chats.map((chat) => chat.id)]),
    ).toEqual([
      ["Personal branding", ["brand-1"]],
      ["Docwise", ["doc-1"]],
      ["Accounting agent", []],
    ]);
    expect(chats.map((chat) => chat.id)).toEqual(["loose-new", "loose-old"]);
  });

  it("leaves out coding projects and archived chats", () => {
    const ids = [...model().projects.flatMap((group) => group.chats), ...model().chats].map(
      (chat) => chat.id,
    );
    expect(ids).not.toContain("code-1");
    expect(ids).not.toContain("archived");
  });

  it("searches chat titles and project names", () => {
    expect(model("resume").chats.map((chat) => chat.id)).toEqual(["loose-new"]);
    expect(model("resume").projects).toEqual([]);
    const byProjectName = model("docwise");
    expect(byProjectName.projects.map((group) => group.project.title)).toEqual(["Docwise"]);
    expect(byProjectName.projects[0]?.chats.map((chat) => chat.id)).toEqual(["doc-1"]);
  });

  it("lifts pinned chats out of their place into pin order, coding threads excluded", () => {
    const pin = <T extends object>(item: T, pinOrderKey: string) => ({
      ...item,
      pinnedAt: "2026-10-21T00:00:00Z",
      pinOrderKey,
    });
    const pinnedModel = buildChatSidebarModel({
      threads: [
        ...threads.filter((item) => !["loose-old", "doc-1", "code-1"].includes(item.id)),
        pin(thread("loose-old", "chats", "2026-01-01T00:00:00Z", "Budget recall"), "b"),
        pin(thread("doc-1", "docwise", "2026-09-01T00:00:00Z", "Typebot setup"), "a"),
        pin(thread("code-1", "code", "2026-10-15T00:00:00Z", "Fix build"), "c"),
      ],
      projects,
      chatWorkspaceRootFor: () => ROOT,
    });
    expect(pinnedModel.pinned.map((chat) => chat.id)).toEqual(["doc-1", "loose-old"]);
    expect(pinnedModel.chats.map((chat) => chat.id)).toEqual(["loose-new"]);
    expect(pinnedModel.projects.find((group) => group.project.title === "Docwise")?.chats).toEqual(
      [],
    );
  });
});
