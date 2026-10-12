import type { Metadata } from "next";
import { NewBatch } from "../../../components/new-batch";
import { RoleGate } from "../../../components/session";

export const metadata: Metadata = { title: "New batch" };

export default function NewBatchPage() {
  return (
    <RoleGate access="teacher">
      <NewBatch />
    </RoleGate>
  );
}
