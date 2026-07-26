"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck, TriangleAlert } from "lucide-react";
import { FormEvent, useState } from "react";
import { getAddress, isAddress } from "viem";

import { rescueMainnetChainConfigs } from "@safeexit/chain";
import {
  evmAddressSchema,
  type RescueAssetManifest,
} from "@safeexit/shared";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type FormErrors = {
  source?: string;
  destination?: string;
  assets?: string;
  authorization?: string;
};

function parseContractAddresses(
  value: string,
): RescueAssetManifest["erc20TokenAddresses"] {
  const entries = value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  const invalid = entries.find((entry) => !isAddress(entry));
  if (invalid) {
    throw new Error(`Invalid ERC-20 contract address: ${invalid}`);
  }
  return [
    ...new Map(
      entries.map((entry) => [
        entry.toLowerCase(),
        evmAddressSchema.parse(getAddress(entry)),
      ]),
    ).values(),
  ];
}

function parseNftAssets(
  value: string,
  standard: "ERC-721" | "ERC-1155",
): RescueAssetManifest["erc721Assets"] {
  const entries = value.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean);
  const assets = entries.map((entry) => {
    const match = /^(0x[a-fA-F0-9]{40}):(0|[1-9]\d*)$/.exec(entry);
    if (!match?.[1] || !match[2] || !isAddress(match[1])) {
      throw new Error(`Invalid ${standard} entry: ${entry}. Use contract:tokenId.`);
    }
    return {
      collectionAddress: evmAddressSchema.parse(getAddress(match[1])),
      tokenId: match[2],
    };
  });
  return [
    ...new Map(
      assets.map((asset) => [
        `${asset.collectionAddress.toLowerCase()}:${asset.tokenId}`,
        asset,
      ]),
    ).values(),
  ];
}

function parseAssetManifest(
  erc20Input: string,
  erc721Input: string,
  erc1155Input: string,
): RescueAssetManifest {
  const manifest = {
    erc20TokenAddresses: parseContractAddresses(erc20Input),
    erc721Assets: parseNftAssets(erc721Input, "ERC-721"),
    erc1155Assets: parseNftAssets(erc1155Input, "ERC-1155"),
  };
  if (
    manifest.erc20TokenAddresses.length === 0 &&
    manifest.erc721Assets.length === 0 &&
    manifest.erc1155Assets.length === 0
  ) {
    throw new Error("Enter at least one asset contract to rescue.");
  }
  if (
    manifest.erc20TokenAddresses.length > 8 ||
    manifest.erc721Assets.length > 8 ||
    manifest.erc1155Assets.length > 8
  ) {
    throw new Error("Enter no more than 8 assets of any one token standard.");
  }
  const total =
    manifest.erc20TokenAddresses.length +
    manifest.erc721Assets.length +
    manifest.erc1155Assets.length;
  if (total > 16) {
    throw new Error("Enter no more than 16 assets in one rescue incident.");
  }
  return manifest;
}

export function StartRescueForm() {
  const router = useRouter();
  const [chainId, setChainId] = useState(196);
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [erc20Input, setErc20Input] = useState("");
  const [erc721Input, setErc721Input] = useState("");
  const [erc1155Input, setErc1155Input] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: FormErrors = {};
    if (!isAddress(source)) {
      nextErrors.source = "Enter a valid EVM source address.";
    }
    if (!isAddress(destination)) {
      nextErrors.destination = "Enter a valid EVM destination address.";
    } else if (isAddress(source) && source.toLowerCase() === destination.toLowerCase()) {
      nextErrors.destination = "Destination must be different from the source wallet.";
    }
    if (!authorized) {
      nextErrors.authorization = "Authorisation confirmation is required.";
    }
    let assetManifest: RescueAssetManifest | undefined;
    try {
      assetManifest = parseAssetManifest(erc20Input, erc721Input, erc1155Input);
    } catch (error) {
      nextErrors.assets = error instanceof Error ? error.message : "Asset list is invalid.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !assetManifest) {
      return;
    }

    setSubmitting(true);
    setSubmitError(undefined);
    try {
      const response = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId,
          sourceAddress: source,
          destinationAddress: destination,
          assetManifest,
          authorizationConfirmed: true,
        }),
      });
      const body = (await response.json()) as { dashboardUrl?: string; message?: string };
      if (!response.ok || !body.dashboardUrl) {
        throw new Error(body.message ?? "Incident could not be created");
      }
      router.push(body.dashboardUrl);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Incident could not be created");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full" noValidate>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_300px]">
        <div className="window-panel">
          <div className="window-bar">
            <span className="window-dot" />
            <span className="window-dot" />
            <span className="ml-auto">source.wallet</span>
          </div>
          <label className="block p-4 sm:p-5">
            <span className="mb-2 block text-sm font-extrabold">Source wallet</span>
            <Input
              value={source}
              onChange={(event) => setSource(event.target.value.trim())}
              placeholder="0x..."
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(errors.source)}
            />
            <span className="mt-2 block min-h-5 text-xs font-semibold text-danger">
              {errors.source}
            </span>
          </label>
        </div>

        <div className="window-panel">
          <div className="window-bar">
            <span className="window-dot" />
            <span className="window-dot" />
            <span className="ml-auto">destination.wallet</span>
          </div>
          <label className="block p-4 sm:p-5">
            <span className="mb-2 block text-sm font-extrabold">Safe destination</span>
            <Input
              value={destination}
              onChange={(event) => setDestination(event.target.value.trim())}
              placeholder="0x..."
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(errors.destination)}
            />
            <span className="mt-2 block min-h-5 text-xs font-semibold text-danger">
              {errors.destination}
            </span>
          </label>
        </div>

        <div className="window-panel">
          <div className="window-bar">
            <span className="window-dot" />
            <span className="window-dot" />
            <span className="ml-auto">chain.scope</span>
          </div>
          <label className="block p-4 sm:p-5">
            <span className="mb-2 block text-sm font-extrabold">Network</span>
            <select
              value={chainId}
              onChange={(event) => setChainId(Number(event.target.value))}
              className="h-11 w-full rounded-[2px] border-2 border-border-strong bg-surface px-3 font-mono text-sm font-medium text-foreground focus:bg-white focus:outline focus:outline-2"
            >
              {rescueMainnetChainConfigs.map((config) => (
                <option key={config.chain.id} value={config.chain.id}>
                  {config.chain.name} / {config.chain.id}
                </option>
              ))}
            </select>
            <span className="mt-2 block text-xs font-semibold leading-5 text-muted">
              Verified mainnet RPC only.
            </span>
          </label>
        </div>
      </div>

      <div className="window-panel mt-7">
        <div className="window-bar">
          <span className="window-dot" />
          <span className="window-dot" />
          <span className="ml-auto">asset-manifest.input</span>
        </div>
        <div className="p-4 sm:p-6">
          <div className="mb-5 grid gap-2 sm:grid-cols-[220px_1fr] sm:items-start">
            <p className="text-base font-black">Assets to rescue</p>
            <p className="text-xs font-semibold leading-5 text-muted">
              Paste every known contract in this incident. SAFEEXIT verifies each entry
              onchain before it can enter a rescue plan.
            </p>
          </div>
          <label className="block">
            <span className="mb-2 block font-mono text-[10px] font-bold uppercase text-dim">
              ERC-20 contracts
            </span>
            <textarea
              value={erc20Input}
              onChange={(event) => setErc20Input(event.target.value)}
              rows={3}
              placeholder="0x... one contract per line"
              spellCheck={false}
              aria-invalid={Boolean(errors.assets)}
              className="w-full resize-y rounded-[2px] border-2 border-border-strong bg-surface p-3 font-mono text-sm font-medium text-foreground placeholder:text-dim focus:bg-white focus:outline focus:outline-2"
            />
          </label>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block font-mono text-[10px] font-bold uppercase text-dim">
                ERC-721 assets
              </span>
              <textarea
                value={erc721Input}
                onChange={(event) => setErc721Input(event.target.value)}
                rows={3}
                placeholder="0xCollection:tokenId"
                spellCheck={false}
                aria-invalid={Boolean(errors.assets)}
                className="w-full resize-y rounded-[2px] border-2 border-border-strong bg-surface p-3 font-mono text-sm font-medium text-foreground placeholder:text-dim focus:bg-white focus:outline focus:outline-2"
              />
            </label>
            <label className="block">
              <span className="mb-2 block font-mono text-[10px] font-bold uppercase text-dim">
                ERC-1155 assets
              </span>
              <textarea
                value={erc1155Input}
                onChange={(event) => setErc1155Input(event.target.value)}
                rows={3}
                placeholder="0xCollection:tokenId"
                spellCheck={false}
                aria-invalid={Boolean(errors.assets)}
                className="w-full resize-y rounded-[2px] border-2 border-border-strong bg-surface p-3 font-mono text-sm font-medium text-foreground placeholder:text-dim focus:bg-white focus:outline focus:outline-2"
              />
            </label>
          </div>
          <p className="mt-2 min-h-5 text-xs font-semibold text-danger">{errors.assets}</p>
        </div>
      </div>

      <div className="paper-panel mt-7 bg-accent/20 p-4 sm:p-5">
        <label className="flex cursor-pointer items-start gap-3">
          <Checkbox
            checked={authorized}
            onChange={(event) => setAuthorized(event.target.checked)}
            aria-describedby="authorization-detail"
          />
          <span>
            <span className="block text-sm font-extrabold leading-5">
              I confirm that I am authorised to control and sign for this wallet.
            </span>
            <span id="authorization-detail" className="mt-1 block text-xs font-semibold leading-5 text-muted">
              The SafeExit website never requests a seed phrase, private key, keystore, or raw credential. For X Layer delegated rescue, only the separately installed Source Signer popup may request the raw source key for one local signing session.
            </span>
          </span>
        </label>
        {errors.authorization && (
          <p className="mt-3 flex items-center gap-2 text-xs font-bold text-danger">
            <TriangleAlert className="size-3.5" />
            {errors.authorization}
          </p>
        )}
      </div>

      <div className="mt-7 flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-xs font-semibold text-muted">
          <ShieldCheck className="size-4" />
          Mainnet signing requires a fresh deterministic preflight for every action.
        </p>
        <Button type="submit" size="lg" className="sm:min-w-56" disabled={submitting}>
          {submitting ? "Creating incident..." : "Create rescue incident"}
          <ArrowRight className="size-4" />
        </Button>
      </div>
      {submitError && (
        <p role="alert" className="paper-panel mt-4 bg-danger/15 p-3 text-xs font-bold text-danger">
          {submitError}
        </p>
      )}
    </form>
  );
}
