import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MainnetRescueWorkspace } from "@/components/mainnet-rescue-workspace";
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

  if (incident.chainId !== 196) {
    notFound();
  }

  return (
    <MainnetRescueWorkspace
      incidentId={incident.id}
      source={incident.sourceAddress}
      destination={incident.destinationAddress}
      {...(incident.assetManifest ? { assetManifest: incident.assetManifest } : {})}
    />
  );
}
