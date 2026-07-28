import type { Metadata } from "next";
import Link from "next/link";
import {
  Download,
  ExternalLink,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Install Source Signer",
  description:
    "Install the SafeExit Source Signer from the Chrome Web Store for X Layer EIP-7702 rescue.",
};

const chromeWebStoreUrl =
  "https://chrome.google.com/webstore/detail/adgboaaoflpkecceingmfhfcnhbjmebe";
const extensionId = "adgboaaoflpkecceingmfhfcnhbjmebe";

const installSteps = [
  "Open the official SafeExit Source Signer listing in the Chrome Web Store.",
  "Select Add to Chrome and review the permissions shown by Chrome.",
  "Confirm Add extension, then pin SafeExit Source Signer from Chrome's Extensions menu.",
  "Open or reload safeexit.xyz after installation.",
  "Run a fresh incident preflight. An eligible EIP-7702 route should change from blocked to ready when the extension responds.",
] as const;

export default function SourceSignerPage() {
  return (
    <main className="pb-12 sm:pb-16">
      <section className="content-shell border-x-2 border-b-2 border-border-strong bg-surface">
        <div className="grid border-b-2 border-border-strong lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="px-5 py-10 sm:px-8 sm:py-12 lg:border-r-2 lg:border-border-strong lg:px-10">
            <p className="font-mono text-xs font-bold uppercase text-info">
              Source Signer / Version 0.1.0
            </p>
            <h1 className="mt-3 text-4xl font-black leading-tight sm:text-5xl">
              Enable X Layer EIP-7702 rescue
            </h1>
            <p className="mt-5 max-w-3xl text-base font-medium leading-7 text-muted">
              The Source Signer reviews a fixed SafeExit rescue package and
              signs its short-lived delegation and clearing authorizations
              locally. SafeExit&apos;s website and servers never receive the
              source private key.
            </p>
            <a
              href={chromeWebStoreUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-7 inline-flex min-h-12 w-full max-w-full items-center justify-center gap-2 border-2 border-border-strong bg-accent px-5 py-3 text-center text-sm font-black leading-5 hover:bg-accent/75 sm:w-auto"
            >
              <Download className="size-4" />
              Download Source Signer on Chrome Web Store
            </a>
          </div>

          <div className="bg-surface-muted p-5 sm:p-8">
            <p className="font-mono text-[10px] font-bold uppercase text-dim">
              Release status
            </p>
            <div className="mt-3 flex items-center gap-2">
              <span className="status-dot" />
              <span className="text-sm font-black">
                Published on Chrome Web Store
              </span>
            </div>
            <p className="mt-4 text-sm font-medium leading-6 text-muted">
              Install from the official Store listing so Chrome can verify the
              package source and deliver future Source Signer updates
              automatically.
            </p>
            <div className="mt-5 border-t-2 border-border-strong pt-4 font-mono text-[10px] font-bold uppercase leading-5 text-dim">
              <p>Chrome 127 or newer</p>
              <p>X Layer mainnet only</p>
              <p>safeexit.xyz only</p>
            </div>
          </div>
        </div>

        <section className="grid border-b-2 border-border-strong lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="border-b-2 border-border-strong px-5 py-7 sm:px-8 lg:border-b-0 lg:border-r-2 lg:px-10">
            <p className="font-mono text-[10px] font-bold text-dim">01</p>
            <h2 className="mt-2 text-xl font-black">Official distribution</h2>
          </div>
          <div className="min-w-0 space-y-4 px-5 py-7 sm:px-8 lg:px-10">
            <p className="text-sm font-semibold leading-6 text-muted">
              Install only from the official Chrome Web Store listing linked
              on this page. Do not install ZIP files or copies shared through
              chat, email, or support messages.
            </p>
            <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
              <span className="font-mono text-[10px] font-bold uppercase text-dim">
                Extension ID
              </span>
              <code className="break-all font-mono text-xs font-bold">
                {extensionId}
              </code>
              <span className="font-mono text-[10px] font-bold uppercase text-dim">
                Listing
              </span>
              <a
                href={chromeWebStoreUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-2 break-all font-mono text-xs font-bold underline decoration-2 underline-offset-4"
              >
                Chrome Web Store
                <ExternalLink className="size-3.5 shrink-0" />
              </a>
            </div>
          </div>
        </section>

        <section className="grid border-b-2 border-border-strong lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="border-b-2 border-border-strong px-5 py-7 sm:px-8 lg:border-b-0 lg:border-r-2 lg:px-10">
            <p className="font-mono text-[10px] font-bold text-dim">02</p>
            <h2 className="mt-2 text-xl font-black">Install from Chrome</h2>
          </div>
          <ol className="divide-y-2 divide-border-strong px-5 sm:px-8 lg:px-10">
            {installSteps.map((step, index) => (
              <li
                key={step}
                className="grid gap-3 py-5 sm:grid-cols-[36px_minmax(0,1fr)]"
              >
                <span className="font-mono text-xs font-bold text-dim">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="text-sm font-semibold leading-6">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="grid border-b-2 border-border-strong lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="border-b-2 border-border-strong px-5 py-7 sm:px-8 lg:border-b-0 lg:border-r-2 lg:px-10">
            <p className="font-mono text-[10px] font-bold text-dim">03</p>
            <h2 className="mt-2 text-xl font-black">Know the boundary</h2>
          </div>
          <div className="space-y-4 px-5 py-7 sm:px-8 lg:px-10">
            <p className="flex items-start gap-3 text-sm font-semibold leading-6">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-info" />
              The destination wallet never connects to this extension. It pays
              gas separately through the SafeExit execution flow.
            </p>
            <p className="flex items-start gap-3 text-sm font-semibold leading-6">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-info" />
              A source private key is entered only inside the extension popup
              after a validated, short-lived SafeExit request. Never paste it
              into the website, an agent chat, or support.
            </p>
            <p className="flex items-start gap-3 text-sm font-semibold leading-6">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
              This release has not received an independent external audit.
              EIP-7702 recovery is best effort, uses public transaction
              submission, and relies on beta wallet tooling.
            </p>
            <p className="flex items-start gap-3 text-sm font-semibold leading-6">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-info" />
              Confirm that Chrome shows extension ID {extensionId}. Remove any
              unpacked or unofficial copy before using the Store release.
            </p>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-5 px-5 py-6 sm:px-8 lg:px-10">
          <a
            href={chromeWebStoreUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 font-mono text-xs font-bold uppercase underline decoration-2 underline-offset-4"
          >
            Chrome Web Store listing
            <ExternalLink className="size-3.5" />
          </a>
          <Link
            href="/support"
            className="font-mono text-xs font-bold uppercase underline decoration-2 underline-offset-4"
          >
            Source Signer support
          </Link>
          <Link
            href="/privacy"
            className="font-mono text-xs font-bold uppercase underline decoration-2 underline-offset-4"
          >
            Privacy practices
          </Link>
        </div>
      </section>
    </main>
  );
}
