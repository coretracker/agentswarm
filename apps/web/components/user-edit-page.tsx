"use client";

import { useEffect, useState } from "react";
import type { Repository, Role, User } from "@verft/shared-types";
import { App, Button, Card, Flex, Form, Input, Result, Select, Space, Spin, Switch, Typography } from "antd";
import { useRouter } from "next/navigation";
import { api } from "../src/api/client";
import { useAuth } from "./auth-provider";
import { UserProfileFields, type UserProfileFormValues } from "./user-profile-fields";

interface UserEditFormValues extends UserProfileFormValues {
  email: string;
  password?: string;
  active: boolean;
  roleIds: string[];
  repositoryIds: string[];
}

const SYSTEM_ADMIN_ROLE_ID = "admin";

export function UserEditPage({ userId }: { userId: string }) {
  const { message } = App.useApp();
  const router = useRouter();
  const { can, session, setSessionUser } = useAuth();
  const [form] = Form.useForm<UserEditFormValues>();
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const canEditRoles = can("settings:edit");
  const canReadRoles = can("settings:read");
  const canReadRepositories = can("repo:list");
  const currentUserId = session?.user.id ?? null;
  const selectedRoleIds = Form.useWatch("roleIds", form) ?? [];
  const adminRoleSelected = selectedRoleIds.includes(SYSTEM_ADMIN_ROLE_ID);

  useEffect(() => {
    setLoading(true);
    void Promise.all([
      api.getUser(userId),
      canReadRoles ? api.listRoles().catch(() => []) : Promise.resolve([]),
      canEditRoles && canReadRepositories ? api.listRepositories().catch(() => []) : Promise.resolve([])
    ])
      .then(([nextUser, nextRoles, nextRepositories]) => {
        setUser(nextUser);
        setRoles(nextRoles);
        setRepositories(nextRepositories);
        form.setFieldsValue({
          name: nextUser.name,
          email: nextUser.email,
          password: "",
          githubUsername: nextUser.githubUsername ?? "",
          defaultProvider: nextUser.defaultProvider ?? undefined,
          defaultModel: nextUser.defaultModel ?? undefined,
          defaultProviderProfile: nextUser.defaultProviderProfile ?? undefined,
          active: nextUser.active,
          roleIds: nextUser.roles.map((role) => role.id),
          repositoryIds: nextUser.repositoryIds ?? []
        });
      })
      .catch((error) => {
        message.error(error instanceof Error ? error.message : "Failed to load user");
      })
      .finally(() => setLoading(false));
  }, [canEditRoles, canReadRepositories, canReadRoles, form, message, userId]);

  const saveUser = async (): Promise<void> => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const nextUser = await api.updateUser(userId, {
        name: values.name,
        email: values.email,
        password: values.password?.trim() || undefined,
        githubUsername: values.githubUsername?.trim() || null,
        defaultProvider: values.defaultProvider ?? null,
        defaultModel: values.defaultModel?.trim() || null,
        defaultProviderProfile: values.defaultProviderProfile ?? null,
        active: values.active,
        roleIds: canEditRoles ? values.roleIds : undefined,
        repositoryIds: canEditRoles ? values.repositoryIds : undefined
      });
      setUser(nextUser);
      if (nextUser.id === currentUserId) {
        setSessionUser({
          name: nextUser.name,
          email: nextUser.email,
          githubUsername: nextUser.githubUsername,
          defaultProvider: nextUser.defaultProvider,
          defaultModel: nextUser.defaultModel,
          defaultProviderProfile: nextUser.defaultProviderProfile,
          active: nextUser.active,
          roles: nextUser.roles,
          repositoryIds: nextUser.repositoryIds
        });
      }
      message.success("User updated");
      router.push("/users");
    } catch (error) {
      if (error && typeof error === "object" && "errorFields" in error) {
        return;
      }
      message.error(error instanceof Error ? error.message : "Failed to save user");
    } finally {
      setSaving(false);
    }
  };

  if (!loading && !user) {
    return <Result status="404" title="User not found" extra={<Button onClick={() => router.push("/users")}>Back To Users</Button>} />;
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Flex align="center" justify="space-between" gap={16} wrap="wrap">
        <Flex vertical gap={0}>
          <Typography.Title level={2} style={{ margin: 0 }}>
            Edit User
          </Typography.Title>
          <Typography.Text type="secondary">{user?.email ?? "Loading user"}</Typography.Text>
        </Flex>
        <Button onClick={() => router.push("/users")}>Back To Users</Button>
      </Flex>
      <Spin spinning={loading}>
        <Form form={form} layout="vertical">
          <Card bordered={false} title="Profile">
            <Form.Item
              name="email"
              label="Email"
              rules={[
                { required: true, message: "Enter an email address" },
                { type: "email", message: "Enter a valid email address" }
              ]}
            >
              <Input />
            </Form.Item>
            <Form.Item name="password" label="Password" extra="Leave blank to keep the current password.">
              <Input.Password />
            </Form.Item>
            <UserProfileFields form={form} />
          </Card>
          <Card bordered={false} title="Access" style={{ marginTop: 16 }}>
            <Form.Item
              name="active"
              label="Active"
              valuePropName="checked"
              extra={user?.id === currentUserId ? "Your own account cannot be disabled." : undefined}
            >
              <Switch disabled={user?.id === currentUserId} />
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
          </Card>
        </Form>
      </Spin>
      <Card size="small" style={{ position: "sticky", bottom: 16, zIndex: 20 }} styles={{ body: { padding: 12 } }}>
        <Flex justify="flex-end" gap={8}>
          <Button onClick={() => router.push("/users")}>Cancel</Button>
          <Button type="primary" loading={saving} onClick={() => { void saveUser(); }}>
            Save User
          </Button>
        </Flex>
      </Card>
    </Space>
  );
}
