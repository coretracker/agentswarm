"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Repository } from "@verft/shared-types";
import { Button, Card, Flex, Popconfirm, Space, Table, Typography, message } from "antd";
import { api } from "../src/api/client";
import { useRepositories } from "../src/hooks/useRepositories";
import { useAuth } from "./auth-provider";

export function RepositoriesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { repositories, loading } = useRepositories();
  const { can } = useAuth();
  const [messageApi, contextHolder] = message.useMessage();
  const canCreateRepository = can("repo:create");
  const canEditRepository = can("repo:edit");
  const canDeleteRepository = can("repo:delete");

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

        <Card bordered={false}>
          <Table<Repository>
            rowKey="id"
            loading={loading}
            dataSource={repositories}
            columns={[
              { title: "Name", dataIndex: "name" },
              { title: "URL", dataIndex: "url" },
              { title: "Default Branch", dataIndex: "defaultBranch" },
              {
                title: "Env Vars",
                render: (_, repository) => <Typography.Text>{(repository.envVars ?? []).length}</Typography.Text>
              },
              {
                title: "Secrets",
                render: (_, repository) => <Typography.Text>{(repository.envSecrets ?? []).length}</Typography.Text>
              },
              {
                title: "Webhook",
                render: (_, repository) => {
                  if (!repository.webhookEnabled || !repository.webhookUrl) {
                    return <Typography.Text type="secondary">Disabled</Typography.Text>;
                  }

                  const lastState =
                    repository.webhookLastStatus === "success"
                      ? "Last delivery: success"
                      : repository.webhookLastStatus === "failed"
                        ? `Last delivery failed${repository.webhookLastError ? ` (${repository.webhookLastError})` : ""}`
                        : "No deliveries yet";
                  return (
                    <Flex vertical gap={0}>
                      <Typography.Text>{repository.webhookUrl}</Typography.Text>
                      <Typography.Text type={repository.webhookLastStatus === "failed" ? "danger" : "secondary"}>
                        {lastState}
                      </Typography.Text>
                    </Flex>
                  );
                }
              },
              {
                title: "Actions",
                render: (_, repository) => (
                  <Space>
                    {canEditRepository ? (
                      <Button onClick={() => router.push(`/repositories/${repository.id}/edit?from=list`)}>Edit</Button>
                    ) : null}
                    {canDeleteRepository ? (
                      <Popconfirm
                        title="Delete repository?"
                        description="Tasks keep their stored snapshot, but this repository will be removed from quick selection."
                        onConfirm={async () => {
                          try {
                            await api.deleteRepository(repository.id);
                            messageApi.success("Repository deleted");
                          } catch (error) {
                            messageApi.error(error instanceof Error ? error.message : "Failed to delete repository");
                          }
                        }}
                      >
                        <Button danger>Delete</Button>
                      </Popconfirm>
                    ) : null}
                  </Space>
                )
              }
            ]}
          />
        </Card>
      </Space>
    </>
  );
}
