import type { Metadata } from "next";
import { AdminView } from "../../components/admin-view";
import { RoleGate } from "../../components/session";

export const metadata: Metadata = { title: "Analytics" };

export default function AdminPage() {
  return (
    <RoleGate access="admin">
      <AdminView />
    </RoleGate>
  );
}
