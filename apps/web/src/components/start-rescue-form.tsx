"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck, TriangleAlert } from "lucide-react";
import { FormEvent, useState } from "react";
import { isAddress } from "viem";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type FormErrors = {
  source?: string;
  destination?: string;
  authorization?: string;
};

export function StartRescueForm() {
  const router = useRouter();
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [chainId, setChainId] = useState("1952");
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

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSubmitting(true);
    setSubmitError(undefined);
    try {
      const response = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: Number(chainId),
          sourceAddress: source,
          destinationAddress: destination,
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
    <form onSubmit={submit} className="max-w-3xl" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold">Source wallet</span>
          <Input
            value={source}
            onChange={(event) => setSource(event.target.value.trim())}
            placeholder="0x..."
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(errors.source)}
          />
          <span className="mt-2 block min-h-5 text-xs text-danger">{errors.source}</span>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold">Safe destination</span>
          <Input
            value={destination}
            onChange={(event) => setDestination(event.target.value.trim())}
            placeholder="0x..."
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(errors.destination)}
          />
          <span className="mt-2 block min-h-5 text-xs text-danger">
            {errors.destination}
          </span>
        </label>
      </div>

      <label className="mt-1 block max-w-sm">
        <span className="mb-2 block text-sm font-semibold">Network</span>
        <select
          value={chainId}
          onChange={(event) => setChainId(event.target.value)}
          className="h-11 w-full rounded-md border border-border-strong bg-background px-3 text-sm text-foreground focus:border-accent focus:outline focus:outline-1"
        >
          <option value="1952">X Layer testnet - signing pilot</option>
          <option value="196">X Layer mainnet - read-only</option>
        </select>
      </label>

      <div className="mt-6 border-y border-border py-5">
        <label className="flex cursor-pointer items-start gap-3">
          <Checkbox
            checked={authorized}
            onChange={(event) => setAuthorized(event.target.checked)}
            aria-describedby="authorization-detail"
          />
          <span>
            <span className="block text-sm font-semibold leading-5">
              I confirm that I am authorised to control and sign for this wallet.
            </span>
            <span id="authorization-detail" className="mt-1 block text-xs leading-5 text-muted">
              SAFEEXIT will never request a seed phrase, private key, keystore, or raw credential.
            </span>
          </span>
        </label>
        {errors.authorization && (
          <p className="mt-3 flex items-center gap-2 text-xs text-danger">
            <TriangleAlert className="size-3.5" />
            {errors.authorization}
          </p>
        )}
      </div>

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-xs text-muted">
          <ShieldCheck className="size-4 text-accent" />
          {chainId === "1952"
            ? "Testnet signing requires a fresh deterministic preflight."
            : "Mainnet remains read-only; no transaction can be signed."}
        </p>
        <Button type="submit" size="lg" className="sm:min-w-44" disabled={submitting}>
          {submitting ? "Creating incident..." : "Create rescue incident"}
          <ArrowRight className="size-4" />
        </Button>
      </div>
      {submitError && <p role="alert" className="mt-4 text-xs text-danger">{submitError}</p>}
    </form>
  );
}
