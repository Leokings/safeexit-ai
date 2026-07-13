import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DraftWorkspace } from "@/components/draft-workspace";
import { TestnetRescueWorkspace } from "@/components/testnet-rescue-workspace";
import { getPrismaClient, PrismaSafeExitRepository } from "@safeexit/persistence";
import { getAgentIncidentService } from "@/lib/agent-runtime";

export const metadata: Metadata = {
  title: "Rescue Workspace",
};

export const dynamic = "force-dynamic";

export default async function RescuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const repository = new PrismaSafeExitRepository(getPrismaClient());
  let incident = await repository.getIncident(id);
  if (!incident && id.startsWith("job:")) {
    try {
      incident = (await getAgentIncidentService().getJob(id)).incident;
    } catch {
      incident = undefined;
    }
  }
  if (!incident) {
    notFound();
  }

  if (incident.chainId === 1_952) {
    return (
      <TestnetRescueWorkspace
        incidentId={incident.id}
        source={incident.sourceAddress}
        destination={incident.destinationAddress}
        {...(incident.assetManifest ? { assetManifest: incident.assetManifest } : {})}
      />
    );
  }

  return (
    <DraftWorkspace
      incidentId={incident.id}
      source={incident.sourceAddress}
      destination={incident.destinationAddress}
      chainName={incident.chainId === 196 ? "X Layer mainnet / 196" : `Chain ${incident.chainId}`}
    />
  );
}
