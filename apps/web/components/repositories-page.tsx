"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Repository } from "@verft/shared-types";
import {
  Button,
  Dropdown,
  Empty,
  Flex,
  Input,
  List,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
  message,
  theme as antTheme
} from "antd";
import { DeleteOutlined, EditOutlined, MoreOutlined } from "@ant-design/icons";
import { api } from "../src/api/client";
import { useRepositories } from "../src/hooks/useRepositories";
import { useAuth } from "./auth-provider";

export function RepositoriesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token } = antTheme.useToken();
  const { repositories, setRepositories, loading } = useRepositories();
  const [repositorySearch, setRepositorySearch] = useState("");
  const [branchFilter, setBranchFilter] = useState<string | undefined>();
  const [webhookFilter, setWebhookFilter] = useState<string | undefined>();
  const { can } = useAuth();
  const [messageApi, contextHolder] = message.useMessage();
  const canCreateRepository = can("repo:create");
  const canEditRepository = can("repo:edit");
  const canDeleteRepository = can("repo:delete");

  const branchOptions = useMemo(
    () =>
      Array.from(new Set(repositories.map((repository) => repository.defaultBranch).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b))
        .map((branch) => ({ label: branch, value: branch })),
    [repositories]
  );

  const filteredRepositories = useMemo(() => {
    const normalizedSearch = repositorySearch.trim().toLowerCase();

    return repositories.filter((repository) => {
      if (normalizedSearch) {
        const haystack = [repository.name, repository.url, repository.defaultBranch].join(" ").toLowerCase();
        if (!haystack.includes(normalizedSearch)) {
          return false;
        }
      }

      if (branchFilter && repository.defaultBranch !== branchFilter) {
        return false;
      }

      if (webhookFilter) {
        const webhookState =
          repository.webhookEnabled && repository.webhookUrl
            ? repository.webhookLastStatus === "failed"
              ? "failed"
              : "enabled"
            : "off";
        if (webhookState !== webhookFilter) {
          return false;
        }
      }

      return true;
    });
  }, [branchFilter, repositories, repositorySearch, webhookFilter]);

  const hasRepositoryFilters = Boolean(repositorySearch || branchFilter || webhookFilter);

  const clearRepositoryFilters = () => {
    setRepositorySearch("");
    setBranchFilter(undefined);
    setWebhookFilter(undefined);
  };

  useEffect(() => {
    const savedState = searchParams.get("saved");
    if (!savedState) {
      return;
    }
    if (savedState === "created") {
      messageApi.success("Repository created");
    } else if (savedState === "updated") {
      messageApi.success("Repository updated");
    }
    router.replace("/repositories");
  }, [messageApi, router, searchParams]);

  const deleteRepository = async (repository: Repository) => {
    try {
      await api.deleteRepository(repository.id);
      setRepositories((current) => current.filter((item) => item.id !== repository.id));
      messageApi.success("Repository deleted");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "Failed to delete repository");
    }
  };

  const confirmDeleteRepository = (repository: Repository) => {
    Modal.confirm({
      title: "Delete repository?",
      content: "Tasks keep their stored snapshot, but this repository will be removed from quick selection.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: () => deleteRepository(repository)
    });
  };

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Flex align="center" justify="space-between" gap={16} wrap="wrap">
          <Flex vertical gap={0}>
            <Typography.Title level={2} style={{ margin: 0 }}>
              Repositories
            </Typography.Title>
            <Typography.Text type="secondary">Manage reusable repository definitions for task creation.</Typography.Text>
          </Flex>
          {canCreateRepository ? (
            <Button type="primary" onClick={() => router.push("/repositories/new?from=list")}>
              Add Repository
            </Button>
          ) : null}
        </Flex>

        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Flex align="center" justify="space-between" gap={12} wrap="wrap">
            <Flex align="center" gap={12} wrap="wrap" style={{ flex: "1 1 620px", minWidth: 0 }}>
              <Input
                allowClear
                placeholder="Filter by name, URL, or branch"
                value={repositorySearch}
                onChange={(event) => setRepositorySearch(event.target.value)}
                style={{ flex: "1 1 360px", minWidth: 260 }}
              />
              <Select
                allowClear
                showSearch
                placeholder="Default branch"
                value={branchFilter}
                options={branchOptions}
                onChange={(value) => setBranchFilter(value)}
                style={{ flex: "0 1 220px", minWidth: 180 }}
              />
              <Select
                allowClear
                placeholder="Webhook"
                value={webhookFilter}
                options={[
                  { label: "Webhook enabled", value: "enabled" },
                  { label: "Webhook failed", value: "failed" },
                  { label: "Webhook off", value: "off" }
                ]}
                onChange={(value) => setWebhookFilter(value)}
                style={{ flex: "0 1 200px", minWidth: 160 }}
              />
            </Flex>
            <Space>
              <Typography.Text type="secondary">
                {`${filteredRepositories.length} ${filteredRepositories.length === 1 ? "repository" : "repositories"}`}
              </Typography.Text>
              <Button disabled={!hasRepositoryFilters} onClick={clearRepositoryFilters}>
                Clear
              </Button>
            </Space>
          </Flex>

          <List<Repository>
            loading={loading}
            dataSource={filteredRepositories}
            split={false}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            locale={{
              emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No repositories to show" />
            }}
            renderItem={(repository) => {
              const envVarCount = repository.envVars?.length ?? 0;
              const secretCount = repository.envSecrets?.length ?? 0;
              const webhookLabel =
                repository.webhookEnabled && repository.webhookUrl
                  ? repository.webhookLastStatus === "failed"
                    ? "Webhook failed"
                    : repository.webhookLastStatus === "success"
                      ? "Webhook active"
                      : "Webhook enabled"
                  : "Webhook off";
              const webhookColor =
                repository.webhookEnabled && repository.webhookUrl
                  ? repository.webhookLastStatus === "failed"
                    ? "error"
                    : "success"
                  : "default";

              return (
                <List.Item style={{ padding: 0, borderBlockEnd: 0, marginBottom: 10 }}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => canEditRepository && router.push(`/repositories/${repository.id}/edit?from=list`)}
                    onKeyDown={(event) => {
                      if (!canEditRepository) {
                        return;
                      }
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        router.push(`/repositories/${repository.id}/edit?from=list`);
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
                      cursor: canEditRepository ? "pointer" : "default"
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
                        background: repository.webhookLastStatus === "failed" ? token.colorError : token.colorBorderSecondary
                      }}
                    />
                    <Flex align="center" justify="space-between" gap={16} wrap="wrap">
                      <Flex vertical gap={0} style={{ minWidth: 260, flex: "1 1 420px" }}>
                        <Space size={8} wrap>
                          <Typography.Text strong>{repository.name}</Typography.Text>
                          <Typography.Text type="secondary">{repository.url}</Typography.Text>
                          <Typography.Text type="secondary">/</Typography.Text>
                          <Typography.Text code style={{ fontSize: 12 }}>
                            {repository.defaultBranch}
                          </Typography.Text>
                        </Space>
                      </Flex>
                      <Flex align="center" justify="flex-end" gap={12} wrap="wrap" style={{ flex: "0 1 auto" }}>
                        <Tag>{`${envVarCount} env`}</Tag>
                        <Tag>{`${secretCount} secrets`}</Tag>
                        <Tag color={webhookColor}>{webhookLabel}</Tag>
                        <Dropdown
                          trigger={["click"]}
                          menu={{
                            items: [
                              canEditRepository
                                ? {
                                    key: "edit",
                                    label: "Edit",
                                    icon: <EditOutlined />
                                  }
                                : null,
                              canDeleteRepository
                                ? {
                                    key: "delete",
                                    label: "Delete",
                                    icon: <DeleteOutlined />,
                                    danger: true
                                  }
                                : null
                            ].filter((item): item is NonNullable<typeof item> => Boolean(item)),
                            onClick: ({ domEvent, key }) => {
                              domEvent.stopPropagation();
                              if (key === "edit") {
                                router.push(`/repositories/${repository.id}/edit?from=list`);
                              }
                              if (key === "delete") {
                                confirmDeleteRepository(repository);
                              }
                            }
                          }}
                        >
                          <Button
                            type="text"
                            icon={<MoreOutlined />}
                            aria-label={`Repository actions for ${repository.name}`}
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
    </>
  );
}
