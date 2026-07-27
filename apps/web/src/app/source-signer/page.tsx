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
    "Download and install the SafeExit Source Signer for X Layer EIP-7702 rescue.",
};

const archiveName = "safeexit-source-signer-0.1.0.zip";
const archiveUrl = `/downloads/${archiveName}`;
const sha256 =
  "ECA3896663C10C8883E82A1A44A1C9510C60CFDCB7ECA579E97715EBBB885CC5";

const installSteps = [
  "Download the ZIP only from this SafeExit page.",
  "Verify the SHA-256 checksum shown below before opening the archive.",
  "Extract the ZIP into a permanent folder. Do not select the ZIP itself in Chrome.",
  "Open chrome://extensions in Chrome and enable Developer mode.",
  "Select Load unpacked, then choose the extracted folder that contains manifest.json.",
  "Pin SafeExit Source Signer, reload safeexit.xyz, and run a fresh incident preflight.",
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
              href={archiveUrl}
              download
              className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 border-2 border-border-strong bg-accent px-5 text-sm font-black hover:bg-accent/75"
            >
              <Download className="size-4" />
              Download Source Signer 0.1.0
            </a>
          </div>

          <div className="bg-surface-muted p-5 sm:p-8">
            <p className="font-mono text-[10px] font-bold uppercase text-dim">
              Release status
            </p>
            <div className="mt-3 flex items-center gap-2">
              <span className="status-dot" />
              <span className="text-sm font-black">Chrome review pending</span>
            </div>
            <p className="mt-4 text-sm font-medium leading-6 text-muted">
              This is the same signed-off build submitted to the Chrome Web
              Store, but Google has not reviewed or approved it yet. Manual
              installations do not update automatically.
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
            <h2 className="mt-2 text-xl font-black">Verify the archive</h2>
          </div>
          <div className="min-w-0 px-5 py-7 sm:px-8 lg:px-10">
            <p className="text-sm font-semibold leading-6 text-muted">
              File: <span className="font-mono text-foreground">{archiveName}</span>
            </p>
            <p className="mt-3 break-all border-2 border-border-strong bg-surface-muted p-3 font-mono text-xs font-bold leading-5">
              SHA-256 {sha256}
            </p>
            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              <div>
                <p className="mb-2 font-mono text-[10px] font-bold uppercase text-dim">
                  Windows PowerShell
                </p>
                <code className="block overflow-x-auto border-2 border-border-strong bg-surface-muted p-3 font-mono text-xs">
                  Get-FileHash .\{archiveName} -Algorithm SHA256
                </code>
              </div>
              <div>
                <p className="mb-2 font-mono text-[10px] font-bold uppercase text-dim">
                  macOS or Linux
                </p>
                <code className="block overflow-x-auto border-2 border-border-strong bg-surface-muted p-3 font-mono text-xs">
                  shasum -a 256 {archiveName}
                </code>
              </div>
            </div>
          </div>
        </section>

        <section className="grid border-b-2 border-border-strong lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="border-b-2 border-border-strong px-5 py-7 sm:px-8 lg:border-b-0 lg:border-r-2 lg:px-10">
            <p className="font-mono text-[10px] font-bold text-dim">02</p>
            <h2 className="mt-2 text-xl font-black">Install unpacked</h2>
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
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
              Once the Chrome Web Store version is approved, remove this
              unpacked build and install the Store version to receive reviewed
              updates.
            </p>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-5 px-5 py-6 sm:px-8 lg:px-10">
          <a
            href="https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 font-mono text-xs font-bold uppercase underline decoration-2 underline-offset-4"
          >
            Chrome load-unpacked guide
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
