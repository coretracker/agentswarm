import { TaskDetailPage } from "../../../components/task-detail-page";

export default function TaskDetailRoute({ params }: { params: { id: string } }) {
  return <TaskDetailPage taskId={params.id} />;
}
