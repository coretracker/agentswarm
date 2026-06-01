import { SchedulerTaskEditPage } from "../../../../components/scheduler-task-edit-page";

export default function SchedulerTaskEditRoute({ params }: { params: { id: string } }) {
  return <SchedulerTaskEditPage taskId={params.id} />;
}
