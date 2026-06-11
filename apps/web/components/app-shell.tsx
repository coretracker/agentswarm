"use client";

import { useMemo, useEffect, useRef, useState, type ReactNode } from "react";
import { App, Button, Card, Divider, Drawer, Flex, Form, Grid, Input, Layout, Menu, Modal, Result, Select, Skeleton, Spin, Typography, message, theme as antTheme } from "antd";
import {
  AppstoreOutlined,
  CopyOutlined,
  DatabaseOutlined,
  LeftOutlined,
  LogoutOutlined,
  MenuOutlined,
  RightOutlined,
  SettingOutlined,
  TeamOutlined,
  UnorderedListOutlined
} from "@ant-design/icons";
import { usePathname, useRouter } from "next/navigation";
import { AppLogo } from "./app-logo";
import { AppSidebar } from "./app-sidebar";
import { AppFooterNote } from "./app-footer-note";
import { ResponsePolicyFields } from "./response-policy-fields";
import { useAuth } from "./auth-provider";
import { TaskBrowserNotifications } from "./task-browser-notifications";
import { useThemeMode } from "./theme-provider";
import { appThemeOptions, type AppThemeMode } from "../src/theme/antd-theme";
import { api } from "../src/api/client";
import { trackEvent } from "../src/utils/analytics";
import { AppRightPanelProvider, type AppRightPanelConfig } from "./app-right-panel-context";
import { NotesMarkdownEditor } from "./notes-markdown-editor";
import type {
  AgentClarifyBehavior,
  AgentCodePreference,
  AgentExplanationDepth,
  AgentFormattingStyle,
  AgentJargonLevel,
  AudienceType,
  UserNotes
} from "@agentswarm/shared-types";
import {
  getRequiredScopesForPathname,
  getSelectedNavigationKey,
  isPublicPathname,
  isTaskInteractiveFullscreenPath,
  navigationRoutes,
  resolveDefaultPath
} from "../src/auth/access";

const menuIconByPath: Record<string, ReactNode> = {
  "/tasks": <UnorderedListOutlined />,
  "/tasks/board": <AppstoreOutlined />,
  "/snippets": <CopyOutlined />,
  "/repositories": <DatabaseOutlined />,
  "/settings": <SettingOutlined />,
  "/users": <TeamOutlined />
};

const NOTES_PANEL_STATE_STORAGE_KEY_PREFIX = "agentswarm:notes-sidebar-state:v1";
const DEFAULT_NOTES_PANEL_WIDTH = 420;
const NOTES_PANEL_MIN_WIDTH = 320;
const NOTES_PANEL_MAX_WIDTH = 720;
const NOTES_PANEL_COLLAPSED_RAIL_WIDTH = 56;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { canAll, loading, logout, session, setSessionUser } = useAuth();
  const { mode, setMode } = useThemeMode();
  const contentMaxWidth = 1760;
  const headerHeight = 64;
  const sidebarWidth = 320;
  const [rightPanelWidth, setRightPanelWidth] = useState(DEFAULT_NOTES_PANEL_WIDTH);
  const [notesSidebarCollapsed, setNotesSidebarCollapsed] = useState(false);
  const notesResizeSessionRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [notesResizing, setNotesResizing] = useState(false);
  const { token } = antTheme.useToken();
  const screens = Grid.useBreakpoint();
  const [loggingOut, setLoggingOut] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileCodexConfigured, setProfileCodexConfigured] = useState(false);
  const [rightPanel, setRightPanel] = useState<AppRightPanelConfig | null>(null);
  const [workspaceNotes, setWorkspaceNotes] = useState<UserNotes | null>(null);
  const [workspaceNotesDraft, setWorkspaceNotesDraft] = useState("");
  const [workspaceNotesLoading, setWorkspaceNotesLoading] = useState(true);
  const [workspaceNotesSaving, setWorkspaceNotesSaving] = useState(false);
  const [workspaceNotesStatus, setWorkspaceNotesStatus] = useState<"saved" | "saving" | "error">("saved");
  const workspaceNotesAutosaveTimeoutRef = useRef<number | null>(null);
  const workspaceNotesSaveRequestIdRef = useRef(0);
  const [profileForm] = Form.useForm<{
    name: string;
    gitAuthorName?: string;
    gitAuthorEmail?: string;
    codexAuthJson?: string;
    audience?: AudienceType;
    explanationDepth?: AgentExplanationDepth;
    jargonLevel?: AgentJargonLevel;
    codePreference?: AgentCodePreference;
    clarifyBehavior?: AgentClarifyBehavior;
    formattingStyle?: AgentFormattingStyle;
    extraInstructions?: string;
  }>();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const publicPath = isPublicPathname(pathname);
  const desktopSidebar = screens.lg ?? false;
  const selectedNavigationKey = getSelectedNavigationKey(pathname);
  const defaultPath = session ? resolveDefaultPath(session.user.scopes) : null;
  const menuItems = navigationRoutes
    .filter((route) => canAll(route.requiredScopes))
    .map((route) => ({
      key: route.key,
      icon: menuIconByPath[route.key],
      label: route.label
    }));
  const hasRouteAccess = session ? canAll(getRequiredScopesForPathname(pathname)) : false;
  const rightPanelContextValue = useMemo(() => ({ setRightPanel }), []);
  const notesPanelId = "workspace-notes-panel";
  const notesPanelStorageKey = useMemo(
    () => `${NOTES_PANEL_STATE_STORAGE_KEY_PREFIX}:${session?.user.id ?? "anonymous"}`,
    [session?.user.id]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.localStorage.getItem(notesPanelStorageKey);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as { collapsed?: boolean; width?: number };
      if (typeof parsed.collapsed === "boolean") {
        setNotesSidebarCollapsed(parsed.collapsed);
      }
      if (typeof parsed.width === "number" && Number.isFinite(parsed.width)) {
        setRightPanelWidth(Math.min(NOTES_PANEL_MAX_WIDTH, Math.max(NOTES_PANEL_MIN_WIDTH, Math.round(parsed.width))));
      }
    } catch {
      // Ignore localStorage read/parse errors.
    }
  }, [notesPanelStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(
        notesPanelStorageKey,
        JSON.stringify({ collapsed: notesSidebarCollapsed, width: rightPanelWidth })
      );
    } catch {
      // Ignore localStorage write errors.
    }
  }, [notesPanelStorageKey, notesSidebarCollapsed, rightPanelWidth]);

  useEffect(() => {
    if (!notesResizing) {
      return;
    }

    const handleMouseMove = (event: MouseEvent): void => {
      const session = notesResizeSessionRef.current;
      if (!session) {
        return;
      }
      const deltaX = session.startX - event.clientX;
      const nextWidth = Math.min(NOTES_PANEL_MAX_WIDTH, Math.max(NOTES_PANEL_MIN_WIDTH, session.startWidth + deltaX));
      setRightPanelWidth(nextWidth);
    };

    const stopResizing = (): void => {
      notesResizeSessionRef.current = null;
      setNotesResizing(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [notesResizing]);

  useEffect(() => {
    if (loading || publicPath) {
      return;
    }

    if (!session) {
      router.replace("/login");
    }
  }, [loading, publicPath, router, session]);

  useEffect(() => {
    if (desktopSidebar) {
      setMobileSidebarOpen(false);
    }
  }, [desktopSidebar]);

  const toggleNotesSidebar = (nextCollapsed: boolean): void => {
    setNotesSidebarCollapsed(nextCollapsed);
    trackEvent(nextCollapsed ? "notes_sidebar_collapsed" : "notes_sidebar_expanded", {
      surface: "app_shell",
      width: rightPanelWidth
    });
  };

  useEffect(() => {
    if (publicPath || !session) {
      return;
    }

    setWorkspaceNotesLoading(true);
    void api
      .getUserNotes()
      .then((next) => {
        setWorkspaceNotes(next);
        setWorkspaceNotesDraft(next.notes);
        setWorkspaceNotesStatus("saved");
      })
      .catch((error) => {
        const messageText = error instanceof Error ? error.message : "Failed to load notes";
        setWorkspaceNotesStatus("error");
        message.error(messageText);
      })
      .finally(() => {
        setWorkspaceNotesLoading(false);
      });
  }, [publicPath, session]);

  useEffect(() => {
    if (workspaceNotesAutosaveTimeoutRef.current !== null) {
      window.clearTimeout(workspaceNotesAutosaveTimeoutRef.current);
      workspaceNotesAutosaveTimeoutRef.current = null;
    }
    if (!workspaceNotes || workspaceNotesDraft === workspaceNotes.notes) {
      setWorkspaceNotesStatus("saved");
      return;
    }

    setWorkspaceNotesStatus("saving");
    workspaceNotesAutosaveTimeoutRef.current = window.setTimeout(() => {
      workspaceNotesAutosaveTimeoutRef.current = null;
      const requestId = workspaceNotesSaveRequestIdRef.current + 1;
      workspaceNotesSaveRequestIdRef.current = requestId;
      setWorkspaceNotesSaving(true);
      void api
        .updateUserNotes({ notes: workspaceNotesDraft })
        .then((next) => {
          if (workspaceNotesSaveRequestIdRef.current !== requestId) {
            return;
          }
          setWorkspaceNotes(next);
          setWorkspaceNotesDraft(next.notes);
          setWorkspaceNotesStatus("saved");
        })
        .catch((error) => {
          if (workspaceNotesSaveRequestIdRef.current !== requestId) {
            return;
          }
          const messageText = error instanceof Error ? error.message : "Failed to save notes";
          setWorkspaceNotesStatus("error");
          message.error(messageText);
        })
        .finally(() => {
          if (workspaceNotesSaveRequestIdRef.current === requestId) {
            setWorkspaceNotesSaving(false);
          }
        });
    }, 700);

    return () => {
      if (workspaceNotesAutosaveTimeoutRef.current !== null) {
        window.clearTimeout(workspaceNotesAutosaveTimeoutRef.current);
        workspaceNotesAutosaveTimeoutRef.current = null;
      }
    };
  }, [workspaceNotes, workspaceNotesDraft]);

  if (publicPath) {
    return <App>{children}</App>;
  }

  if (loading || !session) {
    return <Spin fullscreen tip="Loading session" />;
  }

  const openProfile = async (): Promise<void> => {
    setProfileOpen(true);
    setProfileLoading(true);
    try {
      const profile = await api.getProfile();
      profileForm.setFieldsValue({
        name: profile.name,
        gitAuthorName: profile.gitAuthorName ?? "",
        gitAuthorEmail: profile.gitAuthorEmail ?? "",
        codexAuthJson: "",
        audience: profile.agentResponsePreference.audience,
        explanationDepth: profile.agentResponsePreference.explanationDepth,
        jargonLevel: profile.agentResponsePreference.jargonLevel,
        codePreference: profile.agentResponsePreference.codePreference,
        clarifyBehavior: profile.agentResponsePreference.clarifyBehavior,
        formattingStyle: profile.agentResponsePreference.formattingStyle,
        extraInstructions: profile.agentResponsePreference.extraInstructions ?? ""
      });
      setProfileCodexConfigured(profile.codexAuthJsonConfigured);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Failed to load profile");
    } finally {
      setProfileLoading(false);
    }
  };

  const saveProfile = async (): Promise<void> => {
    try {
      const values = await profileForm.validateFields();
      setSavingProfile(true);
      const next = await api.updateProfile({
        name: values.name,
        gitAuthorName: values.gitAuthorName?.trim() || null,
        gitAuthorEmail: values.gitAuthorEmail?.trim() || null,
        codexAuthJson: values.codexAuthJson?.trim() || undefined,
        agentResponsePreference: {
          audience: values.audience,
          explanationDepth: values.explanationDepth,
          jargonLevel: values.jargonLevel,
          codePreference: values.codePreference,
          clarifyBehavior: values.clarifyBehavior,
          formattingStyle: values.formattingStyle,
          extraInstructions: values.extraInstructions?.trim() || undefined
        }
      });
      setProfileCodexConfigured(next.codexAuthJsonConfigured);
      profileForm.setFieldValue("codexAuthJson", "");
      setSessionUser({
        name: next.name,
        gitAuthorName: next.gitAuthorName,
        gitAuthorEmail: next.gitAuthorEmail,
        agentResponsePreference: next.agentResponsePreference,
        codexAuthJsonConfigured: next.codexAuthJsonConfigured
      });
      message.success("Profile updated");
    } catch (error) {
      if (error && typeof error === "object" && "errorFields" in error) {
        return;
      }
      message.error(error instanceof Error ? error.message : "Failed to update profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const clearCodexAuthJson = async (): Promise<void> => {
    setSavingProfile(true);
    try {
      const next = await api.updateProfile({ clearCodexAuthJson: true });
      setProfileCodexConfigured(next.codexAuthJsonConfigured);
      profileForm.setFieldValue("codexAuthJson", "");
      setSessionUser({
        agentResponsePreference: next.agentResponsePreference,
        codexAuthJsonConfigured: next.codexAuthJsonConfigured
      });
      message.success("Codex auth.json cleared");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Failed to clear Codex auth.json");
    } finally {
      setSavingProfile(false);
    }
  };

  if (isTaskInteractiveFullscreenPath(pathname)) {
    return (
      <App>
        {hasRouteAccess ? (
          <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>{children}</div>
        ) : (
          <Result
            status="403"
            title="403"
            subTitle="This account does not have access to the requested page."
            extra={
              defaultPath ? (
                <Button type="primary" onClick={() => router.push(defaultPath)}>
                  Go To An Allowed Page
                </Button>
              ) : null
            }
          />
        )}
      </App>
    );
  }

  const shellContent = (
    <>
      <AppRightPanelProvider value={rightPanelContextValue}>
        <Layout style={{ minHeight: "100vh", background: token.colorBgLayout }}>
        <Layout.Header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 20,
            paddingInline: 24,
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            boxShadow: token.boxShadowSecondary
          }}
        >
          <Flex
            align="center"
            justify="space-between"
            style={{ height: "100%", width: "100%", gap: 24 }}
          >
            <Flex align="center" gap={12}>
              {!desktopSidebar ? (
                <Button
                  type="text"
                  icon={<MenuOutlined />}
                  aria-label="Open navigation"
                  onClick={() => setMobileSidebarOpen(true)}
                />
              ) : null}
              <AppLogo width={28} height={40} />
              <Flex vertical gap={0}>
                <Typography.Title level={4} style={{ margin: 0, color: token.colorText }}>
                  AgentSwarm
                </Typography.Title>
              </Flex>
            </Flex>
            <Menu
              mode="horizontal"
              selectedKeys={[selectedNavigationKey]}
              items={menuItems}
              onClick={({ key }) => router.push(key)}
              selectable
              style={{ minWidth: 0, borderBottom: 0, flex: 1, background: "transparent" }}
            />
            <Flex align="center" gap={12}>
              <TaskBrowserNotifications />
              <Flex vertical gap={0} style={{ minWidth: 0 }}>
                <Button type="text" style={{ paddingInline: 6 }} onClick={() => { void openProfile(); }}>
                  <Typography.Text strong>{`Hi, ${session.user.name || "Administrator"}`}</Typography.Text>
                </Button>
              </Flex>
              <Select
                value={mode}
                onChange={(value) => setMode(value as AppThemeMode)}
                options={appThemeOptions}
                style={{ minWidth: 180 }}
              />
              <Button
                icon={<LogoutOutlined />}
                loading={loggingOut}
                onClick={async () => {
                  setLoggingOut(true);
                  try {
                    await logout();
                    router.replace("/login");
                  } finally {
                    setLoggingOut(false);
                  }
                }}
              >
                Logout
              </Button>
            </Flex>
          </Flex>
        </Layout.Header>
        <Layout style={{ flex: 1, minHeight: 0, background: token.colorBgLayout }}>
          {desktopSidebar ? (
            <Layout.Sider
              width={sidebarWidth}
              theme="light"
              style={{
                position: "sticky",
                top: headerHeight,
                alignSelf: "flex-start",
                height: `calc(100vh - ${headerHeight}px)`,
                background: token.colorBgContainer,
                borderRight: `1px solid ${token.colorBorderSecondary}`,
                overflow: "hidden"
              }}
            >
              <AppSidebar pathname={pathname} onNavigate={(path) => router.push(path)} />
            </Layout.Sider>
          ) : null}
          <Layout style={{ minWidth: 0, background: token.colorBgLayout }}>
            <Layout.Content style={{ padding: 24, minHeight: 0, overflow: "auto", background: token.colorBgLayout }}>
              <div style={{ width: "100%", maxWidth: contentMaxWidth, marginInline: "auto", minHeight: "100%" }}>
                {hasRouteAccess ? (
                  children
                ) : (
                  <Result
                    status="403"
                    title="403"
                    subTitle="This account does not have access to the requested page."
                    extra={
                      defaultPath ? (
                        <Button type="primary" onClick={() => router.push(defaultPath)}>
                          Go To An Allowed Page
                        </Button>
                      ) : null
                    }
                  />
                )}
              </div>
            </Layout.Content>
            <Layout.Footer
              style={{
                padding: "8px 24px 18px",
                background: token.colorBgLayout
              }}
            >
              <div style={{ width: "100%", maxWidth: contentMaxWidth, marginInline: "auto" }}>
                <AppFooterNote />
              </div>
            </Layout.Footer>
          </Layout>
          {desktopSidebar && !notesSidebarCollapsed ? (
            <Layout.Sider
              id={notesPanelId}
              width={rightPanelWidth}
              theme="light"
              style={{
                position: "sticky",
                top: headerHeight,
                alignSelf: "flex-start",
                height: `calc(100vh - ${headerHeight}px)`,
                background: token.colorBgContainer,
                borderLeft: `1px solid ${token.colorBorderSecondary}`,
                overflow: "hidden",
                userSelect: notesResizing ? "none" : undefined
              }}
            >
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize notes sidebar"
                onMouseDown={(event) => {
                  event.preventDefault();
                  notesResizeSessionRef.current = { startX: event.clientX, startWidth: rightPanelWidth };
                  setNotesResizing(true);
                }}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: 8,
                  height: "100%",
                  cursor: "col-resize",
                  zIndex: 2
                }}
              />
              <Flex vertical style={{ height: "100%", minHeight: 0 }}>
                <Flex
                  justify="space-between"
                  align="center"
                  style={{
                    padding: "16px 16px 12px",
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    gap: 12
                  }}
                >
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    {rightPanel?.title ?? "Notes"}
                  </Typography.Title>
                  <Flex align="center" gap={8}>
                    {rightPanel?.extra ?? null}
                    <Button
                      type="text"
                      size="small"
                      icon={<RightOutlined />}
                      onClick={() => toggleNotesSidebar(true)}
                      aria-label="Collapse notes"
                      aria-controls={notesPanelId}
                      aria-expanded={!notesSidebarCollapsed}
                    >
                      Collapse notes
                    </Button>
                  </Flex>
                </Flex>
                <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16 }}>
                  {rightPanel?.content ?? (
                    <Flex vertical gap={12}>
                      <Typography.Text type={workspaceNotesStatus === "error" ? "danger" : "secondary"}>
                        {workspaceNotesStatus === "saving"
                          ? "Saving…"
                          : workspaceNotesStatus === "error"
                            ? "Save failed. Keep this page open; retrying on next edit."
                            : "Saved"}
                      </Typography.Text>
                      {workspaceNotesLoading ? (
                        <Skeleton active title={false} paragraph={{ rows: 12 }} />
                      ) : (
                        <NotesMarkdownEditor value={workspaceNotesDraft} onChange={setWorkspaceNotesDraft} disabled={workspaceNotesSaving} />
                      )}
                    </Flex>
                  )}
                </div>
              </Flex>
            </Layout.Sider>
          ) : null}
          {desktopSidebar && notesSidebarCollapsed ? (
            <Layout.Sider
              width={NOTES_PANEL_COLLAPSED_RAIL_WIDTH}
              theme="light"
              style={{
                position: "sticky",
                top: headerHeight,
                alignSelf: "flex-start",
                height: `calc(100vh - ${headerHeight}px)`,
                background: token.colorBgContainer,
                borderLeft: `1px solid ${token.colorBorderSecondary}`,
                overflow: "hidden"
              }}
            >
              <Flex vertical justify="flex-start" align="center" style={{ height: "100%", paddingTop: 12 }}>
                <Button
                  type="text"
                  icon={<LeftOutlined />}
                  onClick={() => toggleNotesSidebar(false)}
                  aria-label="Expand notes"
                  aria-controls={notesPanelId}
                  aria-expanded={!notesSidebarCollapsed}
                  title="Expand notes"
                />
              </Flex>
            </Layout.Sider>
          ) : null}
        </Layout>
      </Layout>
      </AppRightPanelProvider>
      <Drawer
        placement="left"
        open={!desktopSidebar && mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        width={sidebarWidth}
        styles={{ body: { padding: 0 } }}
      >
        <AppSidebar
          pathname={pathname}
          onNavigate={(path) => {
            setMobileSidebarOpen(false);
            router.push(path);
          }}
        />
      </Drawer>
      <Modal
        title="Profile"
        open={profileOpen}
        onCancel={() => setProfileOpen(false)}
        onOk={() => {
          void saveProfile();
        }}
        okText="Save"
        confirmLoading={savingProfile}
        destroyOnClose
      >
        <Spin spinning={profileLoading}>
          <Form
            form={profileForm}
            layout="vertical"
            initialValues={{
              name: session.user.name,
              gitAuthorName: session.user.gitAuthorName ?? "",
              gitAuthorEmail: session.user.gitAuthorEmail ?? "",
              codexAuthJson: "",
              audience: session.user.agentResponsePreference.audience,
              explanationDepth: session.user.agentResponsePreference.explanationDepth,
              jargonLevel: session.user.agentResponsePreference.jargonLevel,
              codePreference: session.user.agentResponsePreference.codePreference,
              clarifyBehavior: session.user.agentResponsePreference.clarifyBehavior,
              formattingStyle: session.user.agentResponsePreference.formattingStyle,
              extraInstructions: session.user.agentResponsePreference.extraInstructions ?? ""
            }}
          >
            <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter your name" }]}>
              <Input />
            </Form.Item>
            <Divider orientation="left" plain>
              Git Commit Identity
            </Divider>
            <Form.Item
              name="gitAuthorName"
              label="Git Author Name"
              extra="Used for agent-created Git commits. Leave blank to use your profile name."
            >
              <Input placeholder={session.user.name} />
            </Form.Item>
            <Form.Item
              name="gitAuthorEmail"
              label="Git Author Email"
              rules={[{ type: "email", message: "Enter a valid email address" }]}
              extra="Used for agent-created Git commits. Leave blank to use your profile email."
            >
              <Input placeholder={session.user.email} />
            </Form.Item>
            <Divider orientation="left" plain>
              Response Format Preferences
            </Divider>
            <Card size="small">
              <ResponsePolicyFields />
            </Card>
            <Divider orientation="left" plain>
              Credentials
            </Divider>
            <Form.Item name="codexAuthJson" label="Codex auth.json">
              <Input.TextArea
                autoSize={{ minRows: 6, maxRows: 14 }}
                placeholder={profileCodexConfigured ? "Configured. Paste new JSON to replace." : "{\"...\": \"...\"}"}
              />
            </Form.Item>
            <Typography.Text type="secondary">
              Stored write-only and encrypted. Existing value is never returned.
            </Typography.Text>
            <div style={{ marginTop: 12 }}>
              <Button danger onClick={() => { void clearCodexAuthJson(); }} loading={savingProfile}>
                Clear Codex auth.json
              </Button>
            </div>
          </Form>
        </Spin>
      </Modal>
    </>
  );

  return <App>{shellContent}</App>;
}
