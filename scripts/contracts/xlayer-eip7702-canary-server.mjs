import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(scriptDirectory, "../..");
const port = Number(process.env.SAFEEXIT_7702_CANARY_PORT?.trim() || "4179");
if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
  throw new Error("SAFEEXIT_7702_CANARY_PORT must be an integer from 1024 to 65535");
}

const result = await build({
  absWorkingDir: rootDirectory,
  entryPoints: ["scripts/contracts/xlayer-eip7702-canary-client.ts"],
  bundle: true,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  format: "iife",
  minify: false,
  platform: "browser",
  target: ["es2022"],
  write: false,
});
const browserBundle = result.outputFiles[0]?.text;
if (!browserBundle) {
  throw new Error("EIP-7702 canary browser bundle was not generated");
}

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SAFEEXIT EIP-7702 No-Value Canary</title>
  <style>
    :root{color-scheme:dark;font-family:Arial,sans-serif;background:#070908;color:#f4f7f5}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#070908}.shell{width:min(900px,calc(100% - 32px));margin:42px auto}.eyebrow{font:12px monospace;color:#71d9aa;text-transform:uppercase}.panel{margin-top:18px;border:1px solid #29332f;background:#0d1110;padding:24px}.warning{border-left:3px solid #ff8f70;background:#17100e;padding:14px;color:#ffd8ce}.grid{display:grid;grid-template-columns:190px 1fr;gap:12px;margin:24px 0;font-size:14px}.label{color:#8d9a94}.value{font-family:monospace;overflow-wrap:anywhere}.actions{display:flex;gap:12px;flex-wrap:wrap}button{min-height:44px;border:1px solid #4f655c;background:#121815;color:#fff;padding:0 18px;font-weight:700;cursor:pointer}button.primary{background:#dfffee;color:#05100b;border-color:#dfffee}button:disabled{opacity:.45;cursor:not-allowed}.confirm{display:flex;align-items:flex-start;gap:10px;margin:22px 0;color:#c5cec9;font-size:14px}.status{margin-top:18px;min-height:22px;font-family:monospace;color:#9ddfbe}.transactions{margin-top:18px;border-top:1px solid #29332f;padding-top:14px}.transaction{font:12px monospace;margin:8px 0;overflow-wrap:anywhere}a{color:#9ddfbe}@media(max-width:620px){.shell{margin:24px auto}.panel{padding:18px}.grid{grid-template-columns:1fr}.label{margin-top:8px}}
  </style>
</head>
<body>
  <main class="shell">
    <div class="eyebrow">Operator-only / X Layer mainnet / no-value canary</div>
    <h1>Verify destination-paid EIP-7702 rescue and clearing</h1>
    <div class="panel">
      <div class="warning">Step 1 is read-only. Connect the intended source account and inspect the capabilities that OKX Wallet actually advertises on X Layer. This step does not sign an authorization, send a transaction, or move assets.</div>
      <div class="grid">
        <div class="label">Source capability account</div><div id="probe-account" class="value">Not connected</div>
        <div class="label">Reported capabilities</div><div id="probe-capabilities" class="value">Not checked</div>
        <div class="label">SafeExit conclusion</div><div id="probe-route" class="value">NOT CHECKED</div>
      </div>
      <div class="actions">
        <button id="probe-connect">Connect source for read-only check</button>
        <button id="probe-check" disabled>Check 7702 capabilities</button>
      </div>
      <div id="probe-status" class="status">No wallet request has been made.</div>
    </div>
    <div class="panel">
      <div class="warning">This creates fresh empty source and destination signers in memory and performs one fixed zero-allowance revocation on a TEST ONLY token. The connected OKX wallet funds a capped gas budget; the local destination signer submits genuine type-4 transactions and returns unused OKB. Do not close or refresh this tab after execution starts.</div>
      <div class="grid">
        <div class="label">OKX funding wallet</div><div id="funding" class="value">Not connected</div>
        <div class="label">Ephemeral destination signer</div><div id="destination" class="value">Not generated</div>
        <div class="label">Temporary gas budget</div><div id="gas" class="value">Not calculated</div>
        <div class="label">Ephemeral source</div><div id="source" class="value">Not generated</div>
        <div class="label">Incident delegate</div><div id="delegate" class="value">Not predicted</div>
        <div class="label">Fixed action</div><div id="action" class="value">Not prepared</div>
        <div class="label">Package expiry</div><div id="expiry" class="value">Not prepared</div>
        <div class="label">Exact simulation</div><div id="simulation" class="value">NOT RUN</div>
        <div class="label">Final evidence</div><div id="result" class="value">NOT RUN</div>
      </div>
      <label class="confirm"><input id="confirm" type="checkbox"> <span>I confirm this is the fixed no-value X Layer canary. My connected OKX wallet may temporarily fund the displayed capped gas budget, and unused OKB will be returned after execution.</span></label>
      <div class="actions">
        <button id="connect">Connect OKX funding wallet</button>
        <button id="prepare" disabled>Prepare ephemeral canary</button>
        <button id="execute" class="primary" disabled>Fund gas, execute and clear</button>
      </div>
      <div id="status" class="status">Waiting for operator.</div>
      <div id="transactions" class="transactions"></div>
    </div>
  </main>
  <script src="/canary.js"></script>
</body>
</html>`;

const server = createServer((request, response) => {
  if (request.url === "/") {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src https://rpc.xlayer.tech https://xlayerrpc.okx.com; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    response.end(page);
    return;
  }
  if (request.url === "/canary.js") {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/javascript; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(browserBundle);
    return;
  }
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

await new Promise((resolvePromise, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolvePromise);
});
process.stdout.write(
  `SAFEEXIT EIP-7702 no-value canary: http://127.0.0.1:${port}/\n`,
);
