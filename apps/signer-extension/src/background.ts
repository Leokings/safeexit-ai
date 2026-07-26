import {
  PENDING_SIGNER_SESSION_STORAGE_KEY,
  pendingSignerSessionSchema,
  safeExitInternalRequestSchema,
  type PendingSignerSession,
} from "./internal-protocol";
import {
  SAFEEXIT_SIGNER_ALLOWED_ORIGINS,
  createEip7702ExtensionSigningResult,
  handleSafeExitSignerRequest,
} from "./protocol";
import { verifyEip7702FactoryPackage } from "./factory-verifier";

type MessageSender = {
  id?: string;
  url?: string;
  tab?: {
    id?: number;
    url?: string;
    windowId?: number;
  };
};

type InternalErrorCode =
  | "UNTRUSTED_ORIGIN"
  | "INVALID_REQUEST"
  | "NO_PENDING_PACKAGE"
  | "SESSION_MISMATCH"
  | "PACKAGE_EXPIRED"
  | "INVALID_AUTHORIZATION"
  | "DELIVERY_FAILED"
  | "INTERNAL_ERROR";

function errorResponse(code: InternalErrorCode, message: string) {
  return {
    status: "ERROR" as const,
    code,
    message,
  };
}

function senderOrigin(sender: MessageSender): string | undefined {
  const candidate = sender.tab?.url ?? sender.url;
  if (!candidate) return undefined;
  try {
    const origin = new URL(candidate).origin;
    return (SAFEEXIT_SIGNER_ALLOWED_ORIGINS as readonly string[]).includes(origin)
      ? origin
      : undefined;
  } catch {
    return undefined;
  }
}

function isTrustedExtensionContext(sender: MessageSender): boolean {
  return sender.id === chrome.runtime.id && !sender.tab;
}

async function removePendingSession(): Promise<void> {
  await chrome.storage.session.remove(PENDING_SIGNER_SESSION_STORAGE_KEY);
  await chrome.action.setBadgeText({ text: "" }).catch(() => undefined);
}

async function presentPendingSession(windowId?: number): Promise<void> {
  await Promise.allSettled([
    chrome.action.setBadgeText({ text: "SIGN" }),
    chrome.action.setBadgeBackgroundColor({ color: "#65d6b4" }),
  ]);
  await chrome.action
    .openPopup(windowId === undefined ? undefined : { windowId })
    .catch(() => undefined);
}

async function loadPendingSession(): Promise<
  PendingSignerSession | undefined
> {
  const stored = await chrome.storage.session.get(
    PENDING_SIGNER_SESSION_STORAGE_KEY,
  );
  const parsed = pendingSignerSessionSchema.safeParse(
    stored[PENDING_SIGNER_SESSION_STORAGE_KEY],
  );
  if (!parsed.success) {
    await removePendingSession();
    return undefined;
  }
  if (Date.parse(parsed.data.review.expiresAt) <= Date.now()) {
    await removePendingSession();
    return undefined;
  }
  return parsed.data;
}

async function handlePageRequest(
  request: Extract<
    ReturnType<typeof safeExitInternalRequestSchema.parse>,
    { method: "SAFEEXIT_HANDLE_PAGE_REQUEST" }
  >,
  sender: MessageSender,
) {
  const origin = senderOrigin(sender);
  const tabId = sender.tab?.id;
  if (!origin || tabId === undefined) {
    return errorResponse(
      "UNTRUSTED_ORIGIN",
      "SafeExit Source Signer rejected the website sender.",
    );
  }

  const response = handleSafeExitSignerRequest({
    origin,
    requestValue: request.request,
    extensionVersion: chrome.runtime.getManifest().version,
  });
  if (
    response.status === "OK" &&
    response.method === "REVIEW_EIP7702_PACKAGE" &&
    request.request.method === "REVIEW_EIP7702_PACKAGE"
  ) {
    try {
      await verifyEip7702FactoryPackage(request.request.signingPackage);
    } catch {
      return {
        status: "ERROR" as const,
        code: "UNTRUSTED_FACTORY" as const,
        message:
          "The extension could not independently verify the incident delegate against both official X Layer RPC endpoints.",
      };
    }
    const session = pendingSignerSessionSchema.parse({
      schemaVersion: "safeexit-pending-signer-session-v1",
      sessionId: crypto.randomUUID(),
      requestId: request.request.requestId,
      origin,
      tabId,
      stagedAt: new Date().toISOString(),
      review: response.review,
    });
    await chrome.storage.session.set({
      [PENDING_SIGNER_SESSION_STORAGE_KEY]: session,
    });
    await presentPendingSession(sender.tab?.windowId);
  }
  return response;
}

async function completeSigning(
  request: Extract<
    ReturnType<typeof safeExitInternalRequestSchema.parse>,
    { method: "SAFEEXIT_COMPLETE_SIGNING" }
  >,
) {
  const session = await loadPendingSession();
  if (!session) {
    return errorResponse(
      "NO_PENDING_PACKAGE",
      "No unexpired SafeExit signing package is staged.",
    );
  }
  if (session.sessionId !== request.sessionId) {
    return errorResponse(
      "SESSION_MISMATCH",
      "The signing response does not match the staged SafeExit session.",
    );
  }

  let result;
  try {
    result = await createEip7702ExtensionSigningResult({
      reviewValue: session.review,
      authorizationsValue: request.authorizations,
    });
  } catch {
    return errorResponse(
      "INVALID_AUTHORIZATION",
      "The extension rejected an invalid or expired authorization pair.",
    );
  }

  try {
    const acknowledgement = await chrome.tabs.sendMessage<{
      status?: string;
    }>(session.tabId, {
      method: "SAFEEXIT_SIGNING_RESULT",
      origin: session.origin,
      requestId: session.requestId,
      result,
    });
    if (acknowledgement?.status !== "OK") {
      return errorResponse(
        "DELIVERY_FAILED",
        "The SafeExit tab did not acknowledge the signed authorizations.",
      );
    }
  } catch {
    return errorResponse(
      "DELIVERY_FAILED",
      "The originating SafeExit tab is no longer available.",
    );
  }

  await removePendingSession();
  return {
    status: "OK" as const,
    method: "SAFEEXIT_COMPLETE_SIGNING" as const,
    packageId: result.packageId,
    sourceAddress: result.sourceAddress,
    destinationAddress: result.destinationAddress,
  };
}

async function routeMessage(message: unknown, sender: MessageSender) {
  const parsed = safeExitInternalRequestSchema.safeParse(message);
  if (!parsed.success) {
    return errorResponse(
      "INVALID_REQUEST",
      "The extension received an unsupported internal request.",
    );
  }

  if (parsed.data.method === "SAFEEXIT_HANDLE_PAGE_REQUEST") {
    return handlePageRequest(parsed.data, sender);
  }

  if (!isTrustedExtensionContext(sender)) {
    return errorResponse(
      "UNTRUSTED_ORIGIN",
      "Only a trusted extension page may access the local signer session.",
    );
  }

  if (parsed.data.method === "SAFEEXIT_INTERNAL_STATUS") {
    return {
      status: "OK" as const,
      extensionVersion: chrome.runtime.getManifest().version,
      signerState: "READY_FOR_EPHEMERAL_KEY" as const,
      supportedChainIds: [196] as const,
      privateCredentialsAccepted: false as const,
      extensionOnlyEphemeralKeyAccepted: true as const,
      destinationConnectsToExtension: false as const,
    };
  }

  if (parsed.data.method === "SAFEEXIT_GET_PENDING_PACKAGE") {
    return {
      status: "OK" as const,
      method: "SAFEEXIT_GET_PENDING_PACKAGE" as const,
      session: (await loadPendingSession()) ?? null,
    };
  }

  if (parsed.data.method === "SAFEEXIT_CLEAR_PENDING_PACKAGE") {
    const session = await loadPendingSession();
    if (session?.sessionId !== parsed.data.sessionId) {
      return errorResponse(
        "SESSION_MISMATCH",
        "The staged SafeExit session no longer matches.",
      );
    }
    await removePendingSession();
    return {
      status: "OK" as const,
      method: "SAFEEXIT_CLEAR_PENDING_PACKAGE" as const,
    };
  }

  return completeSigning(parsed.data);
}

void chrome.storage.session
  .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch(() => undefined);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void routeMessage(message, sender)
    .then(sendResponse)
    .catch(() => {
      sendResponse(
        errorResponse(
          "INTERNAL_ERROR",
          "The extension could not process the local signing request.",
        ),
      );
    });
  return true;
});
