"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AgentProvider,
  ProviderProfile,
  Repository,
  Role,
  Team,
  User
} from "@verft/shared-types";
import { getAgentProviderLabel, getEffortOptionsForProvider, getModelsForProvider } from "@verft/shared-types";
import {
  App,
  Button,
  Card,
  Divider,
  Dropdown,
  Empty,
  Flex,
  Form,
  Input,
  List,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  theme as antTheme
} from "antd";
import { DeleteOutlined, EditOutlined, MoreOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { api } from "../src/api/client";
import { useAuth } from "./auth-provider";
import { ModelSelect } from "./model-select";

interface UserFormValues {
  name: string;
  email: string;
  password?: string;
  githubUsername?: string;
  defaultProvider?: AgentProvider;
  defaultModel?: string;
  defaultProviderProfile?: ProviderProfile;
  active: boolean;
  roleIds: string[];
  teamId?: string;
  repositoryIds: string[];
}

const SYSTEM_ADMIN_ROLE_ID = "admin";
const providerOptions: Array<{ label: string; value: AgentProvider }> = [
  { label: getAgentProviderLabel("codex"), value: "codex" },
  { label: getAgentProviderLabel("claude"), value: "claude" }
];

export function UsersPage() {
  const { message } = App.useApp();
  const { can, session } = useAuth();
  const { token } = antTheme.useToken();
  const [form] = Form.useForm<UserFormValues>();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [roleFilter, setRoleFilter] = useState<string | undefined>();
  const selectedDefaultProvider = (Form.useWatch("defaultProvider", form) as AgentProvider | undefined) ?? "codex";
  const defaultModelOptions = useMemo(() => getModelsForProvider(selectedDefaultProvider), [selectedDefaultProvider]);
  const defaultEffortOptions = useMemo(
    () => getEffortOptionsForProvider(selectedDefaultProvider),
    [selectedDefaultProvider]
  );

  const canCreateUsers = can("user:create");
  const canEditUsers = can("user:edit");
  const canDeleteUsers = can("user:delete");
  const canReadRoles = can("settings:read");
  const canEditRoles = can("settings:edit");
  const canReadRepositories = can("repo:list");

  const loadUsers = async () => {
    setLoading(true);
    try {
      const [nextUsers, nextRoles, nextTeams, nextRepositories] = await Promise.all([
        api.listUsers(),
        canReadRoles ? api.listRoles().catch(() => []) : Promise.resolve([]),
        api.listTeams().catch(() => []),
        canEditRoles && canReadRepositories ? api.listRepositories().catch(() => []) : Promise.resolve([])
      ]);
      setUsers(nextUsers);
      setRoles(nextRoles);
      setTeams(nextTeams);
      setRepositories(nextRepositories);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [canEditRoles, canReadRepositories, canReadRoles]);

  const openCreateModal = () => {
    setEditingUser(null);
    form.setFieldsValue({
      name: "",
      email: "",
      password: "",
      active: true,
      roleIds: [],
      teamId: undefined,
      repositoryIds: []
    });
    setModalOpen(true);
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    form.setFieldsValue({
      name: user.name,
      email: user.email,
      password: "",
      githubUsername: user.githubUsername ?? "",
      defaultProvider: user.defaultProvider ?? undefined,
      defaultModel: user.defaultModel ?? undefined,
      defaultProviderProfile: user.defaultProviderProfile ?? undefined,
      active: user.active,
      roleIds: user.roles.map((role) => role.id),
      teamId: user.teamId ?? undefined,
      repositoryIds: user.repositoryIds ?? []
    });
    setModalOpen(true);
  };

  const currentUserId = session?.user.id ?? null;
  const selectedRoleIds = Form.useWatch("roleIds", form) ?? [];
  const adminRoleSelected = selectedRoleIds.includes(SYSTEM_ADMIN_ROLE_ID);
  const roleNameById = useMemo(() => new Map(roles.map((role) => [role.id, role.name])), [roles]);
  const teamNameById = useMemo(() => new Map(teams.map((team) => [team.id, team.name])), [teams]);
  const roleFilterOptions = useMemo(
    () => roles.map((role) => ({ label: role.name, value: role.id })).sort((a, b) => a.label.localeCompare(b.label)),
    [roles]
  );
  const filteredUsers = useMemo(() => {
    const normalizedSearch = userSearch.trim().toLowerCase();

    return users.filter((user) => {
      if (normalizedSearch) {
        const haystack = [user.name, user.email, user.githubUsername ?? ""].join(" ").toLowerCase();
        if (!haystack.includes(normalizedSearch)) {
          return false;
        }
      }

      if (statusFilter === "active" && !user.active) {
        return false;
      }

      if (statusFilter === "disabled" && user.active) {
        return false;
      }

      if (roleFilter && !user.roles.some((role) => role.id === roleFilter)) {
        return false;
      }

      return true;
    });
  }, [roleFilter, statusFilter, userSearch, users]);

  const hasUserFilters = Boolean(userSearch || statusFilter || roleFilter);

  const clearUserFilters = () => {
    setUserSearch("");
    setStatusFilter(undefined);
    setRoleFilter(undefined);
  };

  return (
    <>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Flex align="center" justify="space-between" gap={16} wrap="wrap">
          <Flex vertical gap={0}>
            <Typography.Title level={2} style={{ margin: 0 }}>
              Users
            </Typography.Title>
            <Typography.Text type="secondary">
              Manage application access, activation state, and role assignments.
            </Typography.Text>
          </Flex>
          {canCreateUsers ? (
            <Button type="primary" onClick={openCreateModal}>
              Add User
            </Button>
          ) : null}
        </Flex>

        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Flex align="center" justify="space-between" gap={12} wrap="wrap">
            <Flex align="center" gap={12} wrap="wrap" style={{ flex: "1 1 620px", minWidth: 0 }}>
              <Input
                allowClear
                placeholder="Filter by name, email, or GitHub"
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                style={{ flex: "1 1 360px", minWidth: 260 }}
              />
              <Select
                allowClear
                placeholder="Status"
                value={statusFilter}
                options={[
                  { label: "Active", value: "active" },
                  { label: "Disabled", value: "disabled" }
                ]}
                onChange={(value) => setStatusFilter(value)}
                style={{ flex: "0 1 180px", minWidth: 150 }}
              />
              <Select
                allowClear
                showSearch
                placeholder="Role"
                value={roleFilter}
                options={roleFilterOptions}
                onChange={(value) => setRoleFilter(value)}
                style={{ flex: "0 1 220px", minWidth: 180 }}
              />
            </Flex>
            <Space>
              <Typography.Text type="secondary">
                {`${filteredUsers.length} ${filteredUsers.length === 1 ? "user" : "users"}`}
              </Typography.Text>
              <Button disabled={!hasUserFilters} onClick={clearUserFilters}>
                Clear
              </Button>
            </Space>
          </Flex>

          <List<User>
            loading={loading}
            dataSource={filteredUsers}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            split={false}
            locale={{
              emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No users to show" />
            }}
            renderItem={(user) => {
              const isSelf = user.id === currentUserId;
              const lastLoginLabel = user.lastLoginAt ? dayjs(user.lastLoginAt).format("YYYY-MM-DD HH:mm") : "Never";

              return (
                <List.Item style={{ padding: 0, borderBlockEnd: 0, marginBottom: 10 }}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => canEditUsers && openEditModal(user)}
                    onKeyDown={(event) => {
                      if (!canEditUsers) {
                        return;
                      }
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openEditModal(user);
                      }
                    }}
                    style={{
                      position: "relative",
                      width: "100%",
                      padding: "14px 18px 14px 26px",
                      border: `1px solid ${token.colorBorderSecondary}`,
                      borderRadius: token.borderRadiusLG,
                      background: token.colorBgContainer,
                      boxShadow: token.boxShadowTertiary,
                      cursor: canEditUsers ? "pointer" : "default"
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        insetBlock: 10,
                        insetInlineStart: 10,
                        width: 3,
                        borderRadius: 999,
                        background: user.active ? "#1C8057" : token.colorBorderSecondary
                      }}
                    />
                    <Flex align="center" justify="space-between" gap={16} wrap="wrap">
                      <Flex vertical gap={0} style={{ minWidth: 260, flex: "1 1 420px" }}>
                        <Space size={8} wrap>
                          <Typography.Text strong>{user.name}</Typography.Text>
                          <Typography.Text type="secondary">{user.email}</Typography.Text>
                          {user.githubUsername ? (
                            <Typography.Text code style={{ fontSize: 12 }}>
                              {user.githubUsername}
                            </Typography.Text>
                          ) : null}
                        </Space>
                      </Flex>
                      <Flex align="center" justify="flex-end" gap={12} wrap="wrap" style={{ flex: "0 1 auto" }}>
                        <Tag color={user.active ? "green" : "default"}>{user.active ? "Active" : "Disabled"}</Tag>
                        {user.roles.length > 0 ? (
                          <Space size={[4, 4]} wrap>
                            {user.roles.map((role) => (
                              <Tag key={role.id}>{roleNameById.get(role.id) ?? role.name}</Tag>
                            ))}
                          </Space>
                        ) : (
                          <Typography.Text type="secondary">No roles</Typography.Text>
                        )}
                        {user.teamId ? <Tag color="blue">{teamNameById.get(user.teamId) ?? user.teamId}</Tag> : null}
                        <Typography.Text type="secondary" style={{ whiteSpace: "nowrap" }}>
                          {lastLoginLabel}
                        </Typography.Text>
                        <Dropdown
                          trigger={["click"]}
                          menu={{
                            items: [
                              canEditUsers
                                ? {
                                    key: "edit",
                                    label: "Edit",
                                    icon: <EditOutlined />
                                  }
                                : null,
                              canDeleteUsers
                                ? {
                                    key: "delete",
                                    label: isSelf ? "Cannot delete yourself" : "Delete",
                                    icon: <DeleteOutlined />,
                                    danger: !isSelf,
                                    disabled: isSelf
                                  }
                                : null
                            ].filter((item): item is NonNullable<typeof item> => Boolean(item)),
                            onClick: ({ domEvent, key }) => {
                              domEvent.stopPropagation();
                              if (key === "edit") {
                                openEditModal(user);
                              }
                              if (key === "delete" && !isSelf) {
                                Modal.confirm({
                                  title: "Delete user?",
                                  content: `Delete ${user.email}?`,
                                  okText: "Delete",
                                  okButtonProps: { danger: true },
                                  onOk: async () => {
                                    try {
                                      await api.deleteUser(user.id);
                                      message.success("User deleted");
                                      await loadUsers();
                                    } catch (error) {
                                      message.error(error instanceof Error ? error.message : "Failed to delete user");
                                    }
                                  }
                                });
                              }
                            }
                          }}
                        >
                          <Button
                            type="text"
                            icon={<MoreOutlined />}
                            aria-label={`User actions for ${user.email}`}
                            onClick={(event) => event.stopPropagation()}
                          />
                        </Dropdown>
                      </Flex>
                    </Flex>
                  </div>
                </List.Item>
              );
            }}
          />
        </Space>
      </Space>

      <Modal
        open={modalOpen}
        title={editingUser ? "Edit User" : "Add User"}
        footer={null}
        onCancel={() => setModalOpen(false)}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            setSubmitting(true);
            try {
              if (editingUser) {
                await api.updateUser(editingUser.id, {
                  name: values.name,
                  email: values.email,
                  password: values.password?.trim() || undefined,
                  githubUsername: values.githubUsername?.trim() || null,
                  defaultProvider: values.defaultProvider ?? null,
                  defaultModel: values.defaultModel?.trim() || null,
                  defaultProviderProfile: values.defaultProviderProfile ?? null,
                  active: values.active,
                  roleIds: canEditRoles ? values.roleIds : undefined,
                  teamId: canEditRoles ? values.teamId ?? null : undefined,
                  repositoryIds: canEditRoles ? values.repositoryIds : undefined
                });
                message.success("User updated");
              } else {
                await api.createUser({
                  name: values.name,
                  email: values.email,
                  password: values.password?.trim() || "",
                  active: values.active,
                  roleIds: canEditRoles ? values.roleIds : undefined,
                  teamId: canEditRoles ? values.teamId ?? null : undefined,
                  repositoryIds: canEditRoles ? values.repositoryIds : undefined
                });
                message.success("User created");
              }

              setModalOpen(false);
              await loadUsers();
            } catch (error) {
              message.error(error instanceof Error ? error.message : "Failed to save user");
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter a user name" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, message: "Enter an email address" }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="password"
            label={editingUser ? "Password" : "Password"}
            rules={editingUser ? [] : [{ required: true, message: "Enter a password" }]}
            extra={editingUser ? "Leave blank to keep the current password." : undefined}
          >
            <Input.Password />
          </Form.Item>
          {editingUser ? (
            <Form.Item
              name="githubUsername"
              label="GitHub Username"
              extra="Used to associate this user with GitHub activity."
            >
              <Input maxLength={80} />
            </Form.Item>
          ) : null}
          {editingUser ? (
            <>
              <Divider orientation="left" plain>
                Default Agent
              </Divider>
              <Card size="small">
                <Form.Item name="defaultProvider" label="Provider">
                  <Select
                    allowClear
                    placeholder="Repository or system default"
                    options={providerOptions}
                    onChange={(value: AgentProvider | undefined) => {
                      const nextEfforts = getEffortOptionsForProvider(value ?? "codex");
                      if (!nextEfforts.some((option) => option.value === form.getFieldValue("defaultProviderProfile"))) {
                        form.setFieldValue("defaultProviderProfile", undefined);
                      }
                    }}
                  />
                </Form.Item>
                <Form.Item name="defaultModel" label="Model">
                  <ModelSelect options={defaultModelOptions} placeholder="Repository or system default" />
                </Form.Item>
                <Form.Item name="defaultProviderProfile" label="Effort">
                  <Select allowClear options={defaultEffortOptions} placeholder="Repository or system default" />
                </Form.Item>
              </Card>
            </>
          ) : null}
          <Form.Item
            name="active"
            label="Active"
            valuePropName="checked"
            extra={editingUser?.id === currentUserId ? "Your own account cannot be disabled." : undefined}
          >
            <Switch disabled={editingUser?.id === currentUserId} />
          </Form.Item>
          {canEditRoles ? (
            <Form.Item name="roleIds" label="Roles">
              <Select
                mode="multiple"
                options={roles.map((role) => ({
                  label: role.name,
                  value: role.id
                }))}
              />
            </Form.Item>
          ) : null}
          {canEditRoles ? (
            <Form.Item name="teamId" label="Team">
              <Select
                allowClear
                placeholder="No team"
                options={teams.map((team) => ({ label: team.name, value: team.id }))}
              />
            </Form.Item>
          ) : null}
          {canEditRoles ? (
            <Form.Item
              name="repositoryIds"
              label="Repositories"
              extra={adminRoleSelected ? "All repositories (via Admin role)." : "Choose repositories this user can access."}
            >
              <Select
                mode="multiple"
                disabled={adminRoleSelected}
                placeholder={adminRoleSelected ? "All repositories (via Admin role)" : "Select repositories"}
                options={repositories.map((repository) => ({
                  label: repository.name,
                  value: repository.id
                }))}
              />
            </Form.Item>
          ) : null}
          <Button type="primary" htmlType="submit" loading={submitting} block>
            {editingUser ? "Save Changes" : "Create User"}
          </Button>
        </Form>
      </Modal>
    </>
  );
}
