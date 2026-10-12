import type { Metadata } from "next";
import { HelpView } from "../../components/help-view";
import { RoleGate } from "../../components/session";

export const metadata: Metadata = { title: "Help" };

export default function HelpPage() {
  return (
    <RoleGate access="signed-in">
      <HelpView />
    </RoleGate>
  );
}
