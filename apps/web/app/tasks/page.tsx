import { Suspense } from "react";
import { TasksPage } from "../../components/tasks-page";

export default function TasksRoute() {
  return (
    <Suspense fallback={null}>
      <TasksPage />
    </Suspense>
  );
}
