import { SnippetEditorPage } from "../../../../components/snippet-editor-page";

export default function EditSnippetRoute({ params }: { params: { id: string } }) {
  return <SnippetEditorPage mode="edit" snippetId={params.id} />;
}
