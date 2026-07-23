import { UserEditPage } from "../../../../components/user-edit-page";

export default function UserEditRoute({ params }: { params: { id: string } }) {
  return <UserEditPage userId={params.id} />;
}
