"use client";

import { useEffect, useState } from "react";
import type {
  AgentClarifyBehavior,
  AgentCodePreference,
  AgentExplanationDepth,
  AgentFormattingStyle,
  AgentJargonLevel,
  AudienceType,
  Repository,
  ResponsePreferencePreset,
  Role,
  User
} from "@agentswarm/shared-types";
import {
  App,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography
} from "antd";
import dayjs from "dayjs";
import { api } from "../src/api/client";
import { useAuth } from "./auth-provider";

interface UserFormValues {
  name: string;
  email: string;
  password?: string;
  active: boolean;
  audience?: AudienceType;
  explanationDepth?: AgentExplanationDepth;
  jargonLevel?: AgentJargonLevel;
  codePreference?: AgentCodePreference;
  clarifyBehavior?: AgentClarifyBehavior;
  formattingStyle?: AgentFormattingStyle;
  extraInstructions?: string;
  responsePreferencePresetId?: string;
  roleIds: string[];
  repositoryIds: string[];
}

const SYSTEM_ADMIN_ROLE_ID = "admin";

export function UsersPage() {
  const { message } = App.useApp();
  const { can, session } = useAuth();
  const [form] = Form.useForm<UserFormValues>();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [responsePreferencePresets, setResponsePreferencePresets] = useState<ResponsePreferencePreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const canCreateUsers = can("user:create");
  const canEditUsers = can("user:edit");
  const canDeleteUsers = can("user:delete");
  const canReadRoles = can("settings:read");
  const canReadSettings = can("settings:read");
  const canEditRoles = can("settings:edit");
  const canReadRepositories = can("repo:list");
  const formatLabel = (value: string): string => value.replace(/_/g, " ");

  const loadUsers = async () => {
    setLoading(true);
    try {
      const [nextUsers, nextRoles, nextRepositories, nextSettings] = await Promise.all([
        api.listUsers(),
        canReadRoles ? api.listRoles().catch(() => []) : Promise.resolve([]),
        canEditRoles && canReadRepositories ? api.listRepositories().catch(() => []) : Promise.resolve([]),
        canReadSettings ? api.getSettings().catch(() => null) : Promise.resolve(null)
      ]);
      setUsers(nextUsers);
      setRoles(nextRoles);
      setRepositories(nextRepositories);
      setResponsePreferencePresets(nextSettings?.responsePreferencePresets ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [canEditRoles, canReadRepositories, canReadRoles, canReadSettings]);

  const openCreateModal = () => {
    setEditingUser(null);
    form.setFieldsValue({
      name: "",
      email: "",
      password: "",
      active: true,
      audience: undefined,
      explanationDepth: undefined,
      jargonLevel: undefined,
      codePreference: undefined,
      clarifyBehavior: undefined,
      formattingStyle: undefined,
      extraInstructions: "",
      responsePreferencePresetId: undefined,
      roleIds: [],
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
      active: user.active,
      audience: user.agentResponsePreference.audience,
      explanationDepth: user.agentResponsePreference.explanationDepth,
      jargonLevel: user.agentResponsePreference.jargonLevel,
      codePreference: user.agentResponsePreference.codePreference,
      clarifyBehavior: user.agentResponsePreference.clarifyBehavior,
      formattingStyle: user.agentResponsePreference.formattingStyle,
      extraInstructions: user.agentResponsePreference.extraInstructions ?? "",
      responsePreferencePresetId:
        responsePreferencePresets.find(
          (preset) =>
            preset.preference.audience === user.agentResponsePreference.audience &&
            preset.preference.explanationDepth === user.agentResponsePreference.explanationDepth &&
            preset.preference.jargonLevel === user.agentResponsePreference.jargonLevel &&
            preset.preference.codePreference === user.agentResponsePreference.codePreference &&
            preset.preference.clarifyBehavior === user.agentResponsePreference.clarifyBehavior &&
            preset.preference.formattingStyle === user.agentResponsePreference.formattingStyle &&
            (preset.preference.extraInstructions ?? "") === (user.agentResponsePreference.extraInstructions ?? "")
        )?.id,
      roleIds: user.roles.map((role) => role.id),
      repositoryIds: user.repositoryIds ?? []
    });
    setModalOpen(true);
  };

  const currentUserId = session?.user.id ?? null;
  const selectedRoleIds = Form.useWatch("roleIds", form) ?? [];
  const adminRoleSelected = selectedRoleIds.includes(SYSTEM_ADMIN_ROLE_ID);

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

        <Card bordered={false}>
          <Table<User>
            rowKey="id"
            loading={loading}
            dataSource={users}
            pagination={{ pageSize: 10 }}
            columns={[
              { title: "Name", dataIndex: "name" },
              { title: "Email", dataIndex: "email" },
              {
                title: "Status",
                dataIndex: "active",
                render: (active: boolean) => <Tag color={active ? "green" : "default"}>{active ? "Active" : "Disabled"}</Tag>
              },
              {
                title: "Roles",
                render: (_, user) => {
                  const roleNameById = new Map(roles.map((role) => [role.id, role.name]));
                  if (user.roles.length === 0) {
                    return <Typography.Text type="secondary">No roles</Typography.Text>;
                  }

                  return (
                    <Space size={[4, 4]} wrap>
                      {user.roles.map((role) => (
                        <Tag key={role.id}>{roleNameById.get(role.id) ?? role.name}</Tag>
                      ))}
                    </Space>
                  );
                }
              },
              {
                title: "Response Style",
                render: (_, user) => {
                  if (!user.agentResponsePreference.audience) {
                    return <Typography.Text type="secondary">Neutral</Typography.Text>;
                  }

                  return <Tag>{formatLabel(user.agentResponsePreference.audience)}</Tag>;
                }
              },
              {
                title: "Last Login",
                dataIndex: "lastLoginAt",
                render: (value: string | null) =>
                  value ? dayjs(value).format("YYYY-MM-DD HH:mm") : <Typography.Text type="secondary">Never</Typography.Text>
              },
              {
                title: "Actions",
                render: (_, user) => {
                  const isSelf = user.id === currentUserId;
                  return (
                    <Space>
                      {canEditUsers ? (
                        <Button onClick={() => openEditModal(user)}>Edit</Button>
                      ) : null}
                      {canDeleteUsers ? (
                        <Tooltip title={isSelf ? "You cannot delete your own account" : undefined}>
                          <Popconfirm
                            title="Delete user?"
                            description={`Delete ${user.email}?`}
                            disabled={isSelf}
                            onConfirm={async () => {
                              try {
                                await api.deleteUser(user.id);
                                message.success("User deleted");
                                await loadUsers();
                              } catch (error) {
                                message.error(error instanceof Error ? error.message : "Failed to delete user");
                              }
                            }}
                          >
                            <Button danger disabled={isSelf}>
                              Delete
                            </Button>
                          </Popconfirm>
                        </Tooltip>
                      ) : null}
                    </Space>
                  );
                }
              }
            ]}
          />
        </Card>
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
                  active: values.active,
                  agentResponsePreference: {
                    audience: values.audience,
                    explanationDepth: values.explanationDepth,
                    jargonLevel: values.jargonLevel,
                    codePreference: values.codePreference,
                    clarifyBehavior: values.clarifyBehavior,
                    formattingStyle: values.formattingStyle,
                    extraInstructions: values.extraInstructions?.trim() || undefined
                  },
                  roleIds: canEditRoles ? values.roleIds : undefined,
                  repositoryIds: canEditRoles ? values.repositoryIds : undefined
                });
                message.success("User updated");
              } else {
                await api.createUser({
                  name: values.name,
                  email: values.email,
                  password: values.password?.trim() || "",
                  active: values.active,
                  agentResponsePreference: {
                    audience: values.audience,
                    explanationDepth: values.explanationDepth,
                    jargonLevel: values.jargonLevel,
                    codePreference: values.codePreference,
                    clarifyBehavior: values.clarifyBehavior,
                    formattingStyle: values.formattingStyle,
                    extraInstructions: values.extraInstructions?.trim() || undefined
                  },
                  roleIds: canEditRoles ? values.roleIds : undefined,
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
          <Form.Item
            name="active"
            label="Active"
            valuePropName="checked"
            extra={editingUser?.id === currentUserId ? "Your own account cannot be disabled." : undefined}
          >
            <Switch disabled={editingUser?.id === currentUserId} />
          </Form.Item>
          <Form.Item
            name="responsePreferencePresetId"
            label="Response Preference Preset"
            extra="Optional shortcut for applying a saved response preference."
          >
            <Select
              allowClear
              placeholder="Select a preset"
              options={responsePreferencePresets.map((preset) => ({
                label: preset.name,
                value: preset.id
              }))}
              onChange={(value) => {
                const preset = responsePreferencePresets.find((entry) => entry.id === value);
                if (!preset) {
                  return;
                }
                form.setFieldsValue({
                  audience: preset.preference.audience,
                  explanationDepth: preset.preference.explanationDepth,
                  jargonLevel: preset.preference.jargonLevel,
                  codePreference: preset.preference.codePreference,
                  clarifyBehavior: preset.preference.clarifyBehavior,
                  formattingStyle: preset.preference.formattingStyle,
                  extraInstructions: preset.preference.extraInstructions ?? ""
                });
              }}
            />
          </Form.Item>
          <Form.Item name="audience" label="Audience">
            <Select
              allowClear
              placeholder="Neutral"
              options={[
                { label: "Technical", value: "technical" },
                { label: "Non-technical", value: "non_technical" },
                { label: "Mixed", value: "mixed" }
              ]}
              onChange={() => form.setFieldValue("responsePreferencePresetId", undefined)}
            />
          </Form.Item>
          <Form.Item name="explanationDepth" label="Explanation Depth">
            <Select
              allowClear
              placeholder="Default"
              options={[
                { label: "Brief", value: "brief" },
                { label: "Standard", value: "standard" },
                { label: "Detailed", value: "detailed" }
              ]}
              onChange={() => form.setFieldValue("responsePreferencePresetId", undefined)}
            />
          </Form.Item>
          <Form.Item name="jargonLevel" label="Jargon Level">
            <Select
              allowClear
              placeholder="Default"
              options={[
                { label: "Avoid", value: "avoid" },
                { label: "Balanced", value: "balanced" },
                { label: "Expert", value: "expert" }
              ]}
              onChange={() => form.setFieldValue("responsePreferencePresetId", undefined)}
            />
          </Form.Item>
          <Form.Item name="codePreference" label="Code Preference">
            <Select
              allowClear
              placeholder="Default"
              options={[
                { label: "Only When Needed", value: "only_when_needed" },
                { label: "Prefer Examples", value: "prefer_examples" },
                { label: "Avoid Code", value: "avoid_code" }
              ]}
              onChange={() => form.setFieldValue("responsePreferencePresetId", undefined)}
            />
          </Form.Item>
          <Form.Item name="clarifyBehavior" label="Clarify Behavior">
            <Select
              allowClear
              placeholder="Default"
              options={[
                { label: "Ask When Ambiguous", value: "ask_when_ambiguous" },
                { label: "Make Reasonable Assumptions", value: "make_reasonable_assumptions" }
              ]}
              onChange={() => form.setFieldValue("responsePreferencePresetId", undefined)}
            />
          </Form.Item>
          <Form.Item name="formattingStyle" label="Formatting Style">
            <Select
              allowClear
              placeholder="Default"
              options={[
                { label: "Direct", value: "direct" },
                { label: "Teaching", value: "teaching" },
                { label: "Executive", value: "executive" }
              ]}
              onChange={() => form.setFieldValue("responsePreferencePresetId", undefined)}
            />
          </Form.Item>
          <Form.Item name="extraInstructions" label="Extra Instructions">
            <Input.TextArea
              rows={3}
              maxLength={2000}
              placeholder="Optional additional response instructions."
              onChange={() => form.setFieldValue("responsePreferencePresetId", undefined)}
            />
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
