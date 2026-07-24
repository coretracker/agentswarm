import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { CopyOutlined } from "@ant-design/icons";
import { Button, Card, Flex, Space, Tooltip, Typography, theme as antTheme } from "antd";
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

interface DiffLineStats {
  additions: number;
  deletions: number;
}

export interface TaskHistoryGroupedAutoRunCardProps {
  entryKey: string;
  entry: GroupedAutoRunHistoryEntry;
  cardStyle?: CSSProperties;
  initialSection?: HistoryDetailSection | null;
  showCheckpointState: boolean;
  showRunCancel: boolean;
  cancelLoading: boolean;
  onCancel?: () => void;
  renderMarkdown: (markdown: string) => ReactNode;
  renderRunErrorNotice: (run: TaskRun) => ReactNode;
  renderRunTimelineContent: (run: TaskRun) => ReactNode;
  onTimelineOpen?: (run: TaskRun) => void;
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

function parseDiffLineStats(proposal: TaskChangeProposal): DiffLineStats | null {
  const stat = proposal.diffStat.trim();
  const insertionMatch = stat.match(/(\d+)\s+insertions?\(\+\)/);
  const deletionMatch = stat.match(/(\d+)\s+deletions?\(-\)/);
  const additions = insertionMatch ? Number(insertionMatch[1]) : 0;
  const deletions = deletionMatch ? Number(deletionMatch[1]) : 0;

  if (additions > 0 || deletions > 0 || stat.includes("changed")) {
    return { additions, deletions };
  }

  if (!proposal.diff.trim() || proposal.diff.trim() === "(no changes)") {
    return null;
  }

  let fallbackAdditions = 0;
  let fallbackDeletions = 0;
  for (const line of proposal.diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("+")) {
      fallbackAdditions += 1;
    } else if (line.startsWith("-")) {
      fallbackDeletions += 1;
    }
  }

  return fallbackAdditions > 0 || fallbackDeletions > 0
    ? { additions: fallbackAdditions, deletions: fallbackDeletions }
    : null;
}

export function TaskHistoryGroupedAutoRunCard({
  entryKey,
  entry,
  cardStyle,
  initialSection = null,
  showCheckpointState,
  showRunCancel,
  cancelLoading,
  onCancel,
  renderMarkdown,
  renderRunErrorNotice,
  renderRunTimelineContent,
  onTimelineOpen,
  onCopySummary,
  renderCheckpointDiffContent,
  getCheckpointDiffActions
}: TaskHistoryGroupedAutoRunCardProps) {
  const { token } = antTheme.useToken();
  const [activeSection, setActiveSection] = useState<HistoryDetailSection | null>(initialSection);
  const [summaryHovered, setSummaryHovered] = useState(false);
  const normalizedRunSummary = getNormalizedRunSummary(entry.run);
  const summaryTitle = entry.run.action === "build" ? "Implementation Summary" : "Summary";
  const providerLabel = getAgentProviderLabel(entry.run.provider);
  const runStatusLabel = entry.run.status.charAt(0).toUpperCase() + entry.run.status.slice(1);
  const timelineEventCount = entry.run.timelineEvents?.length ?? 0;
  const timelineDisplayCount = buildTimelineDisplayItems(entry.run.timelineEvents ?? []).length;
  const timelineMeta = `Timeline ${timelineEventCount > 0 ? `${timelineDisplayCount}/${timelineEventCount}` : "0"}`;
  const diffMeta = entry.proposal ? `Diff ${entry.proposal.changedFiles.length}` : null;
  const diffLineStats = entry.proposal ? parseDiffLineStats(entry.proposal) : null;
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
    if (section === "timeline" && activeSection !== "timeline") {
      onTimelineOpen?.(entry.run);
    }
    setActiveSection((current) => (current === section ? null : section));
  };

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

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
            {checkpointLabel ? (
              <>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>·</Typography.Text>
                <Typography.Text style={{ fontSize: 13, fontWeight: 500, color: checkpointStatusColor(entry.proposal!.status) === "orange" ? token.colorWarning : checkpointStatusColor(entry.proposal!.status) === "green" ? token.colorSuccess : token.colorTextSecondary }}>
                  {checkpointLabel}
                </Typography.Text>
              </>
            ) : null}
            {entry.run.action === "build" && entry.run.changeOutcome === "no_change" ? (
              <>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>·</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>No code changes</Typography.Text>
              </>
            ) : null}
            {diffLineStats ? (
              <>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>·</Typography.Text>
                <Space size={6} aria-label={`${diffLineStats.additions} additions, ${diffLineStats.deletions} deletions`}>
                  <Typography.Text style={{ fontSize: 13, fontWeight: 600, color: token.colorSuccess }}>
                    +{diffLineStats.additions}
                  </Typography.Text>
                  <Typography.Text style={{ fontSize: 13, fontWeight: 600, color: token.colorError }}>
                    -{diffLineStats.deletions}
                  </Typography.Text>
                </Space>
              </>
            ) : null}
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
          {renderRunErrorNotice(entry.run)}
        </Flex>

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
            <Button type="link" size="small" style={sectionButtonStyle("summary")} onClick={() => toggleSection("summary")}>
              {summaryTitle}
            </Button>
            <Button type="link" size="small" style={sectionButtonStyle("timeline")} onClick={() => toggleSection("timeline")}>
              {timelineMeta}
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
            {activeSection === "timeline" ? renderRunTimelineContent(entry.run) : null}
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
