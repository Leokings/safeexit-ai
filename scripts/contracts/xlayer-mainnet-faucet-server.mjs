import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { encodeFunctionData, getAddress, parseUnits } from "viem";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = resolve(rootDirectory, "contracts/deployments/xlayer-mainnet.json");
const recipientArgument = process.argv[2];
const amountArgument = process.argv[3] ?? "100";
const port = Number(process.env.SAFEEXIT_FAUCET_PORT?.trim() || "4176");

if (!recipientArgument) {
  throw new Error("Usage: node scripts/contracts/xlayer-mainnet-faucet-server.mjs <recipient> [amount]");
}
if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
  throw new Error("SAFEEXIT_FAUCET_PORT must be an integer from 1024 to 65535");
}

const recipient = getAddress(recipientArgument);
const amount = parseUnits(amountArgument, 18);
const erc20FaucetAbi = [{
  type: "function",
  name: "faucet",
  stateMutability: "nonpayable",
  inputs: [
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [],
}];
const requestedFixtures = [
  "SafeExitTestERC3009",
  "SafeExitTestERC2612",
  "SafeExitTestDaiPermit",
];

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.chainId !== 196) {
  throw new Error("The fixture manifest is not for X Layer mainnet");
}
const fixtures = requestedFixtures.map((contractName) => {
  const fixture = manifest.fixtures.find((candidate) => candidate.contractName === contractName);
  if (!fixture || fixture.status !== "VERIFIED") {
    throw new Error(`${contractName} is not a verified X Layer fixture`);
  }
  return {
    name: fixture.contractName,
    route: fixture.route,
    address: getAddress(fixture.address),
    data: encodeFunctionData({
      abi: erc20FaucetAbi,
      functionName: "faucet",
      args: [recipient, amount],
    }),
  };
});

const chain = {
  id: 196,
  idHex: "0xc4",
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"],
  explorerUrl: "https://www.okx.com/web3/explorer/xlayer",
};

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SafeExit Test Asset Faucet</title>
  <style>
    :root{font-family:Arial,sans-serif;color:#f6f7f2;background:#080b09}*{box-sizing:border-box}body{margin:0;min-height:100vh}.shell{width:min(780px,calc(100% - 32px));margin:48px auto}.eyebrow{font:12px monospace;color:#9ad7bd;text-transform:uppercase}.panel{border:1px solid #334039;background:#101511;padding:24px;margin-top:18px}.warning{border-left:3px solid #e6c172;background:#1b160b;padding:14px;color:#f8eac0;line-height:1.45}.grid{display:grid;grid-template-columns:175px 1fr;gap:12px;margin:24px 0;font-size:14px}.label{color:#aeb7b0}.value{font-family:monospace;overflow-wrap:anywhere}.fixtures{display:grid;gap:10px;margin:20px 0}.fixture{border:1px solid #334039;padding:14px}.fixture strong{display:block}.fixture span{font:12px monospace;color:#aeb7b0}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}button{min-height:44px;border:1px solid #64796d;background:#121815;color:#fff;padding:0 18px;font-weight:700;cursor:pointer}button.primary{background:#c5f3d7;color:#061109;border-color:#c5f3d7}button:disabled{opacity:.45;cursor:not-allowed}.status{margin-top:18px;min-height:22px;font-family:monospace;color:#c9d6cd;white-space:pre-wrap;overflow-wrap:anywhere}a{color:#a6e5c4}@media(max-width:620px){.shell{margin:24px auto}.panel{padding:18px}.grid{grid-template-columns:1fr}.label{margin-top:8px}}
  </style>
</head>
<body>
  <main class="shell">
    <div class="eyebrow">SafeExit operator utility / X Layer mainnet</div>
    <h1>Mint test-only recovery assets</h1>
    <section class="panel">
      <div class="warning">These assets are openly mintable TEST ONLY tokens with no monetary value. This page mints fixed test balances to the displayed recipient. It never asks for a seed phrase or private key.</div>
      <div class="grid">
        <div class="label">Recipient</div><div class="value">${recipient}</div>
        <div class="label">Per-token amount</div><div class="value">${amountArgument}</div>
        <div class="label">Network</div><div class="value">X Layer</div>
        <div class="label">Gas payer</div><div id="account" class="value">Connect OKX Wallet</div>
      </div>
      <div class="fixtures">${fixtures.map((fixture) => `<div class="fixture"><strong>${fixture.name}</strong><span>${fixture.route} · ${fixture.address}</span></div>`).join("")}</div>
      <div class="actions">
        <button id="connect">Connect OKX Wallet</button>
        <button id="mint" class="primary" disabled>Mint all three test balances</button>
      </div>
      <div id="status" class="status">Connect a wallet with a small amount of X Layer OKB for gas.</div>
    </section>
  </main>
  <script>
    const chain = ${JSON.stringify(chain)};
    const recipient = ${JSON.stringify(recipient)};
    const fixtures = ${JSON.stringify(fixtures)};
    let provider;
    let account;
    const status = document.getElementById("status");
    const mint = document.getElementById("mint");
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const providerCode = (error) => error && typeof error === "object" && "code" in error ? Number(error.code) : undefined;

    async function discoverOkx() {
      if (window.okxwallet) return window.okxwallet;
      const providers = Array.isArray(window.ethereum?.providers) ? window.ethereum.providers : [];
      const injected = providers.find((candidate) => candidate?.isOkxWallet || candidate?.isOKExWallet);
      if (injected || window.ethereum?.isOkxWallet || window.ethereum?.isOKExWallet) return injected || window.ethereum;
      let announced;
      const listener = (event) => {
        const detail = event.detail;
        const name = String(detail?.info?.name || "").toLowerCase();
        if (detail?.provider?.isOkxWallet || detail?.provider?.isOKExWallet || name === "okx wallet") announced = detail.provider;
      };
      window.addEventListener("eip6963:announceProvider", listener);
      window.dispatchEvent(new Event("eip6963:requestProvider"));
      await wait(500);
      window.removeEventListener("eip6963:announceProvider", listener);
      return announced;
    }

    async function ensureXLayer() {
      const current = await provider.request({ method: "eth_chainId" });
      if (String(current).toLowerCase() === chain.idHex) return;
      try {
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.idHex }] });
      } catch (error) {
        if (providerCode(error) !== 4902) throw error;
        await provider.request({ method: "wallet_addEthereumChain", params: [{
          chainId: chain.idHex,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: chain.rpcUrls,
          blockExplorerUrls: [chain.explorerUrl],
        }] });
      }
    }

    async function confirmReceipt(hash) {
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [hash] });
        if (receipt) {
          if (receipt.status !== "0x1") throw new Error("Faucet transaction reverted: " + hash);
          return;
        }
        await wait(2_000);
      }
      throw new Error("Timed out waiting for confirmation: " + hash);
    }

    document.getElementById("connect").addEventListener("click", async () => {
      try {
        provider = await discoverOkx();
        if (!provider) throw new Error("OKX Wallet was not detected. Enable it for this localhost page, then refresh.");
        const accounts = await provider.request({ method: "eth_requestAccounts" });
        if (!Array.isArray(accounts) || typeof accounts[0] !== "string") throw new Error("No wallet account returned");
        account = accounts[0];
        await ensureXLayer();
        document.getElementById("account").textContent = account;
        mint.disabled = false;
        status.textContent = "Ready. Your wallet will confirm three test-token faucet calls.";
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "Wallet connection failed";
      }
    });

    mint.addEventListener("click", async () => {
      mint.disabled = true;
      try {
        await ensureXLayer();
        const accounts = await provider.request({ method: "eth_accounts" });
        if (!Array.isArray(accounts) || String(accounts[0]).toLowerCase() !== account.toLowerCase()) throw new Error("The active wallet account changed; reconnect before minting");
        const hashes = [];
        for (const fixture of fixtures) {
          status.textContent = "Confirm faucet mint for " + fixture.name + " in OKX Wallet.";
          const hash = await provider.request({ method: "eth_sendTransaction", params: [{ from: account, to: fixture.address, value: "0x0", data: fixture.data }] });
          if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new Error("OKX Wallet returned an invalid transaction hash");
          hashes.push(hash);
          status.textContent = "Waiting for " + fixture.name + " confirmation.";
          await confirmReceipt(hash);
        }
        status.textContent = "All three balances were minted to " + recipient + ".\\n" + hashes.map((hash) => chain.explorerUrl + "/tx/" + hash).join("\\n");
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "Minting failed";
        mint.disabled = false;
      }
    });
  </script>
</body>
</html>`;

const server = createServer((request, response) => {
  if (request.url !== "/") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src https://rpc.xlayer.tech https://xlayerrpc.okx.com; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  response.end(page);
});

await new Promise((resolvePromise, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolvePromise);
});
process.stdout.write(`SAFEEXIT test-asset faucet: http://127.0.0.1:${port}/\n`);
