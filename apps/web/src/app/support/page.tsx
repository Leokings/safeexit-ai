import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Source Signer Support",
  description:
    "Support and safe diagnostic guidance for the SafeExit Source Signer.",
};

const sections = [
  {
    title: "Before reporting a problem",
    body: [
      "Confirm that Chrome is version 127 or newer, the active tab is on safeexit.xyz, the incident is still valid, and the selected network is X Layer mainnet.",
      "If the extension reports an expired request, discard it and prepare a fresh signing package from the incident page. Never reuse an expired authorization.",
    ],
  },
  {
    title: "Safe details to include",
    body: [
      "Include the Source Signer version, Chrome version, incident ID, public wallet addresses, public transaction hash, the exact visible error message, and a screenshot with unrelated personal information removed.",
      "For an installed Store version, use the Support option on the SafeExit Source Signer Chrome Web Store listing to contact the publisher.",
    ],
  },
  {
    title: "Never send wallet secrets",
    body: [
      "Never send a seed phrase, private key, keystore, password, raw signed authorization, or recovery code to SafeExit support, a marketplace agent, a website, or another person.",
      "The SafeExit website never requests a source private key. During an EIP-7702 rescue, the key is entered only inside the separately installed Source Signer popup for one local signing session.",
    ],
  },
  {
    title: "Security and limitations",
    body: [
      "Stop immediately if the displayed source, destination, chain, delegate, action commitment, or expiry does not match the incident you initiated.",
      "Wallet recovery is best effort. Another party controlling the same source key may race, invalidate, or front-run a rescue before confirmation.",
    ],
  },
];

export default function SupportPage() {
  return (
    <main className="pb-12 sm:pb-16">
      <section className="content-shell border-x-2 border-b-2 border-border-strong bg-surface">
        <div className="border-b-2 border-border-strong px-5 py-10 sm:px-8 sm:py-12 lg:px-10">
          <p className="font-mono text-xs font-bold uppercase text-info">
            Source Signer / Support
          </p>
          <h1 className="mt-3 text-4xl font-black leading-tight sm:text-5xl">
            Diagnose without exposing secrets
          </h1>
          <p className="mt-5 max-w-3xl text-base font-medium leading-7 text-muted">
            SafeExit support only needs public incident evidence. Wallet
            credentials and signed authorizations must remain private.
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

        <div className="flex flex-wrap gap-5 border-t-2 border-border-strong px-5 py-6 sm:px-8 lg:px-10">
          <Link
            href="/source-signer"
            className="font-mono text-xs font-bold uppercase underline decoration-2 underline-offset-4"
          >
            Download and install Source Signer
          </Link>
          <Link
            href="/privacy"
            className="font-mono text-xs font-bold uppercase underline decoration-2 underline-offset-4"
          >
            Read Source Signer privacy practices
          </Link>
        </div>
      </section>
    </main>
  );
}
