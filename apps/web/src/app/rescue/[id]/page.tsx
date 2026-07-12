import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAddress } from "viem";

import { DraftWorkspace } from "@/components/draft-workspace";

export const metadata: Metadata = {
  title: "Rescue Workspace",
};

type RescuePageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function RescuePage({ params, searchParams }: RescuePageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  if (id === "demo-31337") {
    redirect("/demo");
  }

  const source = first(query.source);
  const destination = first(query.destination);
  const chainId = first(query.chainId);
  const safeSource = isAddress(source) ? source : "Invalid or missing source address";
  const safeDestination = isAddress(destination)
    ? destination
    : "Invalid or missing destination address";
  const chainName = chainId === "31337" ? "Local Anvil / 31337" : "X Layer / 196";

  return (
    <DraftWorkspace
      incidentId={id}
      source={safeSource}
      destination={safeDestination}
      chainName={chainName}
    />
  );
}
