import type { CSSProperties, ReactNode } from "react";
import { Button, Card, Collapse, Flex, Space, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { getAgentProviderLabel, type TaskChangeProposal, type TaskRun } from "@verft/shared-types";
import type { GroupedAutoRunHistoryEntry } from "../src/utils/task-history";
import {
  checkpointStatusColor,
  checkpointStatusLabel,
  formatRunDuration,
  getNormalizedRunSummary,
  taskRunActionLabel,
  taskRunStatusColor
} from "../src/utils/task-history-display";

export interface TaskHistoryGroupedAutoRunCardProps {
  entryKey: string;
  entry: GroupedAutoRunHistoryEntry;
  cardStyle?: CSSProperties;
  headStyle?: CSSProperties;
  showCheckpointState: boolean;
  showRunCancel: boolean;
  cancelLoading: boolean;
  onCancel?: () => void;
  renderMarkdown: (markdown: string) => ReactNode;
  renderRunErrorNotice: (run: TaskRun) => ReactNode;
  renderRunTimelineCollapse: (run: TaskRun) => ReactNode;
  renderSummaryCopyButton: (markdown: string) => ReactNode;
  renderCheckpointDiffSection: (proposal: TaskChangeProposal, keyPrefix: string) => ReactNode;
}

export function TaskHistoryGroupedAutoRunCard({
  entryKey,
  entry,
  cardStyle,
  headStyle,
  showCheckpointState,
  showRunCancel,
  cancelLoading,
  onCancel,
  renderMarkdown,
  renderRunErrorNotice,
  renderRunTimelineCollapse,
  renderSummaryCopyButton,
  renderCheckpointDiffSection
}: TaskHistoryGroupedAutoRunCardProps) {
  const normalizedRunSummary = getNormalizedRunSummary(entry.run);
  const summaryTitle = entry.run.action === "build" ? "Implementation Summary" : "Summary";

  return (
    <Card
      key={entryKey}
      size="small"
      style={cardStyle}
      headStyle={headStyle}
      title={
        <Space wrap>
          <Tag color={taskRunStatusColor[entry.run.status]}>{entry.run.status}</Tag>
          <Tag>{taskRunActionLabel[entry.run.action]}</Tag>
          {entry.run.action === "build" && entry.run.changeOutcome === "no_change" ? <Tag color="default">No code changes</Tag> : null}
          <Tag>{getAgentProviderLabel(entry.run.provider)}</Tag>
          {showCheckpointState && entry.proposal ? <Tag color={checkpointStatusColor(entry.proposal.status)}>{checkpointStatusLabel(entry.proposal.status)}</Tag> : null}
          {entry.proposal?.diffTruncated ? <Tag>Truncated preview</Tag> : null}
        </Space>
      }
      extra={
        <Space size={8} wrap style={{ justifyContent: "flex-end" }}>
          <Typography.Text type="secondary">
            {dayjs(entry.run.startedAt).format("YYYY-MM-DD HH:mm:ss")} · {formatRunDuration(entry.run.startedAt, entry.run.finishedAt)}
          </Typography.Text>
          {showRunCancel ? (
            <Button size="small" danger onClick={onCancel} loading={cancelLoading}>
              Cancel
            </Button>
          ) : null}
        </Space>
      }
    >
      <Flex vertical gap="middle">
        <div>{renderMarkdown(entry.promptText)}</div>
        {renderRunErrorNotice(entry.run)}
        {renderRunTimelineCollapse(entry.run)}
        <Collapse
          size="small"
          defaultActiveKey={[`${entryKey}-summary`]}
          items={[
            {
              key: `${entryKey}-summary`,
              label: summaryTitle,
              extra: normalizedRunSummary ? renderSummaryCopyButton(normalizedRunSummary) : null,
              children: normalizedRunSummary ? renderMarkdown(normalizedRunSummary) : (
                <Typography.Text type="secondary">
                  {entry.run.status === "running"
                    ? "Summary will appear when the run finishes."
                    : entry.run.action === "build" && entry.run.changeOutcome === "no_change"
                      ? "No code changes were needed for this run."
                      : "No summary was captured for this run."}
                </Typography.Text>
              )
            }
          ]}
        />
        {entry.proposal ? renderCheckpointDiffSection(entry.proposal, entryKey) : null}
      </Flex>
    </Card>
  );
}
