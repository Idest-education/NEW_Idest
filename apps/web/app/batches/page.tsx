import type { Metadata } from "next";
import { BatchesView } from "../../components/batches-view";
import { RoleGate } from "../../components/session";

export const metadata: Metadata = { title: "Batches" };

export default function BatchesPage() {
  return (
    <RoleGate access="teacher">
      <BatchesView />
    </RoleGate>
  );
}
