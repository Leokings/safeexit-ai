import {
  safeExitTabSigningResultMessageSchema,
} from "./internal-protocol";
import {
  SAFEEXIT_EXTENSION_SOURCE,
  SAFEEXIT_SIGNER_CHANNEL,
  SAFEEXIT_WEB_SOURCE,
  extensionEnvelope,
  safeExitPageEnvelopeSchema,
  safeExitSigningAcceptanceEnvelopeSchema,
  safeExitSignerResponseSchema,
} from "./protocol";

type PendingSigningDelivery = {
  retryId: number;
  timeoutId: number;
  sendResponse: (response: { status: "OK" | "ERROR" }) => void;
};

const pendingSigningDeliveries = new Map<string, PendingSigningDelivery>();

function invalidRequestResponse() {
  return {
    status: "ERROR" as const,
    code: "INVALID_REQUEST" as const,
    message: "The website sent an invalid source-signer request.",
  };
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    !event.data ||
    typeof event.data !== "object" ||
    !("source" in event.data) ||
    event.data.source !== SAFEEXIT_WEB_SOURCE ||
    !("channel" in event.data) ||
    event.data.channel !== SAFEEXIT_SIGNER_CHANNEL
  ) {
    return;
  }

  const acceptance =
    safeExitSigningAcceptanceEnvelopeSchema.safeParse(event.data);
  if (acceptance.success) {
    const delivery = pendingSigningDeliveries.get(
      acceptance.data.requestId,
    );
    if (!delivery) return;
    window.clearInterval(delivery.retryId);
    window.clearTimeout(delivery.timeoutId);
    pendingSigningDeliveries.delete(acceptance.data.requestId);
    delivery.sendResponse({ status: "OK" });
    return;
  }

  const parsedEnvelope = safeExitPageEnvelopeSchema.safeParse(event.data);
  const requestId = parsedEnvelope.success
    ? parsedEnvelope.data.request.requestId
    : "invalid_request";
  if (!parsedEnvelope.success) {
    window.postMessage(
      extensionEnvelope(requestId, invalidRequestResponse()),
      event.origin,
    );
    return;
  }

  void chrome.runtime
    .sendMessage({
      method: "SAFEEXIT_HANDLE_PAGE_REQUEST",
      request: parsedEnvelope.data.request,
    })
    .then((response) => {
      const parsedResponse = safeExitSignerResponseSchema.safeParse(response);
      window.postMessage(
        extensionEnvelope(
          requestId,
          parsedResponse.success
            ? parsedResponse.data
            : invalidRequestResponse(),
        ),
        event.origin,
      );
    })
    .catch(() => {
      window.postMessage(
        extensionEnvelope(requestId, {
          status: "ERROR",
          code: "SIGNER_NOT_CONFIGURED",
          message: "The local SafeExit signer background is unavailable.",
        }),
        event.origin,
      );
    });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const parsed = safeExitTabSigningResultMessageSchema.safeParse(message);
  if (
    !parsed.success ||
    parsed.data.origin !== window.location.origin
  ) {
    sendResponse({ status: "ERROR" });
    return false;
  }

  const previous = pendingSigningDeliveries.get(parsed.data.requestId);
  if (previous) {
    window.clearInterval(previous.retryId);
    window.clearTimeout(previous.timeoutId);
    previous.sendResponse({ status: "ERROR" });
    pendingSigningDeliveries.delete(parsed.data.requestId);
  }

  const signingEvent = {
    source: SAFEEXIT_EXTENSION_SOURCE,
    channel: SAFEEXIT_SIGNER_CHANNEL,
    event: "EIP7702_AUTHORIZATIONS_SIGNED",
    requestId: parsed.data.requestId,
    result: parsed.data.result,
  } as const;
  const postSigningEvent = () => {
    window.postMessage(signingEvent, parsed.data.origin);
  };
  const retryId = window.setInterval(postSigningEvent, 250);
  const timeoutId = window.setTimeout(() => {
    const delivery = pendingSigningDeliveries.get(parsed.data.requestId);
    if (!delivery) return;
    window.clearInterval(delivery.retryId);
    pendingSigningDeliveries.delete(parsed.data.requestId);
    delivery.sendResponse({ status: "ERROR" });
  }, 10_000);
  pendingSigningDeliveries.set(parsed.data.requestId, {
    retryId,
    timeoutId,
    sendResponse,
  });
  postSigningEvent();
  return true;
});

window.postMessage(
  {
    source: SAFEEXIT_EXTENSION_SOURCE,
    channel: SAFEEXIT_SIGNER_CHANNEL,
    event: "READY",
    signerState: "READY_FOR_EPHEMERAL_KEY",
  },
  window.location.origin,
);
