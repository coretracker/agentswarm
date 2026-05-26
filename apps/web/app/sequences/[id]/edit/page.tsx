import { SequenceEditorPage } from "../../../../components/sequence-editor-page";

export default function EditSequenceRoute({ params }: { params: { id: string } }) {
  return <SequenceEditorPage mode="edit" sequenceId={params.id} />;
}
