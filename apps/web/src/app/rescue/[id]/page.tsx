import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isRescueMainnetChainId } from "@safeexit/chain";
import { MainnetRescueWorkspace } from "@/components/mainnet-rescue-workspace";
import {
  getPrismaClient,
  PrismaAgentServiceJobStore,
  PrismaSafeExitRepository,
} from "@safeexit/persistence";
import { getAgentIncidentService } from "@/lib/agent-runtime";

export const metadata: Metadata = {
  title: "Rescue Workspace",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
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

  if (!isRescueMainnetChainId(incident.chainId)) {
    notFound();
  }

  const agentJob = await new PrismaAgentServiceJobStore(getPrismaClient())
    .getByIncidentId(incident.id);
  const receiptBindings = (
    agentJob?.signingPackages ??
    (agentJob?.signingPackage ? [agentJob.signingPackage] : [])
  ).map((signingPackage) => ({
    actionId: signingPackage.actionId,
    packageId: signingPackage.packageId,
  }));

  return (
    <MainnetRescueWorkspace
      incidentId={incident.id}
      chainId={incident.chainId}
      source={incident.sourceAddress}
      destination={incident.destinationAddress}
      receiptBindings={receiptBindings}
      {...(incident.assetManifest ? { assetManifest: incident.assetManifest } : {})}
    />
  );
}
