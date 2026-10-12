import type { Metadata } from "next";
import { HistoryView } from "../../components/history-view";
import { RoleGate } from "../../components/session";

export const metadata: Metadata = { title: "History" };

export default function HistoryPage() {
  return (
    <RoleGate access="teacher">
      <HistoryView />
    </RoleGate>
  );
}
