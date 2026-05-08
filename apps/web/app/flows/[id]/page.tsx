import { FlowEditorPage } from "../../../components/flow-editor-page";

interface FlowDetailRouteProps {
  params: { id: string };
}

export default function FlowDetailRoute({ params }: FlowDetailRouteProps) {
  return <FlowEditorPage mode="edit" flowId={params.id} />;
}
