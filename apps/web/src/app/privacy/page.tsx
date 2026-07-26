import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Source Signer Privacy",
  description:
    "Privacy practices for the SafeExit Source Signer browser extension.",
};

const sections = [
  {
    title: "Purpose and scope",
    body: [
      "This policy describes the SafeExit Source Signer browser extension. The extension has one purpose: review and locally sign short-lived, chain-bound EIP-7702 authorizations for a rescue plan initiated on safeexit.xyz.",
      "The extension does not act as a wallet, take custody of assets, broadcast rescue transactions, or authorize activity without an explicit signing request and confirmation.",
    ],
  },
  {
    title: "Source-key handling",
    body: [
      "A source private key is entered only inside the extension popup. It is used locally to create the displayed EIP-7702 delegation and clearing authorizations.",
      "The source private key is not transmitted to safeexit.xyz, SafeExit servers, blockchain RPC providers, analytics services, or any third party. It is not written to Chrome storage, browser storage, logs, or a SafeExit database. The input is cleared after the signing attempt.",
    ],
  },
  {
    title: "Other data processed",
    body: [
      "The extension processes public blockchain information needed to review a rescue: chain ID, source and destination addresses, factory and delegate addresses, action commitments, nonces, expiry, and plan hashes.",
      "Only pending request metadata and status are held in chrome.storage.session. Session data is removed when the request is completed, discarded, expires, or the browser session ends.",
    ],
  },
  {
    title: "Network access",
    body: [
      "The extension communicates only with safeexit.xyz and the two X Layer RPC endpoints declared in its production manifest. The SafeExit origin supplies the user-initiated signing package and receives the resulting authorization. The RPC endpoints receive read-only JSON-RPC requests used to verify the chain, factory bytecode, and predicted delegate.",
      "RPC operators may receive ordinary network metadata such as an IP address under their own policies. The extension does not execute remotely hosted code; all executable JavaScript and WebAssembly are packaged with the extension.",
    ],
  },
  {
    title: "Use, sharing, and retention",
    body: [
      "SafeExit does not sell extension data, use it for advertising, create behavioral profiles, or permit human review of source keys. Data is used only to provide the user-requested signing flow and protect the committed rescue destination and actions.",
      "The extension has no long-term data-retention mechanism. Public blockchain transactions submitted later by the destination wallet are governed by the relevant blockchain and are not erasable by SafeExit.",
    ],
  },
  {
    title: "Your choices and security",
    body: [
      "Do not use the extension unless you are authorised to control the displayed source wallet. You can discard a pending package, close the popup before signing, or uninstall the extension at any time.",
      "Wallet recovery is best effort. If another person controls the same source key, they may race or invalidate a rescue before confirmation. SafeExit cannot guarantee recovery.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="pb-12 sm:pb-16">
      <section className="content-shell border-x-2 border-b-2 border-border-strong bg-surface">
        <div className="border-b-2 border-border-strong px-5 py-10 sm:px-8 sm:py-12 lg:px-10">
          <p className="font-mono text-xs font-bold uppercase text-info">
            Source Signer / Privacy
          </p>
          <h1 className="mt-3 text-4xl font-black leading-tight sm:text-5xl">
            Local signing, narrow access
          </h1>
          <p className="mt-5 max-w-3xl text-base font-medium leading-7 text-muted">
            Effective July 26, 2026. This page explains exactly what the
            SafeExit Source Signer handles and where that information goes.
          </p>
        </div>

        <div className="divide-y-2 divide-border-strong">
          {sections.map((section, index) => (
            <section
              key={section.title}
              className="grid gap-5 px-5 py-8 sm:px-8 lg:grid-cols-[180px_minmax(0,1fr)] lg:px-10"
            >
              <div>
                <p className="font-mono text-[10px] font-bold text-dim">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h2 className="mt-2 text-xl font-black">{section.title}</h2>
              </div>
              <div className="max-w-3xl space-y-4 text-sm font-medium leading-6 text-muted sm:text-base sm:leading-7">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}
