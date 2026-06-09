import { Suspense } from "react";
import { TasksKanbanBoardPage } from "../../../components/tasks-kanban-board-page";

export default function TasksBoardRoute() {
  return (
    <Suspense fallback={null}>
      <TasksKanbanBoardPage />
    </Suspense>
  );
}
