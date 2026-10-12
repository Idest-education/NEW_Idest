import type { Metadata } from "next";
import { AccountView } from "../../components/account-view";
import { RoleGate } from "../../components/session";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <RoleGate access="signed-in">
      <AccountView />
    </RoleGate>
  );
}
