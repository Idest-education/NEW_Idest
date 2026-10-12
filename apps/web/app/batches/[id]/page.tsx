import type { Metadata } from "next";
import { BatchDetail } from "../../../components/batch-detail";
import { RoleGate } from "../../../components/session";

export const metadata: Metadata = { title: "Batch" };

export default async function BatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ upload?: string }>;
}) {
  const [{ id }, { upload }] = await Promise.all([params, searchParams]);
  return (
    <RoleGate access="teacher">
      <BatchDetail key={id} id={id} uploadFailed={upload === "failed"} />
    </RoleGate>
  );
}
