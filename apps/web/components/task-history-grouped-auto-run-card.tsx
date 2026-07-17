import { useState, type CSSProperties, type ReactNode } from "react";
import { CopyOutlined } from "@ant-design/icons";
import { Button, Card, Flex, Space, Tag, Tooltip, Typography, theme as antTheme } from "antd";
import dayjs from "dayjs";
import { getAgentProviderLabel, type TaskChangeProposal, type TaskRun } from "@verft/shared-types";
import type { GroupedAutoRunHistoryEntry } from "../src/utils/task-history";
import { buildTimelineDisplayItems } from "../src/utils/task-run-timeline";
import {
  checkpointStatusColor,
  checkpointStatusLabel,
  formatRunDuration,
  getNormalizedRunSummary,
  taskRunActionLabel,
  taskRunStatusColor
} from "../src/utils/task-history-display";

type HistoryDetailSection = "timeline" | "summary" | "diff";

export interface TaskHistoryGroupedAutoRunCardProps {
  entryKey: string;
  entry: GroupedAutoRunHistoryEntry;
  cardStyle?: CSSProperties;
  showCheckpointState: boolean;
  showRunCancel: boolean;
  cancelLoading: boolean;
  onCancel?: () => void;
  renderMarkdown: (markdown: string) => ReactNode;
  renderRunErrorNotice: (run: TaskRun) => ReactNode;
  renderRunTimelineCollapse: (run: TaskRun) => ReactNode;
  onCopySummary: (markdown: string) => void;
  renderCheckpointDiffContent: (proposal: TaskChangeProposal) => ReactNode;
  getCheckpointDiffActions?: (proposal: TaskChangeProposal) => TaskHistoryCheckpointDiffActions;
}

export interface TaskHistoryCheckpointDiffAction {
  visible: boolean;
  label: string;
  danger?: boolean;
  primary?: boolean;
  disabled?: boolean;
  loading?: boolean;
  tooltip?: string;
  onClick: () => void;
}

export interface TaskHistoryCheckpointDiffActions {
  apply?: TaskHistoryCheckpointDiffAction;
  reject?: TaskHistoryCheckpointDiffAction;
  revert?: TaskHistoryCheckpointDiffAction;
  disabled?: boolean;
}

export function TaskHistoryGroupedAutoRunCard({
  entryKey,
  entry,
  cardStyle,
  showCheckpointState,
  showRunCancel,
  cancelLoading,
  onCancel,
  renderMarkdown,
  renderRunErrorNotice,
  renderRunTimelineCollapse,
  onCopySummary,
  renderCheckpointDiffContent,
  getCheckpointDiffActions
}: TaskHistoryGroupedAutoRunCardProps) {
  const { token } = antTheme.useToken();
  const [activeSection, setActiveSection] = useState<HistoryDetailSection | null>(null);
  const [summaryHovered, setSummaryHovered] = useState(false);
  const normalizedRunSummary = getNormalizedRunSummary(entry.run);
  const summaryTitle = entry.run.action === "build" ? "Implementation Summary" : "Summary";
  const providerLabel = getAgentProviderLabel(entry.run.provider);
  const runStatusLabel = entry.run.status.charAt(0).toUpperCase() + entry.run.status.slice(1);
  const timelineEventCount = entry.run.timelineEvents?.length ?? 0;
  const timelineDisplayCount = buildTimelineDisplayItems(entry.run.timelineEvents ?? []).length;
  const timelineMeta = `Timeline ${timelineEventCount > 0 ? `${timelineDisplayCount}/${timelineEventCount}` : "0"}`;
  const diffMeta = entry.proposal ? `Diff ${entry.proposal.changedFiles.length}` : null;
  const summaryFallback = normalizedRunSummary
    ? null
    : entry.run.status === "running"
      ? "Summary will appear when the run finishes."
      : entry.run.action === "build" && entry.run.changeOutcome === "no_change"
        ? "No code changes were needed for this run."
        : null;
  const diffActions = entry.proposal ? getCheckpointDiffActions?.(entry.proposal) : undefined;
  const visibleDiffActions = [diffActions?.apply, diffActions?.reject, diffActions?.revert].filter(
    (action): action is TaskHistoryCheckpointDiffAction => !!action?.visible
  );
  const checkpointLabel = showCheckpointState && entry.proposal ? `${checkpointStatusLabel(entry.proposal.status)} checkpoint` : null;
  const accentColor = entry.run.status === "failed"
    ? token.colorError
    : entry.run.status === "running"
      ? token.colorPrimary
      : entry.proposal?.status === "pending"
        ? token.colorWarning
        : token.colorSuccess;
  const sectionButtonStyle = (section: HistoryDetailSection): CSSProperties => ({
    paddingInline: 0,
    color: activeSection === section ? token.colorText : token.colorTextTertiary,
    fontWeight: activeSection === section ? 600 : 400,
    fontSize: 13
  });
  const toggleSection = (section: HistoryDetailSection) => {
    setActiveSection((current) => (current === section ? null : section));
  };
  const renderDiffAction = (action: TaskHistoryCheckpointDiffAction) => (
    <Tooltip key={action.label} title={action.tooltip}>
      <span>
        <Button
          type={action.primary ? "primary" : "default"}
          size="small"
          danger={action.danger}
          disabled={action.disabled}
          loading={action.loading}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <Card
      key={entryKey}
      size="small"
      style={{
        overflow: "hidden",
        borderRadius: token.borderRadiusLG,
        ...cardStyle
      }}
      styles={{ body: { padding: 0 } }}
    >
      <Flex vertical>
        {/* Meta: status dot + run info */}
        <Flex
          justify="space-between"
          align="center"
          gap={16}
          wrap="wrap"
          style={{ padding: "16px 20px 0" }}
        >
          <Flex align="center" gap={8} style={{ minWidth: 0, flexWrap: "wrap" }}>
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: accentColor,
                flexShrink: 0,
                boxShadow: entry.run.status === "running" ? `0 0 0 3px ${accentColor}30` : undefined
              }}
            />
            <Typography.Text style={{ fontSize: 13, fontWeight: 600, color: accentColor }}>
              {runStatusLabel}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>·</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {formatRunDuration(entry.run.startedAt, entry.run.finishedAt)}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>·</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {taskRunActionLabel[entry.run.action]} by {providerLabel}
            </Typography.Text>
          </Flex>
          <Tooltip title={dayjs(entry.run.startedAt).format("YYYY-MM-DD HH:mm:ss")}>
            <Typography.Text type="secondary" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
              {dayjs(entry.run.startedAt).format("MMM D, HH:mm")}
            </Typography.Text>
          </Tooltip>
        </Flex>

        {/* Content: prompt + summary */}
        <Flex vertical style={{ padding: "12px 20px 0" }}>
          <div style={{ fontSize: 15, lineHeight: 1.6, fontWeight: 500 }}>
            {renderMarkdown(entry.promptText)}
          </div>
          {normalizedRunSummary ? (
            <div style={{ color: token.colorTextSecondary }}>
              {renderMarkdown(normalizedRunSummary)}
            </div>
          ) : summaryFallback ? (
            <Typography.Text type="secondary" style={{ fontSize: 14, lineHeight: 1.5 }}>
              {summaryFallback}
            </Typography.Text>
          ) : null}
          {renderRunErrorNotice(entry.run)}
        </Flex>

        {/* Status tags – only rendered when at least one is visible */}
        {(checkpointLabel || (entry.run.action === "build" && entry.run.changeOutcome === "no_change") || entry.proposal?.diffTruncated) ? (
          <Flex gap={6} wrap="wrap" style={{ padding: "10px 20px 0" }}>
            {checkpointLabel ? (
              <Tag color={checkpointStatusColor(entry.proposal!.status)} style={{ margin: 0 }}>
                {checkpointLabel}
              </Tag>
            ) : null}
            {entry.run.action === "build" && entry.run.changeOutcome === "no_change" ? (
              <Tag color="default" style={{ margin: 0 }}>No code changes</Tag>
            ) : null}
            {entry.proposal?.diffTruncated ? (
              <Tag style={{ margin: 0 }}>Truncated preview</Tag>
            ) : null}
          </Flex>
        ) : null}

        {/* Footer: section toggles + action buttons */}
        <Flex
          justify="space-between"
          align="center"
          gap={12}
          wrap="wrap"
          style={{
            padding: "12px 20px",
            marginTop: 14,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            ...(activeSection ? { borderBottom: `1px solid ${token.colorBorderSecondary}` } : {})
          }}
        >
          <Space size={16} wrap>
            <Button type="link" size="small" style={sectionButtonStyle("timeline")} onClick={() => toggleSection("timeline")}>
              {timelineMeta}
            </Button>
            <Button type="link" size="small" style={sectionButtonStyle("summary")} onClick={() => toggleSection("summary")}>
              {summaryTitle}
            </Button>
            {entry.proposal ? (
              <Button type="link" size="small" style={sectionButtonStyle("diff")} disabled={diffActions?.disabled} onClick={() => toggleSection("diff")}>
                {diffMeta}
              </Button>
            ) : null}
          </Space>
          <Space size={8} wrap>
            {showRunCancel ? (
              <Button size="small" danger onClick={onCancel} loading={cancelLoading}>
                Cancel
              </Button>
            ) : null}
            {visibleDiffActions.map(renderDiffAction)}
          </Space>
        </Flex>

        {/* Expanded section content */}
        {activeSection ? (
          <div style={{ padding: 20, background: token.colorFillQuaternary }}>
            {activeSection === "timeline" ? renderRunTimelineCollapse(entry.run) : null}
            {activeSection === "summary" ? (
              normalizedRunSummary ? (
                <div
                  style={{ position: "relative" }}
                  onMouseEnter={() => setSummaryHovered(true)}
                  onMouseLeave={() => setSummaryHovered(false)}
                >
                  <Button
                    size="small"
                    type="text"
                    icon={<CopyOutlined />}
                    onClick={() => onCopySummary(normalizedRunSummary)}
                    style={{
                      position: "absolute",
                      top: 0,
                      right: 0,
                      zIndex: 1,
                      opacity: summaryHovered ? 1 : 0,
                      transition: "opacity 0.15s ease",
                      background: token.colorBgElevated,
                      boxShadow: `0 0 0 1px ${token.colorBorderSecondary}`
                    }}
                  >
                    Copy
                  </Button>
                  {renderMarkdown(normalizedRunSummary)}
                </div>
              ) : (
                <Typography.Text type="secondary">
                  {entry.run.status === "running"
                    ? "Summary will appear when the run finishes."
                    : entry.run.action === "build" && entry.run.changeOutcome === "no_change"
                      ? "No code changes were needed for this run."
                      : "No summary was captured for this run."}
                </Typography.Text>
              )
            ) : null}
            {activeSection === "diff" && entry.proposal ? renderCheckpointDiffContent(entry.proposal) : null}
          </div>
        ) : null}
      </Flex>
    </Card>
  );
}
