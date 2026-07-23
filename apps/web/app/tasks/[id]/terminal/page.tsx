"use client";

import { useParams } from "next/navigation";
import { TaskTerminalPage } from "../../../../components/task-terminal-page";

export default function TaskTerminalRoutePage() {
  const params = useParams();
  const taskId = typeof params.id === "string" ? params.id : "";
  return <TaskTerminalPage taskId={taskId} />;
}
