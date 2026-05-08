"use client";

import dayjs from "dayjs";
import { useRouter } from "next/navigation";
import type { FlowDefinition } from "@agentswarm/shared-types";
import { Button, Card, Flex, Space, Table, Typography } from "antd";
import { useFlows } from "../src/hooks/useFlows";
import { useAuth } from "./auth-provider";

const summarizeDefinition = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Empty";
  }
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
};

export function FlowsPage() {
  const { flows, loading } = useFlows();
  const { can } = useAuth();
  const router = useRouter();
  const canCreateFlow = can("flow:create");
  const canReadFlow = can("flow:read");

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Flex align="center" justify="space-between" gap={16} wrap="wrap">
        <Flex vertical gap={0}>
          <Typography.Title level={2} style={{ margin: 0 }}>
            Flows
          </Typography.Title>
          <Typography.Text type="secondary">
            Create and manage reusable flow definitions for flow-mode task execution.
          </Typography.Text>
        </Flex>
        {canCreateFlow ? (
          <Button type="primary" onClick={() => router.push("/flows/new")}>
            New Flow
          </Button>
        ) : null}
      </Flex>

      <Card bordered={false}>
        <Table<FlowDefinition>
          rowKey="id"
          loading={loading}
          dataSource={flows}
          pagination={{ pageSize: 10 }}
          onRow={(flow) => ({
            onClick: () => {
              if (canReadFlow) {
                router.push(`/flows/${flow.id}`);
              }
            },
            style: canReadFlow ? { cursor: "pointer" } : undefined
          })}
          columns={[
            {
              title: "Name",
              dataIndex: "name"
            },
            {
              title: "Description",
              dataIndex: "description",
              render: (value: string) => value || "No description"
            },
            {
              title: "Definition Preview",
              dataIndex: "definitionJson",
              render: (value: string) => summarizeDefinition(value)
            },
            {
              title: "Updated At",
              dataIndex: "updatedAt",
              sorter: (left, right) => left.updatedAt.localeCompare(right.updatedAt),
              defaultSortOrder: "descend",
              render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm")
            },
            {
              title: "Actions",
              key: "actions",
              width: 140,
              render: (_value, flow) => (
                <Space wrap>
                  {canReadFlow ? (
                    <Button
                      size="small"
                      onClick={(event) => {
                        event.stopPropagation();
                        router.push(`/flows/${flow.id}`);
                      }}
                    >
                      Open
                    </Button>
                  ) : null}
                </Space>
              )
            }
          ]}
        />
      </Card>
    </Space>
  );
}
