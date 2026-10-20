import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { MessageCircleIcon, PlusIcon, SearchIcon, SquareLibraryIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { useProjects, useServerConfigs, useThreadShells } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import {
  SidebarContent,
  SidebarGroup,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "../ui/sidebar";
import { buildChatSidebarModel, CHAT_PROJECT_PREVIEW_COUNT } from "./chatSidebar.logic";
import { SidebarChromeFooter, SidebarChromeHeader } from "./SidebarChrome";

const threadKeyOf = (thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

/**
 * Chat mode's sidebar, laid out like Claude Desktop: New, each Claude Project
 * with its latest chats, then chats that belong to no project.
 */
export default function ChatSidebar() {
  const router = useRouter();
  const threads = useThreadShells();
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const routeTarget = useThreadRouteTarget();
  const handleNewThread = useNewThreadHandler();
  const { chatEnvironmentId, startChatThread } = useScratchProject();
  const { isMobile, setOpenMobile } = useSidebar();
  const [query, setQuery] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(new Set());

  const activeThreadKey =
    routeTarget?.kind === "server" ? scopedThreadKey(routeTarget.threadRef) : null;
  const model = buildChatSidebarModel({
    threads,
    projects,
    query,
    chatWorkspaceRootFor: (environmentId) =>
      serverConfigs.get(environmentId as EnvironmentId)?.chatWorkspaceRoot ?? null,
  });
  const chatEnvironment = chatEnvironmentId(null);
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  const openThread = (thread: EnvironmentThreadShell) => {
    closeOnMobile();
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
    });
  };
  const startChat = () => {
    if (chatEnvironment === null) return;
    closeOnMobile();
    void startChatThread(chatEnvironment);
  };
  const startProjectChat = (project: { environmentId: EnvironmentId; id: ProjectId }) => {
    closeOnMobile();
    void handleNewThread(scopeProjectRef(project.environmentId, project.id));
  };
  const toggleExpanded = (key: string) =>
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const searching = query.trim().length > 0;
  const isEmpty = model.projects.length === 0 && model.chats.length === 0;

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="min-h-full"
        fixedHeader={
          <SidebarGroup className="z-[1]">
            <div className="flex h-8 items-center gap-2 rounded-md px-2 text-sidebar-muted-foreground hover:bg-sidebar-row-hover">
              <SearchIcon className="size-4 shrink-0" />
              <SidebarInput
                nativeInput
                type="search"
                value={query}
                placeholder="Search"
                aria-label="Search chats"
                className="min-w-0 flex-1"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </div>
          </SidebarGroup>
        }
      >
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                variant="strong"
                onClick={startChat}
                disabled={chatEnvironment === null}
              >
                <PlusIcon />
                <span>New</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {model.projects.map(({ key, project, chats }) => {
              const expanded = searching || expandedProjects.has(key);
              const shown = expanded ? chats : chats.slice(0, CHAT_PROJECT_PREVIEW_COUNT);
              return (
                <SidebarMenuItem key={key} className="mt-1">
                  <div className="group/chat-project flex items-center">
                    <SidebarMenuButton
                      variant="strong"
                      className="min-w-0 flex-1"
                      title={`New chat in ${project.title}`}
                      onClick={() => startProjectChat(project)}
                    >
                      <SquareLibraryIcon />
                      <span>{project.title}</span>
                    </SidebarMenuButton>
                    <span className="shrink-0 opacity-0 group-focus-within/chat-project:opacity-100 group-hover/chat-project:opacity-100">
                      <SidebarMenuButton
                        size="icon"
                        aria-label={`New chat in ${project.title}`}
                        onClick={() => startProjectChat(project)}
                      >
                        <PlusIcon />
                      </SidebarMenuButton>
                    </span>
                  </div>
                  {shown.length > 0 ? (
                    <SidebarMenuSub>
                      {shown.map((thread) => (
                        <ChatSubRow
                          key={threadKeyOf(thread)}
                          title={thread.title}
                          active={activeThreadKey === threadKeyOf(thread)}
                          onOpen={() => openThread(thread)}
                        />
                      ))}
                      {!searching && chats.length > CHAT_PROJECT_PREVIEW_COUNT ? (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            render={<button type="button" />}
                            className="text-sidebar-muted-foreground"
                            onClick={() => toggleExpanded(key)}
                          >
                            <span>{expanded ? "Show less" : "View all"}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ) : null}
                    </SidebarMenuSub>
                  ) : null}
                </SidebarMenuItem>
              );
            })}

            {model.chats.length > 0 ? <li aria-hidden className="h-1" /> : null}
            {model.chats.map((thread) => (
              <SidebarMenuItem key={threadKeyOf(thread)}>
                <SidebarMenuButton
                  variant="strong"
                  isActive={activeThreadKey === threadKeyOf(thread)}
                  onClick={() => openThread(thread)}
                >
                  <MessageCircleIcon />
                  <span>{thread.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          {isEmpty ? (
            <p className="px-2 py-3 text-sm text-sidebar-muted-foreground">
              {searching ? "No chats match your search." : "No chats yet."}
            </p>
          ) : null}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}

function ChatSubRow(props: {
  readonly title: string;
  readonly active: boolean;
  readonly onOpen: () => void;
}) {
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        render={<button type="button" />}
        isActive={props.active}
        className="w-full"
        onClick={props.onOpen}
      >
        <span>{props.title}</span>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}
