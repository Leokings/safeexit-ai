"use client";

import {
  ExternalLink,
  FileSignature,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient, getAddress, http, isAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  detectEip7702SourceSignerExtension,
  Eip7702RuntimeError,
  LocalEip7702RescueRuntime,
  requestEip7702SourceSignerFromExtension,
  ViemFundedEip7702PayerSession,
  XLAYER_SAFEEXIT_EIP7702_FACTORY_V2,
  type Eip7702ExecutionResult,
  type Eip7702ExtensionAuthorizationSigner,
  type Eip7702LocalSigningPackage,
} from "@safeexit/buyer-runtime";
import {
  getRescueFinalityPolicy,
  getRescueMainnetChainConfig,
} from "@safeexit/chain";
import type {
  EvmAddress,
  RescueAction,
  RescueAssetManifest,
} from "@safeexit/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyAddress } from "@/components/copy-address";
import {
  assertRecoveryAuthorizationCurrent,
  connectOkxWallet,
  ensureRescueMainnet,
  getOkxConnectedAccount,
  getOkxProvider,
  receiptProvesCommittedTransfer,
  recoveryAuthorizationExpiresAt,
  signDaiPermitPair,
  signEip3009Authorization,
  signErc2612Permit,
  signErc4494Permit,
  submitDaiPermitAtomicBatch,
  submitErc2612AtomicBatch,
  submitErc4494AtomicBatch,
  submitEip3009Settlement,
  type SignedRecoveryAuthorization,
} from "@/lib/okx-wallet";
import {
  eip7702RouteKey,
  gaslessRouteKey,
  mainnetPreflightResponseSchema,
  requireReviewedEip7702Route,
  requireReviewedGaslessRoute,
  type MainnetPreflightResponse,
} from "@/lib/mainnet-rescue";

type SubmittedTransaction = {
  actionId: string;
  hash: Hex;
  status: "CONFIRMING" | "CONFIRMED" | "FAILED";
  reportStatus:
    | "NOT_REQUIRED"
    | "REPORTING"
    | "PENDING"
    | "CONFIRMED"
    | "REVERTED"
    | "REJECTED"
    | "ERROR";
};

type ReceiptBinding = {
  actionId: string;
  packageId: string;
};

type SourceSignerAvailabilityState =
  | Readonly<{ status: "CHECKING" }>
  | Readonly<{ status: "AVAILABLE"; extensionVersion: string }>
  | Readonly<{ status: "UNAVAILABLE" }>;

function errorMessage(error: unknown): string {
  if (
    error instanceof Eip7702RuntimeError &&
    error.transactionHashes.length > 0
  ) {
    return `${error.message} Submitted transaction(s): ${error.transactionHashes.join(", ")}`;
  }
  return error instanceof Error ? error.message : "The mainnet operation failed";
}

function tokenAddresses(value: string): `0x${string}`[] {
  const values = value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  const invalid = values.find((item) => !isAddress(item));
  if (invalid) {
    throw new Error(`Invalid ERC-20 contract address: ${invalid}`);
  }
  const unique = [...new Map(values.map((item) => [item.toLowerCase(), item])).values()];
  if (unique.length > 8) {
    throw new Error("A maximum of 8 ERC-20 contracts can be scanned at once");
  }
  return unique as `0x${string}`[];
}

function erc721Assets(value: string): Array<{
  collectionAddress: `0x${string}`;
  tokenId: string;
}> {
  const lines = value.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean);
  const assets = lines.map((line) => {
    const match = /^(0x[a-fA-F0-9]{40}):(0|[1-9]\d*)$/.exec(line);
    if (!match || !match[1] || !match[2] || !isAddress(match[1])) {
      throw new Error(`Invalid ERC-721 entry: ${line}. Use collection:tokenId.`);
    }
    return { collectionAddress: getAddress(match[1]), tokenId: match[2] };
  });
  const unique = [
    ...new Map(
      assets.map((asset) => [
        `${asset.collectionAddress.toLowerCase()}:${asset.tokenId}`,
        asset,
      ]),
    ).values(),
  ];
  if (unique.length > 8) {
    throw new Error("A maximum of 8 ERC-721 assets can be scanned at once");
  }
  return unique;
}

function erc1155Assets(value: string): Array<{
  collectionAddress: `0x${string}`;
  tokenId: string;
}> {
  return erc721Assets(value);
}

function nftAssetInput(
  assets: RescueAssetManifest["erc721Assets"] | undefined,
): string {
  return (assets ?? [])
    .map((asset) => `${asset.collectionAddress}:${asset.tokenId}`)
    .join("\n");
}

function actionLabel(actionType: string): string {
  return actionType.toLowerCase().replaceAll("_", " ");
}

function delegatedOutcomeMessage(
  outcome: Eip7702ExecutionResult["outcomes"][number],
): string | undefined {
  if (outcome.status === "COMPLETED") {
    return undefined;
  }
  const reason = outcome.failureReason?.toLowerCase() ?? "";
  if (reason.includes("expired") || reason.includes("deadline")) {
    return "The signed rescue package expired before this asset could be submitted. Run fresh preflight before retrying the remaining asset.";
  }
  if (outcome.status === "SIMULATION_FAILED") {
    return "The exact delegated call failed its final local simulation, so no transaction was submitted for this asset.";
  }
  return "The delegated transaction reverted and this asset was not moved.";
}

function executionPathLabel(
  executionPath: MainnetPreflightResponse["gaslessActions"][number]["executionPath"],
): string {
  return executionPath === "DIRECT_AUTHORIZATION"
    ? "Direct authorization"
    : "SafeExit settlement";
}

function authorizationStandardLabel(
  standard: MainnetPreflightResponse["gaslessActions"][number]["authorizationStandard"],
): string {
  switch (standard) {
    case "ERC3009":
      return "ERC-3009";
    case "ERC2612":
      return "ERC-2612";
    case "DAI_PERMIT":
      return "DAI permit";
    case "ERC4494":
      return "ERC-4494";
  }
}

function routeContract(route: MainnetPreflightResponse["gaslessActions"][number]): EvmAddress {
  return route.standard === "ERC4494_PERMIT_SETTLEMENT"
    ? route.collectionAddress
    : route.tokenAddress;
}

function actionTarget(action: RescueAction): EvmAddress {
  switch (action.actionType) {
    case "TRANSFER_NATIVE":
      return action.parameters.recipient;
    case "TRANSFER_ERC20":
    case "REVOKE_ERC20_APPROVAL":
      return action.parameters.tokenAddress;
    case "TRANSFER_ERC721":
    case "TRANSFER_ERC1155":
    case "REVOKE_NFT_OPERATOR":
      return action.parameters.collectionAddress;
    case "CLAIM_SUPPORTED_AIRDROP":
    case "WITHDRAW_SUPPORTED_POSITION":
    case "CUSTOM_SUPPORTED_ADAPTER":
      return action.parameters.contractAddress;
  }
}

function reportStatusLabel(status: SubmittedTransaction["reportStatus"]): string {
  switch (status) {
    case "NOT_REQUIRED":
      return "Manual incident";
    case "REPORTING":
      return "Registering";
    case "PENDING":
      return "Agent verification pending";
    case "CONFIRMED":
      return "Agent verified";
    case "REVERTED":
      return "Agent saw revert";
    case "REJECTED":
      return "Receipt rejected";
    case "ERROR":
      return "Report retry needed";
  }
}

export function MainnetRescueWorkspace({
  incidentId,
  chainId,
  source,
  destination,
  assetManifest,
  receiptBindings = [],
}: {
  incidentId: string;
  chainId: number;
  source: EvmAddress;
  destination: EvmAddress;
  assetManifest?: RescueAssetManifest;
  receiptBindings?: ReceiptBinding[];
}) {
  const chainConfig = getRescueMainnetChainConfig(chainId);
  const [connectedAccount, setConnectedAccount] = useState<`0x${string}`>();
  const [tokenInput, setTokenInput] = useState(
    () => assetManifest?.erc20TokenAddresses.join("\n") ?? "",
  );
  const [nftInput, setNftInput] = useState(
    () => nftAssetInput(assetManifest?.erc721Assets),
  );
  const [erc1155Input, setErc1155Input] = useState(
    () => nftAssetInput(assetManifest?.erc1155Assets),
  );
  const [preflight, setPreflight] = useState<MainnetPreflightResponse>();
  const [authorized, setAuthorized] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<string>();
  const [signed, setSigned] = useState<SignedRecoveryAuthorization>();
  const [signedEip7702Package, setSignedEip7702Package] =
    useState<Eip7702LocalSigningPackage>();
  const [eip7702Result, setEip7702Result] = useState<Eip7702ExecutionResult>();
  const eip7702SignerRef =
    useRef<Eip7702ExtensionAuthorizationSigner | undefined>(undefined);
  const [sourceSignerAvailability, setSourceSignerAvailability] =
    useState<SourceSignerAvailabilityState>({ status: "CHECKING" });
  const [busy, setBusy] = useState<"CONNECT" | "PREFLIGHT" | "SIGN" | "SETTLE" | null>(null);
  const [error, setError] = useState<string>();
  const [transactions, setTransactions] = useState<SubmittedTransaction[]>([]);
  const manifestLocked = Boolean(assetManifest);

  const sourceConnected = connectedAccount?.toLowerCase() === source.toLowerCase();
  const destinationConnected = connectedAccount?.toLowerCase() === destination.toLowerCase();
  const selectedEip7702Candidate =
    preflight?.eip7702Route &&
    eip7702RouteKey(preflight.eip7702Route) === selectedRoute
      ? preflight.eip7702Route
      : undefined;
  const sourceSignerAvailable =
    sourceSignerAvailability.status === "AVAILABLE" ||
    Boolean(signedEip7702Package);
  const selectedEip7702Route = sourceSignerAvailable
    ? selectedEip7702Candidate
    : undefined;
  const nextGaslessAction =
    selectedEip7702Candidate
      ? undefined
      : preflight?.gaslessActions.find(
          (route) => gaslessRouteKey(route) === selectedRoute,
        ) ?? preflight?.gaslessActions[0];
  const selectedRecoveryRoute = selectedEip7702Route ?? nextGaslessAction;
  const hasSignedAuthorization = Boolean(signed || signedEip7702Package);
  const signedExpiresAt = signed
    ? new Date(Number(recoveryAuthorizationExpiresAt(signed)) * 1_000).toLocaleTimeString(
        "en-GB",
        { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" },
      )
    : signedEip7702Package
      ? new Date(signedEip7702Package.expiresAt).toLocaleTimeString(
          "en-GB",
          { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" },
        )
      : undefined;

  const refreshSourceSignerAvailability = useCallback(
    async (signal?: AbortSignal) => {
      if (chainId !== 196) {
        setSourceSignerAvailability({ status: "UNAVAILABLE" });
        return;
      }
      setSourceSignerAvailability({ status: "CHECKING" });
      const availability = await detectEip7702SourceSignerExtension(
        signal ? { signal } : {},
      );
      if (signal?.aborted) return;
      if (
        availability.status === "AVAILABLE" &&
        availability.supportedChainIds.includes(196)
      ) {
        setSourceSignerAvailability({
          status: "AVAILABLE",
          extensionVersion: availability.extensionVersion,
        });
        return;
      }
      setSourceSignerAvailability({ status: "UNAVAILABLE" });
    },
    [chainId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refreshSourceSignerAvailability(controller.signal);
    return () => controller.abort();
  }, [refreshSourceSignerAvailability]);

  function clearSignedAuthorization(): void {
    setSigned(undefined);
    setSignedEip7702Package(undefined);
    eip7702SignerRef.current = undefined;
  }

  async function connectExpected(role: "SOURCE" | "DESTINATION") {
    setBusy("CONNECT");
    setError(undefined);
    try {
      const provider = await getOkxProvider();
      await connectOkxWallet(provider);
      await ensureRescueMainnet(provider, chainId);
      const account = await getOkxConnectedAccount(provider);
      setConnectedAccount(account);
      const expected = role === "SOURCE" ? source : destination;
      if (account.toLowerCase() !== expected.toLowerCase()) {
        throw new Error(
          role === "SOURCE"
            ? "Switch OKX Wallet to the reported source account before signing."
            : "Switch OKX Wallet to the safe destination account before settlement.",
        );
      }
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function requestPreflight(): Promise<MainnetPreflightResponse> {
    const response = await fetch(`/api/rescue/${encodeURIComponent(incidentId)}/preflight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenAddresses: tokenAddresses(tokenInput),
        erc721Assets: erc721Assets(nftInput),
        erc1155Assets: erc1155Assets(erc1155Input),
      }),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const message =
        body && typeof body === "object" && "message" in body && typeof body.message === "string"
          ? body.message
          : "Mainnet preflight failed";
      throw new Error(message);
    }
    const result = mainnetPreflightResponseSchema.parse(body);
    if (result.chainId !== chainId) {
      throw new Error("Preflight returned a different chain than the incident");
    }
    setPreflight(result);
    setSelectedRoute((current) => {
      const delegatedRouteKey = result.eip7702Route
        ? eip7702RouteKey(result.eip7702Route)
        : undefined;
      const firstGaslessRouteKey = result.gaslessActions[0]
        ? gaslessRouteKey(result.gaslessActions[0])
        : undefined;
      const currentIsGasless = result.gaslessActions.some(
        (route) => gaslessRouteKey(route) === current,
      );
      const currentIsDelegated =
        sourceSignerAvailable && current === delegatedRouteKey;
      if (currentIsGasless || currentIsDelegated) {
        return current;
      }
      return sourceSignerAvailable
        ? delegatedRouteKey ?? firstGaslessRouteKey
        : firstGaslessRouteKey ?? delegatedRouteKey;
    });
    return result;
  }

  async function reportTransactionReceipt(
    actionId: string,
    transactionHash: Hex,
  ): Promise<SubmittedTransaction["reportStatus"]> {
    const binding = receiptBindings.find((candidate) => candidate.actionId === actionId);
    if (!binding) {
      return "NOT_REQUIRED";
    }
    try {
      const response = await fetch(`/api/rescue/${encodeURIComponent(incidentId)}/receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId: binding.packageId,
          transactionHash,
        }),
      });
      const body: unknown = await response.json();
      if (
        body &&
        typeof body === "object" &&
        "status" in body &&
        typeof body.status === "string" &&
        ["PENDING", "CONFIRMED", "REVERTED", "REJECTED"].includes(body.status)
      ) {
        return body.status as SubmittedTransaction["reportStatus"];
      }
      return "ERROR";
    } catch {
      return "ERROR";
    }
  }

  function updateReportStatus(
    transactionHash: Hex,
    reportStatus: SubmittedTransaction["reportStatus"],
  ): void {
    setTransactions((current) =>
      current.map((item) =>
        item.hash === transactionHash ? { ...item, reportStatus } : item),
    );
  }

  async function refreshPreflight() {
    setBusy("PREFLIGHT");
    setError(undefined);
    try {
      clearSignedAuthorization();
      setEip7702Result(undefined);
      await requestPreflight();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function signAuthorization() {
    if (!authorized) {
      setError("Authorization confirmation is required before signing.");
      return;
    }
    if (selectedEip7702Candidate && !sourceSignerAvailable) {
      setError(
        "SafeExit Source Signer is not available. Install it, reload this page, and run fresh preflight before using EIP-7702.",
      );
      return;
    }
    setBusy("SIGN");
    setError(undefined);
    try {
      const intendedRoute =
        selectedRoute ??
        (selectedEip7702Route
          ? eip7702RouteKey(selectedEip7702Route)
          : nextGaslessAction
            ? gaslessRouteKey(nextGaslessAction)
            : undefined);
      if (!intendedRoute) {
        throw new Error("Select a destination-paid recovery route before signing.");
      }
      const intendedIsEip7702 = Boolean(selectedEip7702Route);
      const fresh = await requestPreflight();

      if (intendedIsEip7702) {
        const route = requireReviewedEip7702Route(
          fresh.eip7702Route,
          intendedRoute,
        );
        const signer = await requestEip7702SourceSignerFromExtension({
          signingPackageValue: route.signingPackage,
        });
        eip7702SignerRef.current = signer;
        setSigned(undefined);
        setSignedEip7702Package(route.signingPackage);
        setEip7702Result(undefined);
        setAuthorized(false);
        return;
      }

      const action = requireReviewedGaslessRoute(
        fresh.gaslessActions,
        intendedRoute,
      );
      const provider = await getOkxProvider();
      await connectOkxWallet(provider);
      await ensureRescueMainnet(provider, chainId);
      const account = await getOkxConnectedAccount(provider);
      setConnectedAccount(account);
      if (account.toLowerCase() !== source.toLowerCase()) {
        throw new Error("Switch OKX Wallet to the reported source account before signing.");
      }
      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http(chainConfig.rpcUrls[0]),
      });
      let result: SignedRecoveryAuthorization;
      if (action.standard === "ERC3009_RECEIVE_WITH_AUTHORIZATION") {
        result = await signEip3009Authorization(provider, action, account);
      } else {
        const destinationAccount = getAddress(action.to);
        if (action.standard === "ERC2612_PERMIT_SETTLEMENT") {
          result = await signErc2612Permit(provider, action, account);
          await publicClient.call({
            account: destinationAccount,
            to: result.authorization.settlementContract,
            data: result.settlementData,
          });
        } else if (action.standard === "DAI_PERMIT_SETTLEMENT") {
          result = await signDaiPermitPair(provider, action, account);
          await publicClient.call({
            account: destinationAccount,
            to: result.authorization.settlementContract,
            data: result.settlementData,
          });
        } else {
          result = await signErc4494Permit(provider, action, account);
          await publicClient.call({
            account: destinationAccount,
            to: result.authorization.settlementContract,
            data: result.settlementData,
          });
        }
      }
      eip7702SignerRef.current = undefined;
      setSignedEip7702Package(undefined);
      setSigned(result);
      setAuthorized(false);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function settleAuthorization() {
    if (!signed && !signedEip7702Package) {
      setError("Sign the source authorization before settlement.");
      return;
    }
    setBusy("SETTLE");
    setError(undefined);
    try {
      const provider = await getOkxProvider();
      await connectOkxWallet(provider);
      await ensureRescueMainnet(provider, chainId);
      const account = await getOkxConnectedAccount(provider);
      setConnectedAccount(account);
      if (account.toLowerCase() !== destination.toLowerCase()) {
        throw new Error("Switch OKX Wallet to the safe destination account before settlement.");
      }

      if (signedEip7702Package) {
        const signer = eip7702SignerRef.current;
        if (!signer) {
          clearSignedAuthorization();
          throw new Error(
            "The local EIP-7702 source authorization is no longer available. Run fresh preflight and sign again.",
          );
        }
        const payerAccount = privateKeyToAccount(generatePrivateKey());
        const payerSession = new ViemFundedEip7702PayerSession(
          chainConfig,
          chainConfig.rpcUrls[0],
          provider,
          getAddress(destination),
          getAddress(destination),
          payerAccount,
        );
        const gasBudget = await payerSession.calculateGasBudget(
          signedEip7702Package.actionIds.length,
        );
        let gasFunded = false;
        let executionError: unknown;
        let refundError: unknown;
        let result: Eip7702ExecutionResult | undefined;
        try {
          const fundingHash = await payerSession.fundGasBudget(gasBudget);
          gasFunded = true;
          setTransactions((current) => [
            ...current,
            {
              actionId: "EIP7702_TEMPORARY_GAS_FUNDING",
              hash: fundingHash,
              status: "CONFIRMED",
              reportStatus: "NOT_REQUIRED",
            },
          ]);
          const runtime = new LocalEip7702RescueRuntime({
            trustedFactory: XLAYER_SAFEEXIT_EIP7702_FACTORY_V2,
          });
          const provisioned = await runtime.provision(
            signedEip7702Package,
            {
              schemaVersion: "safeexit-buyer-confirmation-v1",
              packageId: signedEip7702Package.packageId,
              planHash: signedEip7702Package.planHash,
              chainId: signedEip7702Package.chainId,
              sourceAddress: signedEip7702Package.sourceAddress,
              destinationAddress: signedEip7702Package.destinationAddress,
              authorizationConfirmed: true,
              confirmedAt: new Date().toISOString(),
            },
            payerSession.transport,
          );
          const authorizedHandle = await runtime.authorize(provisioned, signer);
          clearSignedAuthorization();
          result = await runtime.execute(authorizedHandle);
          setEip7702Result(result);
        } catch (nextError) {
          executionError = nextError;
          if (nextError instanceof Eip7702RuntimeError) {
            setTransactions((current) => [
              ...current,
              ...nextError.transactionHashes.map((hash, index) => ({
                actionId: `EIP7702_SUBMITTED_UNRESOLVED_${index + 1}`,
                hash,
                status: "CONFIRMING" as const,
                reportStatus: "NOT_REQUIRED" as const,
              })),
            ]);
          }
        } finally {
          if (gasFunded) {
            try {
              const refund = await payerSession.refundUnusedGas();
              if (refund.transactionHash) {
                setTransactions((current) => [
                  ...current,
                  {
                    actionId: "EIP7702_UNUSED_GAS_REFUND",
                    hash: refund.transactionHash!,
                    status: "CONFIRMED",
                    reportStatus: "NOT_REQUIRED",
                  },
                ]);
              }
            } catch (nextRefundError) {
              refundError = nextRefundError;
            }
          }
        }
        if (executionError) throw executionError;
        if (!result) {
          throw new Error("The delegated rescue finished without a result");
        }

        const delegatedTransactions: SubmittedTransaction[] = [
          ...result.deploymentHashes.map((hash) => ({
            actionId: "EIP7702_DELEGATE_DEPLOYMENT",
            hash,
            status: "CONFIRMED" as const,
            reportStatus: "NOT_REQUIRED" as const,
          })),
          ...result.outcomes.flatMap((outcome) =>
            outcome.transactionHash
              ? [{
                  actionId: outcome.actionId,
                  hash: outcome.transactionHash,
                  status:
                    outcome.status === "COMPLETED"
                      ? "CONFIRMED" as const
                      : "FAILED" as const,
                  reportStatus: receiptBindings.some(
                    (binding) => binding.actionId === outcome.actionId,
                  )
                    ? "REPORTING" as const
                    : "NOT_REQUIRED" as const,
                }]
              : [],
          ),
          ...(result.clearTransactionHash
            ? [{
                actionId: "EIP7702_CLEAR_DELEGATION",
                hash: result.clearTransactionHash,
                status: "CONFIRMED" as const,
                reportStatus: "NOT_REQUIRED" as const,
              }]
            : []),
        ];
        setTransactions((current) => [...current, ...delegatedTransactions]);
        for (const outcome of result.outcomes) {
          if (outcome.transactionHash) {
            updateReportStatus(
              outcome.transactionHash,
              await reportTransactionReceipt(
                outcome.actionId,
                outcome.transactionHash,
              ),
            );
          }
        }
        await requestPreflight();
        const completionWarnings = [
          ...(result.status !== "COMPLETED"
            ? [
                `${result.outcomes.filter((outcome) => outcome.status !== "COMPLETED").length} of ${result.outcomes.length} delegated actions did not complete. The source delegation was cleared; review each asset outcome below before starting a fresh rescue for anything still present.`,
              ]
            : []),
          ...(refundError
            ? [
                `The rescue result was recorded, but unused temporary gas could not be returned: ${errorMessage(refundError)}`,
              ]
            : []),
        ];
        if (completionWarnings.length > 0) {
          setError(completionWarnings.join(" "));
        }
        return;
      }

      if (!signed) {
        throw new Error("The source authorization is unavailable.");
      }
      try {
        assertRecoveryAuthorizationCurrent(signed);
      } catch (authorizationError) {
        setSigned(undefined);
        throw authorizationError;
      }

      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http(chainConfig.rpcUrls[0]),
      });
      let hash: Hex;
      if (signed.standard === "ERC3009_RECEIVE_WITH_AUTHORIZATION") {
        await publicClient.call({
          account,
          to: signed.authorization.tokenAddress,
          data: signed.settlementData,
        });
        hash = await submitEip3009Settlement(provider, signed, account);
      } else if (signed.standard === "ERC2612_PERMIT_SETTLEMENT") {
        await publicClient.call({
          account,
          to: signed.authorization.settlementContract,
          data: signed.settlementData,
        });
        hash = await submitErc2612AtomicBatch(provider, signed, account);
      } else if (signed.standard === "DAI_PERMIT_SETTLEMENT") {
        await publicClient.call({
          account,
          to: signed.authorization.settlementContract,
          data: signed.settlementData,
        });
        hash = await submitDaiPermitAtomicBatch(provider, signed, account);
      } else {
        await publicClient.call({
          account,
          to: signed.authorization.settlementContract,
          data: signed.settlementData,
        });
        hash = await submitErc4494AtomicBatch(provider, signed, account);
      }
      setTransactions((current) => [
        ...current,
        {
          actionId: signed.authorization.actionId,
          hash,
          status: "CONFIRMING",
          reportStatus: receiptBindings.some(
            (binding) => binding.actionId === signed.authorization.actionId,
          ) ? "REPORTING" : "NOT_REQUIRED",
        },
      ]);
      updateReportStatus(
        hash,
        await reportTransactionReceipt(signed.authorization.actionId, hash),
      );
      const finalityPolicy = getRescueFinalityPolicy(chainId);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: finalityPolicy.minimumConfirmations,
        timeout: 900_000,
      });
      const transferProved = receipt.status === "success" &&
        receiptProvesCommittedTransfer(signed, receipt.logs);
      const status = transferProved ? "CONFIRMED" : "FAILED";
      setTransactions((current) =>
        current.map((item) => (item.hash === hash ? { ...item, status } : item)),
      );
      if (receipt.status !== "success") {
        throw new Error("The destination-paid settlement was included but reverted.");
      }
      if (!transferProved) {
        throw new Error(
          "The confirmed receipt does not prove the exact committed asset transfer.",
        );
      }
      updateReportStatus(
        hash,
        await reportTransactionReceipt(signed.authorization.actionId, hash),
      );
      clearSignedAuthorization();
      await requestPreflight();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="pb-12 sm:pb-16">
      <section className="content-shell border-x-2 border-b-2 border-border-strong bg-surface">
        <div className="px-5 py-8 sm:px-8 sm:py-10">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Badge variant="danger">User reported compromised</Badge>
                <Badge variant="success">Source pays 0 gas</Badge>
                <Badge variant="danger">Real funds</Badge>
              </div>
              <p className="font-mono text-[10px] font-bold uppercase text-dim">Incident {incidentId}</p>
              <h1 className="mt-2 text-3xl font-black sm:text-4xl">Destination-paid rescue</h1>
            </div>
            <Badge variant="info">{chainConfig.chain.name} / {chainId}</Badge>
          </div>
        </div>
      </section>

      <section className="content-shell grid border-x-2 border-b-2 border-border-strong bg-surface-raised md:grid-cols-2">
          <div className="min-w-0 border-b-2 border-border-strong p-5 sm:p-6 md:border-b-0 md:border-r-2">
            <div className="mb-2 flex items-center gap-2"><ShieldAlert className="size-3.5 text-danger" /><span className="font-mono text-[10px] font-bold uppercase text-dim">Source signs only</span></div>
            <CopyAddress address={source} />
          </div>
          <div className="min-w-0 p-5 sm:p-6">
            <div className="mb-2 flex items-center gap-2"><ShieldCheck className="size-3.5" /><span className="font-mono text-[10px] font-bold uppercase text-dim">Destination pays network fee</span></div>
            <CopyAddress address={destination} />
          </div>
      </section>

      <section className="content-shell border-x-2 border-b-2 border-border-strong bg-surface">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-10 p-5 sm:p-8 lg:p-10">
            <section>
              <div className="section-rule">
                <p className="font-mono text-[10px] font-bold uppercase text-info">01 / Deterministic scan</p>
                <h2 className="mt-2 text-xl font-black sm:text-2xl">Verify destination-paid asset paths</h2>
              </div>
              <label className="mt-5 block">
                <span className="mb-2 block text-sm font-semibold">Known ERC-20 contracts</span>
                <textarea
                  value={tokenInput}
                  onChange={(event) => setTokenInput(event.target.value)}
                  readOnly={manifestLocked}
                  rows={3}
                  placeholder="0x... one address per line"
                  spellCheck={false}
                  className="w-full resize-y rounded-[2px] border-2 border-border-strong bg-surface p-3 font-mono text-sm font-medium text-foreground placeholder:text-dim focus:bg-white focus:outline focus:outline-2"
                />
                <span className="mt-2 block text-xs leading-5 text-muted">Every submitted contract is verified independently at the same pinned block before authorization is enabled.</span>
              </label>
              <label className="mt-5 block">
                <span className="mb-2 block text-sm font-semibold">Known ERC-721 assets</span>
                <textarea
                  value={nftInput}
                  onChange={(event) => setNftInput(event.target.value)}
                  readOnly={manifestLocked}
                  rows={3}
                  placeholder="0xCollection:tokenId one per line"
                  spellCheck={false}
                  className="w-full resize-y rounded-[2px] border-2 border-border-strong bg-surface p-3 font-mono text-sm font-medium text-foreground placeholder:text-dim focus:bg-white focus:outline focus:outline-2"
                />
                <span className="mt-2 block text-xs leading-5 text-muted">Only explicitly listed token IDs are checked. ERC-4494 support and ownership are verified onchain before signing.</span>
              </label>
              <label className="mt-5 block">
                <span className="mb-2 block text-sm font-semibold">Known ERC-1155 assets</span>
                <textarea
                  value={erc1155Input}
                  onChange={(event) => setErc1155Input(event.target.value)}
                  readOnly={manifestLocked}
                  rows={3}
                  placeholder="0xCollection:tokenId one per line"
                  spellCheck={false}
                  className="w-full resize-y rounded-[2px] border-2 border-border-strong bg-surface p-3 font-mono text-sm font-medium text-foreground placeholder:text-dim focus:bg-white focus:outline focus:outline-2"
                />
                <span className="mt-2 block text-xs leading-5 text-muted">ERC-1155 balances are verified onchain. Assets remain blocked unless a destination-paid recovery adapter is available.</span>
              </label>
              {manifestLocked && (
                <p className="mt-4 text-xs leading-5 text-info">
                  This batch is committed to the incident. Start a new incident to change its asset contracts.
                </p>
              )}
              <Button type="button" className="mt-4" variant="secondary" onClick={() => void refreshPreflight()} disabled={busy !== null}>
                {busy === "PREFLIGHT" ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Run fresh preflight
              </Button>
            </section>

            <section>
              <div className="section-rule">
                <p className="font-mono text-[10px] font-bold uppercase text-info">02 / Rescue plan</p>
                <h2 className="mt-2 text-xl font-black sm:text-2xl">Destination-paid eligibility</h2>
              </div>
              {!preflight ? (
                <p className="mt-5 text-sm text-muted">Run preflight to read current mainnet state and verify token capabilities.</p>
              ) : preflight.plan.actions.length === 0 ? (
                <p className="mt-5 text-sm text-muted">No positive supported balances were detected for the current manifest.</p>
              ) : (
                <div className="mt-5 divide-y-2 divide-border-strong border-y-2 border-border-strong">
                  {preflight.plan.actions.map((action, index) => {
                    const gaslessRouteCount = preflight.gaslessActions.filter(
                      (item) => item.actionId === action.id,
                    ).length;
                    const delegatedDetected = preflight.eip7702Route?.signingPackage.actionIds.includes(
                      action.id,
                    ) ?? false;
                    const delegatedAvailable =
                      delegatedDetected && sourceSignerAvailable;
                    const recoverable =
                      gaslessRouteCount > 0 || delegatedAvailable;
                    const signerUnavailable =
                      delegatedDetected && !sourceSignerAvailable;
                    const signerChecking =
                      signerUnavailable &&
                      sourceSignerAvailability.status === "CHECKING";
                    const blocked = preflight.blockedActions.find((item) => item.actionId === action.id);
                    const simulation = preflight.simulations.find((item) => item.actionId === action.id);
                    const routeCount =
                      gaslessRouteCount + (delegatedAvailable ? 1 : 0);
                    const routeDescription = recoverable
                      ? signerUnavailable
                        ? `${routeCount} destination-paid route(s) ready. EIP-7702 is also detected, but the Source Signer is not available.`
                        : `${routeCount} destination-paid route(s) ready. Source authorization is local; destination submits.`
                      : signerChecking
                        ? "Checking for SafeExit Source Signer. EIP-7702 remains blocked until the extension responds."
                        : signerUnavailable
                          ? "SafeExit Source Signer was not detected. Install it, reload this page, and run preflight again to enable EIP-7702."
                          : blocked?.reason;
                    return (
                      <div key={action.id} className="grid gap-3 py-4 sm:grid-cols-[40px_1fr_auto] sm:items-start">
                        <span className="font-mono text-xs text-dim">{String(index + 1).padStart(2, "0")}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-extrabold capitalize">{actionLabel(action.actionType)}</p>
                          <div className="mt-1"><CopyAddress address={actionTarget(action)} compact /></div>
                          <p className="mt-2 text-xs leading-5 text-muted">{routeDescription}</p>
                          {signerUnavailable && !signerChecking && (
                            <Link
                              href="/source-signer"
                              className="mt-2 inline-flex font-mono text-[10px] font-bold uppercase text-info underline decoration-2 underline-offset-4"
                            >
                              Get Source Signer
                            </Link>
                          )}
                          <code className="mt-1 block truncate font-mono text-[11px] text-dim">State preflight: {simulation?.status ?? "NOT RUN"}</code>
                        </div>
                        <Badge variant={recoverable ? "success" : signerChecking ? "info" : "danger"}>
                          {recoverable ? "AUTHORIZATION READY" : signerChecking ? "CHECKING SIGNER" : "BLOCKED"}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <div className="section-rule">
                <p className="font-mono text-[10px] font-bold uppercase text-info">03 / Local signer handoff</p>
                <h2 className="mt-2 text-xl font-black sm:text-2xl">Source authorizes, destination pays</h2>
              </div>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div className="window-panel">
                  <div className="window-bar"><span className="window-dot" /><span className="window-dot" /><span className="ml-auto">source.account</span></div>
                  <div className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-extrabold">1. Source authorization</span>
                      <Badge
                        variant={
                          hasSignedAuthorization
                            ? "success"
                            : selectedEip7702Candidate
                              ? sourceSignerAvailable
                                ? "info"
                                : sourceSignerAvailability.status === "CHECKING"
                                  ? "info"
                                  : "danger"
                              : sourceConnected
                                ? "info"
                                : "neutral"
                        }
                      >
                        {hasSignedAuthorization
                          ? "SIGNED"
                          : selectedEip7702Candidate
                            ? sourceSignerAvailable
                              ? "EXTENSION READY"
                              : sourceSignerAvailability.status === "CHECKING"
                                ? "CHECKING"
                                : "NOT INSTALLED"
                            : sourceConnected
                              ? "ACTIVE"
                              : "STEP 1"}
                      </Badge>
                    </div>
                    {selectedEip7702Candidate ? (
                      <>
                        <p className="mt-3 text-xs font-semibold leading-5 text-muted">
                          {sourceSignerAvailable
                            ? "The SafeExit Source Signer extension reviews the fixed batch and signs delegation plus clearing locally. The source pays no gas."
                            : sourceSignerAvailability.status === "CHECKING"
                              ? "SafeExit is checking for the local Source Signer. EIP-7702 remains blocked until the extension responds."
                              : "The SafeExit Source Signer is required for this EIP-7702 route. Other verified permit routes remain available without it."}
                        </p>
                        {!sourceSignerAvailable &&
                          sourceSignerAvailability.status === "UNAVAILABLE" && (
                            <Link
                              href="/source-signer"
                              className="mt-3 inline-flex font-mono text-[10px] font-bold uppercase text-info underline decoration-2 underline-offset-4"
                            >
                              Get Source Signer
                            </Link>
                          )}
                      </>
                    ) : (
                      <>
                        <p className="mt-3 text-xs font-semibold leading-5 text-muted">Make the source active in OKX Wallet and sign typed data. It does not remain connected and pays no gas.</p>
                        <Button type="button" className="mt-4 w-full" variant="secondary" onClick={() => void connectExpected("SOURCE")} disabled={hasSignedAuthorization || busy !== null}>
                          <Wallet className="size-4" /> Use source account
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="window-panel">
                  <div className="window-bar"><span className="window-dot" /><span className="window-dot" /><span className="ml-auto">destination.account</span></div>
                  <div className="p-4">
                    <div className="flex items-center justify-between gap-3"><span className="text-sm font-extrabold">2. Safe destination</span><Badge variant={destinationConnected ? "success" : hasSignedAuthorization ? "info" : "neutral"}>{destinationConnected ? "ACTIVE" : hasSignedAuthorization ? "SWITCH NOW" : "AFTER SIGN"}</Badge></div>
                    <p className="mt-3 text-xs font-semibold leading-5 text-muted">After signing, switch the active OKX account to the destination. Keep this tab open so the authorization stays in memory.</p>
                    <Button type="button" className="mt-4 w-full" variant="secondary" onClick={() => void connectExpected("DESTINATION")} disabled={!hasSignedAuthorization || busy !== null}>
                      <Wallet className="size-4" /> Check destination account
                    </Button>
                  </div>
                </div>
              </div>
              {preflight && (preflight.gaslessActions.length > 0 || preflight.eip7702Route) && (
                <div className="mt-5">
                  <p className="mb-2 font-mono text-[10px] uppercase text-dim">Recovery route</p>
                  <div className="grid gap-2">
                    {preflight.eip7702Route && (
                      <div>
                        <button
                          type="button"
                          disabled={!sourceSignerAvailable}
                          onClick={() => {
                            setSelectedRoute(eip7702RouteKey(preflight.eip7702Route!));
                            clearSignedAuthorization();
                            setEip7702Result(undefined);
                          }}
                          className={`flex w-full items-center justify-between gap-4 border-2 border-border-strong px-3 py-3 text-left text-sm font-extrabold transition-colors disabled:cursor-not-allowed disabled:opacity-65 ${selectedEip7702Candidate ? "bg-accent/35" : "bg-surface hover:bg-surface-raised"}`}
                        >
                          <span>
                            <span className="block">SafeExit delegated batch</span>
                            <span className="mt-1 block font-mono text-[10px] uppercase text-dim">
                              EIP-7702 / {preflight.eip7702Route.signingPackage.actionIds.length} actions
                            </span>
                          </span>
                          <Badge
                            variant={
                              sourceSignerAvailable
                                ? "success"
                                : sourceSignerAvailability.status === "CHECKING"
                                  ? "info"
                                  : "danger"
                            }
                          >
                            {sourceSignerAvailable
                              ? "VERIFIED"
                              : sourceSignerAvailability.status === "CHECKING"
                                ? "CHECKING"
                                : "BLOCKED"}
                          </Badge>
                        </button>
                        {!sourceSignerAvailable &&
                          sourceSignerAvailability.status === "UNAVAILABLE" && (
                            <p className="border-x-2 border-b-2 border-border-strong bg-danger/10 px-3 py-2 text-xs font-semibold leading-5 text-muted">
                              Source Signer not detected.{" "}
                              <Link
                                href="/source-signer"
                                className="font-mono text-[10px] font-bold uppercase text-info underline decoration-2 underline-offset-4"
                              >
                                Get it from Chrome Web Store
                              </Link>
                              , reload this page, then run fresh preflight.
                            </p>
                          )}
                      </div>
                    )}
                    {preflight.gaslessActions.map((route) => (
                      <button
                        key={`${route.actionId}:${route.standard}`}
                        type="button"
                        onClick={() => {
                          setSelectedRoute(gaslessRouteKey(route));
                          clearSignedAuthorization();
                          setEip7702Result(undefined);
                        }}
                        className={`flex items-center justify-between gap-4 border-2 border-border-strong px-3 py-3 text-left text-sm font-extrabold transition-colors ${nextGaslessAction && gaslessRouteKey(nextGaslessAction) === gaslessRouteKey(route) ? "bg-accent/35" : "bg-surface hover:bg-surface-raised"}`}
                      >
                        <span>
                          <span className="block">{executionPathLabel(route.executionPath)}</span>
                          <span className="mt-1 block font-mono text-[10px] uppercase text-dim">
                            {authorizationStandardLabel(route.authorizationStandard)}
                          </span>
                        </span>
                        <Badge variant={route.capabilityStatus === "VERIFIED" ? "success" : "info"}>
                          {route.capabilityStatus === "VERIFIED" ? "VERIFIED" : "VERIFY ON SIGN"}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="paper-panel mt-5 flex flex-wrap items-center gap-3 bg-surface-muted p-3 text-sm font-semibold">
                <span className="text-muted">Current OKX account</span>
                {connectedAccount ? <CopyAddress address={connectedAccount} compact /> : <Badge variant="neutral">Not connected</Badge>}
              </div>
            </section>

            {transactions.length > 0 && (
              <section>
                <div className="section-rule"><p className="font-mono text-[10px] font-bold uppercase text-info">Execution status</p><h2 className="mt-2 text-xl font-black sm:text-2xl">Destination-paid execution</h2></div>
                {eip7702Result && (
                  <div className="mt-5">
                    <div className="paper-panel flex items-center justify-between gap-4 bg-surface-muted p-3">
                      <span className="text-xs font-bold">Delegated batch and canonical clearing</span>
                      <Badge variant={eip7702Result.status === "COMPLETED" ? "success" : eip7702Result.status === "FAILED" ? "danger" : "info"}>
                        {eip7702Result.status}
                      </Badge>
                    </div>
                    <div className="divide-y-2 divide-border-strong border-x-2 border-b-2 border-border-strong bg-surface">
                      {eip7702Result.outcomes.map((outcome) => {
                        const plannedAction = preflight?.plan.actions.find(
                          (action) => action.id === outcome.actionId,
                        );
                        const failure = delegatedOutcomeMessage(outcome);
                        return (
                          <div key={`${outcome.actionId}:${outcome.actionIndex}`} className="p-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <span className="text-xs font-extrabold">
                                {plannedAction
                                  ? actionLabel(plannedAction.actionType)
                                  : `Rescue action ${outcome.actionIndex + 1}`}
                              </span>
                              <Badge variant={outcome.status === "COMPLETED" ? "success" : "danger"}>
                                {outcome.status === "COMPLETED" ? "MOVED" : "NOT MOVED"}
                              </Badge>
                            </div>
                            {plannedAction && (
                              <div className="mt-2">
                                <CopyAddress address={actionTarget(plannedAction)} compact />
                              </div>
                            )}
                            {failure && (
                              <p className="mt-2 text-xs font-semibold leading-5 text-danger">
                                {failure}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="mt-5 space-y-4">
                  {transactions.map((transaction) => (
                    <div key={transaction.hash} className="border-l-2 border-border-strong pl-4">
                      <p className="mb-2 break-all font-mono text-[10px] font-bold uppercase text-dim">{transaction.actionId}</p>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={transaction.status === "CONFIRMED" ? "success" : transaction.status === "FAILED" ? "danger" : "info"}>{transaction.status}</Badge>
                        <Badge
                          variant={
                            transaction.reportStatus === "CONFIRMED" || transaction.reportStatus === "NOT_REQUIRED"
                              ? "success"
                              : ["REVERTED", "REJECTED", "ERROR"].includes(transaction.reportStatus)
                                ? "danger"
                                : "info"
                          }
                        >
                          {reportStatusLabel(transaction.reportStatus)}
                        </Badge>
                      </div>
                      {chainConfig.chain.blockExplorers?.default && (
                        <a href={`${chainConfig.chain.blockExplorers.default.url}/tx/${transaction.hash}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex max-w-full items-center gap-2 font-mono text-[11px] text-info hover:text-foreground"><span className="break-all">{transaction.hash}</span><ExternalLink className="size-3.5 shrink-0" /></a>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="self-start border-t-2 border-border-strong bg-surface-muted p-5 sm:p-7 lg:sticky lg:top-[76px] lg:border-l-2 lg:border-t-0">
            <p className="font-mono text-[10px] font-bold uppercase text-info">Authorization checkpoint</p>
            <h2 className="mt-2 text-xl font-black">Source-funded execution disabled</h2>
            <div className="mt-5 divide-y-2 divide-border-strong border-y-2 border-border-strong text-xs font-semibold [&>div]:py-3">
              <div className="flex justify-between gap-4"><span className="text-muted">Network</span><span>{chainConfig.chain.name}</span></div>
              <div className="space-y-2"><span className="block text-muted">Source signs</span><CopyAddress address={source} compact /></div>
              <div className="space-y-2"><span className="block text-muted">Destination receives and pays gas</span><CopyAddress address={destination} compact /></div>
              <div className="flex justify-between gap-4"><span className="text-muted">Execution path</span><span className="text-right">{selectedEip7702Candidate ? "SafeExit delegated batch" : nextGaslessAction ? executionPathLabel(nextGaslessAction.executionPath) : "None verified"}</span></div>
              {selectedEip7702Candidate && <div className="flex justify-between gap-4"><span className="text-muted">Authorization standard</span><span className="font-mono">EIP-7702</span></div>}
              {selectedEip7702Candidate && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted">Source Signer</span>
                  <Badge
                    variant={
                      sourceSignerAvailable
                        ? "success"
                        : sourceSignerAvailability.status === "CHECKING"
                          ? "info"
                          : "danger"
                    }
                  >
                    {sourceSignerAvailable
                      ? sourceSignerAvailability.status === "AVAILABLE"
                        ? `v${sourceSignerAvailability.extensionVersion}`
                        : "READY"
                      : sourceSignerAvailability.status === "CHECKING"
                        ? "CHECKING"
                        : "NOT DETECTED"}
                  </Badge>
                </div>
              )}
              {nextGaslessAction && <div className="flex justify-between gap-4"><span className="text-muted">Authorization standard</span><span className="font-mono">{authorizationStandardLabel(nextGaslessAction.authorizationStandard)}</span></div>}
              {selectedEip7702Candidate && <div className="flex justify-between gap-4"><span className="text-muted">Included actions</span><span className="font-mono">{selectedEip7702Candidate.signingPackage.actionIds.length}</span></div>}
              {selectedEip7702Candidate && <div className="space-y-2"><span className="block text-muted">Incident delegate</span><CopyAddress address={selectedEip7702Candidate.signingPackage.delegateAddress} compact /></div>}
              {nextGaslessAction && <div className="space-y-2"><span className="block text-muted">Asset contract</span><CopyAddress address={routeContract(nextGaslessAction)} compact /></div>}
              {nextGaslessAction && nextGaslessAction.standard !== "ERC3009_RECEIVE_WITH_AUTHORIZATION" && <div className="space-y-2"><span className="block text-muted">Settlement contract</span><CopyAddress address={nextGaslessAction.settlementContract} compact /></div>}
              {nextGaslessAction?.standard === "ERC4494_PERMIT_SETTLEMENT" && <div className="flex justify-between gap-4"><span className="text-muted">Token ID</span><span className="font-mono">{nextGaslessAction.tokenId}</span></div>}
              {selectedEip7702Candidate && <div className="flex justify-between gap-4"><span className="text-muted">Source authorizations</span><span className="font-mono">2</span></div>}
              {nextGaslessAction && nextGaslessAction.standard !== "ERC3009_RECEIVE_WITH_AUTHORIZATION" && <div className="flex justify-between gap-4"><span className="text-muted">Source signatures</span><span className="font-mono">{nextGaslessAction.requiredSignatures}</span></div>}
              <div className="flex justify-between gap-4"><span className="text-muted">Authorization</span><Badge variant={hasSignedAuthorization ? "success" : "neutral"}>{hasSignedAuthorization ? "SIGNED IN MEMORY" : "NOT SIGNED"}</Badge></div>
              {signedExpiresAt && <div className="flex justify-between gap-4"><span className="text-muted">Valid until</span><span className="font-mono">{signedExpiresAt} UTC</span></div>}
              <div className="flex justify-between gap-4"><span className="text-muted">Preflight block</span><span className="font-mono">{preflight?.scan.observedAtBlock ?? "--"}</span></div>
            </div>

            {!hasSignedAuthorization ? (
              <>
                {selectedEip7702Candidate && !sourceSignerAvailable && (
                  <div className="paper-panel mt-5 bg-danger/10 p-3 text-xs font-semibold leading-5">
                    <p>
                      {sourceSignerAvailability.status === "CHECKING"
                        ? "Checking for the SafeExit Source Signer. This EIP-7702 route remains blocked until the extension responds."
                        : "SafeExit Source Signer was not detected. Install it, reload this page, and run fresh preflight. Permit-based routes are unaffected."}
                    </p>
                    {sourceSignerAvailability.status === "UNAVAILABLE" && (
                      <Link
                        href="/source-signer"
                        className="mt-2 inline-flex font-mono text-[10px] font-bold uppercase text-info underline decoration-2 underline-offset-4"
                      >
                        Get Source Signer on Chrome Web Store
                      </Link>
                    )}
                  </div>
                )}
                <label className="mt-5 flex cursor-pointer items-start gap-3">
                  <Checkbox
                    checked={authorized}
                    disabled={Boolean(selectedEip7702Candidate && !sourceSignerAvailable)}
                    onChange={(event) => setAuthorized(event.target.checked)}
                  />
                  <span className="text-xs leading-5">I confirm I am authorised to control and sign for the displayed source wallet, and I understand this action uses {chainConfig.chain.name} with real assets.</span>
                </label>
                <Button type="button" className="mt-5 w-full" size="lg" onClick={() => void signAuthorization()} disabled={!selectedRecoveryRoute || !authorized || busy !== null || (!selectedEip7702Candidate && !sourceConnected)}>
                  {busy === "SIGN" ? <LoaderCircle className="size-4 animate-spin" /> : <FileSignature className="size-4" />}
                  {selectedEip7702Candidate
                    ? sourceSignerAvailable
                      ? "Authorize delegated rescue"
                      : "Source Signer required"
                    : "Sign gasless authorization"}
                </Button>
              </>
            ) : (
              <>
                <p className="paper-panel mt-5 flex items-start gap-2 bg-accent/30 p-3 text-xs font-semibold leading-5"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" />{signedEip7702Package ? "Delegation and clearing authorizations signed locally in the SafeExit extension." : "Authorization signed locally."} Without refreshing this page, switch OKX Wallet to the displayed destination account.</p>
                <Button type="button" className="mt-5 w-full" size="lg" onClick={() => void settleAuthorization()} disabled={busy !== null}>
                  {busy === "SETTLE" ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
                  {signedEip7702Package ? "Execute delegated rescue" : "Check destination and settle"}
                </Button>
              </>
            )}
            <p className="mt-4 text-xs font-semibold leading-5 text-muted">This action moves real assets. The authorization is short-lived and stays in this browser session. The SafeExit website and servers never receive the private key or seed phrase; the separately installed Source Signer handles it only inside the local extension popup.</p>
            {preflight?.blockedActions.some((item) => preflight.plan.actions.find((action) => action.id === item.actionId)?.actionType === "TRANSFER_NATIVE") && (
              <p className="paper-panel mt-4 flex items-start gap-2 bg-warning/25 p-3 text-xs font-semibold leading-5"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />Native {chainConfig.chain.nativeCurrency.symbol} is not included in the current signing package. It requires a fresh verified X Layer EIP-7702 route; no private-bundle fallback is configured.</p>
            )}
            {error && <p role="alert" className="paper-panel mt-4 flex items-start gap-2 bg-danger/15 p-3 text-xs font-bold leading-5 text-danger"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />{error}</p>}
          </aside>
        </div>
      </section>
    </main>
  );
}
