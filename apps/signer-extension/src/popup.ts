import {
  pendingSignerSessionSchema,
  type PendingSignerSession,
} from "./internal-protocol";
import { getAddress } from "viem";
import {
  LocalKeyInputError,
  takeEphemeralPrivateKeyBytes,
} from "./local-key";
import { WdkEip7702SourceSigner, WdkSignerError } from "./wdk-signer";

type InternalResponse =
  | {
      status: "OK";
      method?: string;
      session?: unknown;
      sourceAddress?: string;
      destinationAddress?: string;
    }
  | {
      status: "ERROR";
      code?: string;
      message?: string;
    };

let activeSession: PendingSignerSession | undefined;

function element<T extends HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing extension element: ${selector}`);
  return value;
}

function setNotice(message: string, success = false): void {
  const notice = element<HTMLElement>("#notice");
  notice.textContent = message;
  notice.classList.toggle("success", success);
}

function setBusy(busy: boolean): void {
  element<HTMLButtonElement>("#sign").disabled = busy;
  element<HTMLButtonElement>("#cancel").disabled = busy;
}

function renderEmpty(): void {
  activeSession = undefined;
  element<HTMLElement>("#state").textContent = "READY";
  element<HTMLElement>("#summary").textContent =
    "Open an active SafeExit incident and request local EIP-7702 signing.";
  element<HTMLElement>("#package").hidden = true;
  setNotice("No authorization has been requested.");
}

function renderSession(session: PendingSignerSession): void {
  activeSession = session;
  const review = session.review;
  const suffix = review.destinationAddress.slice(-6);

  element<HTMLElement>("#state").textContent = "REVIEW";
  element<HTMLElement>("#summary").textContent =
    "Verify every committed field before entering the source key.";
  element<HTMLElement>("#package").hidden = false;
  element<HTMLElement>("#source").textContent = review.sourceAddress;
  element<HTMLElement>("#destination").textContent =
    review.destinationAddress;
  element<HTMLElement>("#delegate").textContent = review.delegateAddress;
  element<HTMLElement>("#factory").textContent = review.factoryAddress;
  element<HTMLElement>("#plan-hash").textContent = review.planHash;
  element<HTMLElement>("#nonces").textContent =
    `${review.delegationAuthorization.nonce} / ${review.clearingAuthorization.nonce}`;
  element<HTMLElement>("#expires").textContent = new Date(
    review.expiresAt,
  ).toLocaleTimeString();
  element<HTMLElement>("#destination-suffix").textContent = suffix;

  const actions = element<HTMLOListElement>("#actions");
  actions.replaceChildren(
    ...review.actions.map((action) => {
      const item = document.createElement("li");
      item.textContent =
        `${action.label} | asset ${action.asset} | counterparty ` +
        `${action.counterparty} | amount ${action.amount} | token ID ${action.tokenId}`;
      return item;
    }),
  );
  setNotice(
    "This signs two chain-bound authorizations. The destination still pays gas on the SafeExit page.",
  );
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof LocalKeyInputError) {
    return "Enter one 32-byte hexadecimal source private key.";
  }
  if (
    error instanceof WdkSignerError &&
    error.code === "SOURCE_MISMATCH"
  ) {
    return "That key does not control the displayed source wallet.";
  }
  if (error instanceof WdkSignerError) {
    return "The local signer rejected an authorization outside the displayed scope.";
  }
  return "Signing failed locally. No key or authorization was stored.";
}

async function loadPendingSession(): Promise<void> {
  const response = await chrome.runtime.sendMessage<InternalResponse>({
    method: "SAFEEXIT_GET_PENDING_PACKAGE",
  });
  if (response.status !== "OK") {
    throw new Error("Pending session unavailable");
  }
  const parsed = pendingSignerSessionSchema.safeParse(response.session);
  if (!parsed.success) {
    renderEmpty();
    return;
  }
  renderSession(parsed.data);
}

async function signActiveSession(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const session = activeSession;
  if (!session) {
    renderEmpty();
    return;
  }

  const authorized = element<HTMLInputElement>("#authorized");
  const destinationConfirmation = element<HTMLInputElement>(
    "#destination-confirmation",
  );
  const privateKeyInput = element<HTMLInputElement>("#private-key");
  const expectedSuffix = session.review.destinationAddress.slice(-6);
  if (
    !authorized.checked ||
    destinationConfirmation.value.toLowerCase() !==
      expectedSuffix.toLowerCase()
  ) {
    setNotice(
      "Confirm authority and enter the displayed destination suffix before signing.",
    );
    return;
  }

  let privateKeyBytes: Uint8Array | undefined;
  let signer: WdkEip7702SourceSigner | undefined;
  setBusy(true);
  try {
    privateKeyBytes = takeEphemeralPrivateKeyBytes(privateKeyInput);
    signer = await WdkEip7702SourceSigner.takeOwnership({
      privateKeyBytes,
      policy: {
        chainId: session.review.chainId,
        sourceAddress: getAddress(session.review.sourceAddress),
        delegateAddress: getAddress(session.review.delegateAddress),
        sourceNonce: session.review.delegationAuthorization.nonce,
      },
    });
    const delegation = await signer.signAuthorization({
      ...session.review.delegationAuthorization,
      address: getAddress(session.review.delegationAuthorization.address),
    });
    const clearing = await signer.signAuthorization({
      ...session.review.clearingAuthorization,
      address: getAddress(session.review.clearingAuthorization.address),
    });

    const response = await chrome.runtime.sendMessage<InternalResponse>({
      method: "SAFEEXIT_COMPLETE_SIGNING",
      sessionId: session.sessionId,
      authorizations: { delegation, clearing },
    });
    if (response.status !== "OK") {
      throw new Error("Authorization delivery failed");
    }

    element<HTMLFormElement>("#sign-form").reset();
    element<HTMLElement>("#state").textContent = "SIGNED";
    setNotice(
      "Authorizations delivered to the originating SafeExit tab. Switch to the destination wallet there to simulate and submit.",
      true,
    );
    activeSession = undefined;
    element<HTMLButtonElement>("#sign").disabled = true;
    element<HTMLButtonElement>("#cancel").disabled = true;
  } catch (error) {
    setNotice(safeFailureMessage(error));
  } finally {
    signer?.dispose();
    privateKeyBytes?.fill(0);
    privateKeyInput.value = "";
    if (activeSession) setBusy(false);
  }
}

async function discardSession(): Promise<void> {
  const session = activeSession;
  if (!session) {
    renderEmpty();
    return;
  }
  setBusy(true);
  try {
    await chrome.runtime.sendMessage({
      method: "SAFEEXIT_CLEAR_PENDING_PACKAGE",
      sessionId: session.sessionId,
    });
  } finally {
    element<HTMLFormElement>("#sign-form").reset();
    renderEmpty();
    setBusy(false);
  }
}

element<HTMLFormElement>("#sign-form").addEventListener("submit", (event) => {
  void signActiveSession(event);
});
element<HTMLButtonElement>("#cancel").addEventListener("click", () => {
  void discardSession();
});

void loadPendingSession().catch(() => {
  element<HTMLElement>("#state").textContent = "UNAVAILABLE";
  element<HTMLElement>("#summary").textContent =
    "The extension background is unavailable.";
  element<HTMLElement>("#package").hidden = true;
  setNotice("No authorization can be signed. Close and reopen this extension.");
});
