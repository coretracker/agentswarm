import { TaskDraftEditorPage } from "../../../../components/task-draft-editor-page";

export default function TaskDraftRoute({ params }: { params: { id: string } }) {
  return <TaskDraftEditorPage draftId={params.id} />;
}
