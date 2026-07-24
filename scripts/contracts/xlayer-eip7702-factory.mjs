import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  concatHex,
  createPublicClient,
  defineChain,
  getAddress,
  getCreate2Address,
  http,
  keccak256,
  stringToHex,
} from "viem";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(scriptDirectory, "../..");
const command = process.argv[2] ?? "prepare";
if (
  command !== "prepare" &&
  command !== "verify" &&
  command !== "estimate" &&
  command !== "serve"
) {
  throw new Error("Expected command: prepare, verify, estimate, or serve");
}

const xLayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"],
    },
  },
  blockExplorers: {
    default: {
      name: "OKX Explorer",
      url: "https://www.okx.com/web3/explorer/xlayer",
    },
  },
});

const create2Deployer = getAddress(
  "0x4e59b44847b379578588920cA78FbF26c0B4956C",
);
const expectedCreate2DeployerRuntime =
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";
const deploymentSalt = keccak256(
  stringToHex("SafeExit X Layer EIP-7702 rescue factory v1"),
);

function rpcUrl() {
  return (
    process.env.XLAYER_MAINNET_RPC_URL?.trim() ||
    process.env.OKX_XLAYER_MAINNET_RPC_URL?.trim() ||
    "https://rpc.xlayer.tech"
  );
}

async function loadArtifact() {
  const artifactPath = resolve(
    rootDirectory,
    "contracts/artifacts/contracts/src/SafeExit7702RescueDelegateFactory.sol/SafeExit7702RescueDelegateFactory.json",
  );
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  if (
    typeof artifact.bytecode !== "string" ||
    artifact.bytecode === "0x" ||
    typeof artifact.deployedBytecode !== "string" ||
    artifact.deployedBytecode === "0x"
  ) {
    throw new Error("SafeExit7702RescueDelegateFactory artifact is incomplete");
  }
  if (Object.keys(artifact.immutableReferences ?? {}).length !== 0) {
    throw new Error("Factory runtime unexpectedly contains immutable references");
  }
  return artifact;
}

async function serveDeploymentPage({
  bufferedMaximumCostWei,
  deploymentData,
  estimatedGas,
  expectedAddress,
  expectedRuntimeHash,
}) {
  if (deploymentVerified) {
    throw new Error(`Factory is already deployed at ${expectedAddress}`);
  }

  const port = Number(process.env.SAFEEXIT_7702_DEPLOYER_PORT?.trim() || "4177");
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error(
      "SAFEEXIT_7702_DEPLOYER_PORT must be an integer from 1024 to 65535",
    );
  }

  const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SAFEEXIT EIP-7702 Factory Deployment</title>
  <style>
    :root{color-scheme:dark;font-family:Arial,sans-serif;background:#070908;color:#f4f7f5}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#070908}.shell{width:min(780px,calc(100% - 32px));margin:48px auto}.eyebrow{font:12px monospace;color:#71d9aa;text-transform:uppercase}.panel{margin-top:18px;border:1px solid #29332f;background:#0d1110;padding:24px}.warning{border-left:3px solid #ff8f70;background:#17100e;padding:14px;color:#ffd8ce}.grid{display:grid;grid-template-columns:190px 1fr;gap:12px;margin:24px 0;font-size:14px}.label{color:#8d9a94}.value{font-family:monospace;overflow-wrap:anywhere}.actions{display:flex;gap:12px;flex-wrap:wrap}button{min-height:44px;border:1px solid #4f655c;background:#121815;color:#fff;padding:0 18px;font-weight:700;cursor:pointer}button.primary{background:#dfffee;color:#05100b;border-color:#dfffee}button:disabled{opacity:.45;cursor:not-allowed}.confirm{display:flex;align-items:flex-start;gap:10px;margin:22px 0;color:#c5cec9;font-size:14px}.status{margin-top:18px;min-height:22px;font-family:monospace;color:#9ddfbe}a{color:#9ddfbe}@media(max-width:620px){.shell{margin:24px auto}.panel{padding:18px}.grid{grid-template-columns:1fr}.label{margin-top:8px}}
  </style>
</head>
<body>
  <main class="shell">
    <div class="eyebrow">Operator-only / X Layer mainnet</div>
    <h1>Deploy EIP-7702 rescue factory</h1>
    <div class="panel">
      <div class="warning">IMPLEMENTATION TESTING. This deploys the fixed permissionless factory only. It does not activate EIP-7702 rescue on the public website.</div>
      <div class="grid">
        <div class="label">Expected factory</div><div class="value">${expectedAddress}</div>
        <div class="label">CREATE2 deployer</div><div class="value">${create2Deployer}</div>
        <div class="label">Runtime hash</div><div class="value">${expectedRuntimeHash}</div>
        <div class="label">Chain</div><div class="value">X Layer (196 / 0xc4)</div>
        <div class="label">Transaction value</div><div class="value">0 OKB</div>
        <div class="label">Connected account</div><div id="account" class="value">Connect wallet to check</div>
        <div class="label">Connected balance</div><div id="balance" class="value">Connect wallet to check</div>
        <div class="label">Estimated gas</div><div id="gas" class="value">${estimatedGas.toString()}</div>
        <div class="label">Buffered max cost</div><div id="cost" class="value">${bufferedMaximumCostWei.toString()} wei</div>
        <div class="label">Deployment transaction</div><div id="transaction" class="value">Not submitted</div>
      </div>
      <label class="confirm"><input id="risk" type="checkbox"> <span>I confirm this wallet may submit the fixed zero-value X Layer factory deployment and pay its gas.</span></label>
      <div class="actions">
        <button id="connect">Connect OKX Wallet</button>
        <button id="deploy" class="primary" disabled>Deploy fixed factory</button>
      </div>
      <div id="status" class="status">Waiting for operator.</div>
    </div>
  </main>
  <script>
    const deterministicDeployer = ${JSON.stringify(create2Deployer)};
    const expected = ${JSON.stringify(expectedAddress)};
    const data = ${JSON.stringify(deploymentData)};
    const chainId = "0xc4";
    const rpcUrls = ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"];
    const explorerUrl = "https://www.okx.com/web3/explorer/xlayer";
    const bufferedMaximumCost = ${JSON.stringify(
      bufferedMaximumCostWei.toString(),
    )};
    let provider;
    let account;
    let balanceSufficient = false;
    const status = document.getElementById("status");
    const deploy = document.getElementById("deploy");
    const risk = document.getElementById("risk");
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    function providerCode(error) {
      return error && typeof error === "object" && "code" in error
        ? Number(error.code)
        : undefined;
    }
    function errorMessage(error, fallback) {
      if (error instanceof Error && error.message) return error.message;
      if (error && typeof error === "object") {
        const code = "code" in error ? String(error.code) : "";
        const message = "message" in error ? String(error.message) : "";
        const detail =
          "data" in error && error.data && typeof error.data === "object" &&
          "message" in error.data
            ? String(error.data.message)
            : "";
        const parts = [message, detail, code ? "code " + code : ""].filter(Boolean);
        if (parts.length > 0) return parts.join(" / ");
      }
      return fallback;
    }
    async function discoverOkx() {
      if (window.okxwallet) return window.okxwallet;
      const providers = Array.isArray(window.ethereum?.providers)
        ? window.ethereum.providers
        : [];
      const injected = providers.find((candidate) =>
        candidate?.isOkxWallet === true || candidate?.isOKExWallet === true
      );
      if (injected) return injected;
      if (window.ethereum?.isOkxWallet === true || window.ethereum?.isOKExWallet === true) {
        return window.ethereum;
      }
      let announced;
      const listener = (event) => {
        const detail = event.detail;
        const name = String(detail?.info?.name || "").toLowerCase();
        const rdns = String(detail?.info?.rdns || "").toLowerCase();
        if (
          detail?.provider?.isOkxWallet === true ||
          detail?.provider?.isOKExWallet === true ||
          name === "okx wallet" ||
          rdns.includes("okx") ||
          rdns.includes("okex")
        ) announced = detail.provider;
      };
      window.addEventListener("eip6963:announceProvider", listener);
      window.dispatchEvent(new Event("eip6963:requestProvider"));
      await wait(500);
      window.removeEventListener("eip6963:announceProvider", listener);
      return announced;
    }
    async function ensureChain() {
      const current = await provider.request({ method: "eth_chainId" });
      if (String(current).toLowerCase() === chainId) return;
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId }],
        });
      } catch (error) {
        if (providerCode(error) !== 4902) throw error;
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId,
            chainName: "X Layer",
            nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
            rpcUrls,
            blockExplorerUrls: [explorerUrl],
          }],
        });
      }
    }
    function formatNativeWei(value) {
      const unit = 10n ** 18n;
      const whole = value / unit;
      const fraction = (value % unit)
        .toString()
        .padStart(18, "0")
        .replace(/0+$/, "")
        .slice(0, 8);
      return fraction ? whole.toString() + "." + fraction : whole.toString();
    }
    function refreshButton() {
      deploy.disabled = !(provider && account && balanceSufficient && risk.checked);
    }
    async function refreshEstimate() {
      const balanceHex = await provider.request({
        method: "eth_getBalance",
        params: [account, "latest"],
      });
      const balance = BigInt(balanceHex);
      const bufferedCost = BigInt(bufferedMaximumCost);
      document.getElementById("balance").textContent =
        formatNativeWei(balance) + " OKB (" + balance.toString() + " wei)";
      document.getElementById("cost").textContent =
        "up to approximately " + formatNativeWei(bufferedCost) + " OKB";
      balanceSufficient = balance >= bufferedCost;
      if (!balanceSufficient) {
        throw new Error("Connected account does not have enough OKB for the buffered gas estimate");
      }
      refreshButton();
    }
    risk.addEventListener("change", refreshButton);
    document.getElementById("connect").addEventListener("click", async () => {
      try {
        provider = await discoverOkx();
        if (!provider) {
          throw new Error("OKX Wallet was not detected for this localhost page");
        }
        const accounts = await provider.request({ method: "eth_requestAccounts" });
        if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
          throw new Error("No wallet account returned");
        }
        account = accounts[0];
        document.getElementById("account").textContent = account;
        await ensureChain();
        await refreshEstimate();
        status.textContent = "Connected and ready: " + account;
      } catch (error) {
        balanceSufficient = false;
        refreshButton();
        status.textContent = errorMessage(error, "Wallet connection failed");
      }
    });
    deploy.addEventListener("click", async () => {
      deploy.disabled = true;
      try {
        await ensureChain();
        const accounts = await provider.request({ method: "eth_accounts" });
        if (!Array.isArray(accounts) || String(accounts[0]).toLowerCase() !== account.toLowerCase()) {
          throw new Error("The active wallet account changed; reconnect before deployment");
        }
        const code = await provider.request({
          method: "eth_getCode",
          params: [expected, "latest"],
        });
        if (code && code !== "0x") {
          throw new Error("Code already exists at the expected factory address");
        }
        status.textContent = "Review the fixed deployment transaction in OKX Wallet.";
        const hash = await provider.request({
          method: "eth_sendTransaction",
          params: [{
            from: account,
            to: deterministicDeployer,
            value: "0x0",
            data,
          }],
        });
        if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
          throw new Error("OKX Wallet returned an invalid transaction hash");
        }
        const link = document.createElement("a");
        link.target = "_blank";
        link.rel = "noreferrer";
        link.href = explorerUrl + "/tx/" + hash;
        link.textContent = hash;
        const transactionElement = document.getElementById("transaction");
        transactionElement.textContent = "";
        transactionElement.appendChild(link);
        status.textContent = "Submitted. Waiting for confirmation.";
        for (let attempt = 0; attempt < 90; attempt += 1) {
          const receipt = await provider.request({
            method: "eth_getTransactionReceipt",
            params: [hash],
          });
          if (receipt) {
            if (receipt.status !== "0x1") {
              throw new Error("Deployment transaction reverted: " + hash);
            }
            const deployedCode = await provider.request({
              method: "eth_getCode",
              params: [expected, "latest"],
            });
            if (!deployedCode || deployedCode === "0x") {
              throw new Error("Receipt succeeded but expected factory code is missing");
            }
            status.textContent = "Confirmed. Return to Codex for independent runtime verification.";
            return;
          }
          await wait(2_000);
        }
        throw new Error("Confirmation timed out; inspect the transaction before retrying");
      } catch (error) {
        status.textContent = errorMessage(error, "Deployment failed");
        refreshButton();
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
      "Content-Security-Policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
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
  process.stdout.write(
    `SAFEEXIT EIP-7702 factory deployment page: http://127.0.0.1:${port}/\n`,
  );
}

const client = createPublicClient({
  chain: xLayer,
  transport: http(rpcUrl(), { retryCount: 2, timeout: 10_000 }),
});
const artifact = await loadArtifact();
const chainId = await client.getChainId();
if (chainId !== xLayer.id) {
  throw new Error(`RPC returned chain ${chainId}; expected X Layer ${xLayer.id}`);
}

const deployerCode = await client.getCode({ address: create2Deployer });
if (
  !deployerCode ||
  deployerCode.toLowerCase() !== expectedCreate2DeployerRuntime.toLowerCase()
) {
  throw new Error("The canonical deterministic deployment proxy is not verified");
}

const expectedAddress = getCreate2Address({
  from: create2Deployer,
  salt: deploymentSalt,
  bytecodeHash: keccak256(artifact.bytecode),
});
const expectedRuntimeHash = keccak256(artifact.deployedBytecode);
const deployedCode = await client.getCode({ address: expectedAddress });
const deploymentVerified =
  Boolean(deployedCode && deployedCode !== "0x") &&
  keccak256(deployedCode).toLowerCase() === expectedRuntimeHash.toLowerCase();
const deploymentData = concatHex([deploymentSalt, artifact.bytecode]);

if (command === "estimate") {
  if (!process.argv[3]) {
    throw new Error("estimate requires the connected deployment account address");
  }
  const account = getAddress(process.argv[3]);
  const transaction = {
    account,
    to: create2Deployer,
    value: 0n,
    data: deploymentData,
  };
  const [balance, estimatedGas, gasPrice] = await Promise.all([
    client.getBalance({ address: account }),
    client.estimateGas(transaction),
    client.getGasPrice(),
  ]);
  process.stdout.write(`${JSON.stringify({
    status: "ESTIMATED",
    chainId,
    account,
    balanceWei: balance.toString(),
    estimatedGas: estimatedGas.toString(),
    gasPriceWei: gasPrice.toString(),
    bufferedMaximumCostWei: (
      (estimatedGas * gasPrice * 12n) /
      10n
    ).toString(),
  }, null, 2)}\n`);
  process.exit(0);
}

if (command === "verify") {
  if (!deploymentVerified) {
    throw new Error(
      `EIP-7702 rescue factory is absent or has unexpected code at ${expectedAddress}`,
    );
  }
  process.stdout.write(`${JSON.stringify({
    status: "VERIFIED",
    chainId,
    factoryAddress: expectedAddress,
    factoryRuntimeHash: expectedRuntimeHash,
  }, null, 2)}\n`);
  process.exit(0);
}

if (command === "serve") {
  const estimatedGas = await client.estimateGas({
    account: "0x0000000000000000000000000000000000000001",
    to: create2Deployer,
    value: 0n,
    data: deploymentData,
  });
  const gasPrice = await client.getGasPrice();
  await serveDeploymentPage({
    bufferedMaximumCostWei: (estimatedGas * gasPrice * 12n) / 10n,
    deploymentData,
    estimatedGas,
    expectedAddress,
    expectedRuntimeHash,
  });
} else {
  process.stdout.write(`${JSON.stringify({
    status: deploymentVerified ? "ALREADY_DEPLOYED" : "READY_FOR_LOCAL_CONFIRMATION",
    chainId,
    factoryAddress: expectedAddress,
    factoryRuntimeHash: expectedRuntimeHash,
    deterministicDeployer: create2Deployer,
    deploymentSalt,
    transaction: deploymentVerified
      ? null
      : {
          to: create2Deployer,
          value: "0x0",
          data: deploymentData,
        },
    safety: [
      "This transaction deploys a permissionless factory with no owner, custody, upgrade, or fee role.",
      "The connected destination/operator wallet pays deployment gas.",
      "No private key, seed phrase, keystore, or signature is read by this script.",
      "Verify the canonical receipt and runtime hash before issuing any EIP-7702 package.",
    ],
  }, null, 2)}\n`);
}
