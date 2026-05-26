import { RepositoryEditorPage } from "../../../../components/repository-editor-page";

export default function EditRepositoryRoute({ params }: { params: { id: string } }) {
  return <RepositoryEditorPage mode="edit" repositoryId={params.id} />;
}
