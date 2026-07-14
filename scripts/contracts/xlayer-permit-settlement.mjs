import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  concatHex,
  createPublicClient,
  defineChain,
  getAddress,
  getCreate2Address,
  hashDomain,
  http,
  keccak256,
  stringToHex,
  zeroHash,
} from "viem";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(scriptDirectory, "../..");
const requestedCommand = process.argv[2] ?? "prepare";
const targetVersion = requestedCommand.endsWith("-v1") ? "1" : "2";
const command = requestedCommand.replace(/-v1$/, "");
const target = targetVersion === "1"
  ? {
      sourceName: "SafeExitPermitSettlement.sol",
      contractName: "SafeExitPermitSettlement",
      deploymentName: "xlayer-permit-settlement-v1.json",
      saltLabel: "SafeExit X Layer permit settlement v1:SafeExitPermitSettlement",
    }
  : {
      sourceName: "SafeExitPermitSettlementV2.sol",
      contractName: "SafeExitPermitSettlementV2",
      deploymentName: "xlayer-permit-settlement.json",
      saltLabel: "SafeExit X Layer permit settlement v2:SafeExitPermitSettlementV2",
    };
const { sourceName, contractName } = target;
const deploymentFile = resolve(
  rootDirectory,
  `contracts/deployments/${target.deploymentName}`,
);
const factoryAddress = getAddress("0x4e59b44847b379578588920cA78FbF26c0B4956C");
const expectedFactoryRuntime =
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";
const deploymentSalt = keccak256(
  stringToHex(target.saltLabel),
);

const xLayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.xlayer.tech"] } },
});

const settlementDomain = {
  name: "SafeExit Permit Settlement",
  version: targetVersion,
};
const eip712DomainTypes = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
};

const verificationAbi = [
  {
    type: "function",
    name: "eip712Domain",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" },
    ],
  },
  {
    type: "function",
    name: "PERMIT_KIND_ERC2612",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "PERMIT_KIND_DAI",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "ERC20_RESCUE_TYPEHASH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "ERC721_RESCUE_TYPEHASH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
];

function rpcUrl() {
  return process.env.XLAYER_RPC_URL?.trim() || xLayer.rpcUrls.default.http[0];
}

async function loadArtifact() {
  const artifactPath = resolve(
    rootDirectory,
    `contracts/artifacts/contracts/src/${sourceName}/${contractName}.json`,
  );
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  if (typeof artifact.bytecode !== "string" || !artifact.bytecode.startsWith("0x")) {
    throw new Error(`${contractName} has no deployable bytecode`);
  }
  if (typeof artifact.buildInfoId !== "string" || !artifact.buildInfoId) {
    throw new Error(`${contractName} artifact has no build info identifier`);
  }
  const buildOutputPath = resolve(
    rootDirectory,
    `contracts/artifacts/build-info/${artifact.buildInfoId}.output.json`,
  );
  const buildOutput = JSON.parse(await readFile(buildOutputPath, "utf8"));
  const immutableIds = new Set(Object.keys(artifact.immutableReferences ?? {}));
  const immutableNames = {};
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (
      value.nodeType === "VariableDeclaration" &&
      Number.isInteger(value.id) &&
      immutableIds.has(String(value.id)) &&
      typeof value.name === "string"
    ) {
      immutableNames[String(value.id)] = value.name;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(buildOutput.output?.sources);
  const unresolvedIds = [...immutableIds].filter((id) => !immutableNames[id]);
  if (unresolvedIds.length > 0) {
    throw new Error(`Unable to resolve immutable AST ids: ${unresolvedIds.join(", ")}`);
  }
  return { ...artifact, immutableNames };
}

async function createVerifiedClient() {
  const client = createPublicClient({ chain: xLayer, transport: http(rpcUrl()) });
  const actualChainId = await client.getChainId();
  if (actualChainId !== xLayer.id) {
    throw new Error(`Expected X Layer chain ID 196, received ${actualChainId}`);
  }
  const factoryRuntime = await client.getCode({ address: factoryAddress });
  if (!factoryRuntime || factoryRuntime.toLowerCase() !== expectedFactoryRuntime.toLowerCase()) {
    throw new Error("The canonical CREATE2 deployment proxy runtime does not match on X Layer");
  }
  return client;
}

function maskImmutables(bytecode, immutableReferences) {
  let body = bytecode.slice(2).toLowerCase();
  for (const references of Object.values(immutableReferences ?? {})) {
    for (const { start, length } of references) {
      const offset = start * 2;
      body = `${body.slice(0, offset)}${"0".repeat(length * 2)}${body.slice(offset + length * 2)}`;
    }
  }
  return `0x${body}`;
}

function uint256Word(value) {
  const body = BigInt(value).toString(16);
  if (body.length > 64) throw new Error("Immutable uint256 exceeds one EVM word");
  return `0x${body.padStart(64, "0")}`;
}

function addressWord(value) {
  const body = getAddress(value).slice(2).toLowerCase();
  return `0x${body.padStart(64, "0")}`;
}

function shortStringWord(value) {
  const body = stringToHex(value).slice(2);
  const byteLength = body.length / 2;
  if (!Number.isInteger(byteLength) || byteLength > 31) {
    throw new Error("Expected an OpenZeppelin ShortString-compatible immutable");
  }
  return `0x${body.padEnd(62, "0")}${byteLength.toString(16).padStart(2, "0")}`;
}

function expectedImmutableValues(address) {
  return {
    _cachedDomainSeparator: hashDomain({
      domain: {
        ...settlementDomain,
        chainId: xLayer.id,
        verifyingContract: address,
      },
      types: eip712DomainTypes,
    }),
    _cachedChainId: uint256Word(xLayer.id),
    _cachedThis: addressWord(address),
    _hashedName: keccak256(stringToHex(settlementDomain.name)),
    _hashedVersion: keccak256(stringToHex(settlementDomain.version)),
    _name: shortStringWord(settlementDomain.name),
    _version: shortStringWord(settlementDomain.version),
  };
}

function applyExpectedImmutables(bytecode, immutableReferences, immutableNames, address) {
  let body = bytecode.slice(2).toLowerCase();
  const values = expectedImmutableValues(address);
  for (const [id, references] of Object.entries(immutableReferences ?? {})) {
    const name = immutableNames[id];
    const word = values[name];
    if (!word || !/^0x[0-9a-f]{64}$/i.test(word)) {
      throw new Error(`No expected immutable value is defined for ${name ?? id}`);
    }
    for (const { start, length } of references) {
      if (length !== 32) throw new Error(`Unexpected immutable length for ${name}: ${length}`);
      const offset = start * 2;
      body = `${body.slice(0, offset)}${word.slice(2).toLowerCase()}${body.slice(offset + length * 2)}`;
    }
  }
  return `0x${body}`;
}

async function verifyBehavior(client, address) {
  try {
    const [domain, erc2612Kind, daiKind, erc20Typehash, erc721Typehash] =
      await Promise.all([
        client.readContract({ address, abi: verificationAbi, functionName: "eip712Domain" }),
        client.readContract({ address, abi: verificationAbi, functionName: "PERMIT_KIND_ERC2612" }),
        client.readContract({ address, abi: verificationAbi, functionName: "PERMIT_KIND_DAI" }),
        client.readContract({ address, abi: verificationAbi, functionName: "ERC20_RESCUE_TYPEHASH" }),
        client.readContract({ address, abi: verificationAbi, functionName: "ERC721_RESCUE_TYPEHASH" }),
      ]);
    const [fields, name, version, chainId, verifyingContract, salt, extensions] = domain;
    const expectedErc20Typehash = keccak256(stringToHex(
      "ERC20Rescue(address token,address owner,address destination,uint256 amount,uint256 permitNonce,uint256 deadline,bytes32 rescueNonce,uint8 permitKind)",
    ));
    const expectedErc721Typehash = keccak256(stringToHex(
      "ERC721Rescue(address collection,address owner,address destination,uint256 tokenId,uint256 permitNonce,uint256 deadline,bytes32 rescueNonce)",
    ));
    const verified =
      fields === "0x0f" &&
      name === settlementDomain.name &&
      version === settlementDomain.version &&
      chainId === 196n &&
      verifyingContract.toLowerCase() === address.toLowerCase() &&
      salt === zeroHash &&
      extensions.length === 0 &&
      erc2612Kind === 1 &&
      daiKind === 2 &&
      erc20Typehash === expectedErc20Typehash &&
      erc721Typehash === expectedErc721Typehash;
    return verified
      ? { verified: true, reason: null }
      : { verified: false, reason: "Settlement constants or EIP-712 domain mismatch" };
  } catch (error) {
    return {
      verified: false,
      reason: error instanceof Error ? error.message.slice(0, 240) : "Behavior verification failed",
    };
  }
}

async function prepareOrVerify() {
  const artifact = await loadArtifact();
  const client = await createVerifiedClient();
  const initCodeHash = keccak256(artifact.bytecode);
  const address = getCreate2Address({
    from: factoryAddress,
    salt: deploymentSalt,
    bytecodeHash: initCodeHash,
  });
  const [runtime, blockNumber] = await Promise.all([
    client.getCode({ address }),
    client.getBlockNumber(),
  ]);
  const expectedRuntime = applyExpectedImmutables(
    artifact.deployedBytecode,
    artifact.immutableReferences,
    artifact.immutableNames,
    address,
  );
  const expectedRuntimeHash = keccak256(expectedRuntime);
  const expectedTemplateHash = keccak256(
    maskImmutables(artifact.deployedBytecode, artifact.immutableReferences),
  );
  const actualRuntimeHash = runtime ? keccak256(runtime) : null;
  const actualTemplateHash = runtime
    ? keccak256(maskImmutables(runtime, artifact.immutableReferences))
    : null;
  const behavior = runtime
    ? await verifyBehavior(client, address)
    : { verified: false, reason: "Contract is not deployed" };
  const status = !runtime
    ? "NOT_DEPLOYED"
    : actualRuntimeHash === expectedRuntimeHash &&
        actualTemplateHash === expectedTemplateHash &&
        behavior.verified
      ? "VERIFIED"
      : "CODE_MISMATCH";
  const manifest = {
    warning: "INTERNALLY REVIEWED - NOT INDEPENDENTLY AUDITED",
    chainId: xLayer.id,
    chainName: xLayer.name,
    factoryAddress,
    contractName,
    address,
    salt: deploymentSalt,
    initCodeHash,
    expectedRuntimeHash,
    expectedTemplateHash,
    actualRuntimeHash,
    actualTemplateHash,
    behavior,
    status,
    observedAtBlock: blockNumber.toString(),
    generatedAt: new Date().toISOString(),
  };

  await mkdir(dirname(deploymentFile), { recursive: true });
  await writeFile(deploymentFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  if (process.argv[2] === "verify" && status !== "VERIFIED") {
    process.exitCode = 1;
  }
}

async function printPayload() {
  const artifact = await loadArtifact();
  process.stdout.write(concatHex([deploymentSalt, artifact.bytecode]));
}

async function serveDeployer() {
  const artifact = await loadArtifact();
  const client = await createVerifiedClient();
  const deploymentData = concatHex([deploymentSalt, artifact.bytecode]);
  const address = getCreate2Address({
    from: factoryAddress,
    salt: deploymentSalt,
    bytecodeHash: keccak256(artifact.bytecode),
  });
  const existingCode = await client.getCode({ address });
  if (existingCode) {
    throw new Error(`Settlement contract already has code at ${address}; run verify instead`);
  }
  const [estimatedGas, fees] = await Promise.all([
    client.estimateGas({ to: factoryAddress, data: deploymentData }),
    client.estimateFeesPerGas(),
  ]);
  const maximumCostWei = fees.maxFeePerGas
    ? estimatedGas * fees.maxFeePerGas
    : null;
  const port = Number(process.env.SAFEEXIT_DEPLOYER_PORT?.trim() || "4175");
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error("SAFEEXIT_DEPLOYER_PORT must be an integer from 1024 to 65535");
  }
  const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SAFEEXIT Settlement Deployment</title>
  <style>
    :root{color-scheme:dark;font-family:Arial,sans-serif;background:#070908;color:#f4f7f5}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#070908}.shell{width:min(760px,calc(100% - 32px));margin:48px auto}.eyebrow{font:12px monospace;color:#71d9aa;text-transform:uppercase}.panel{margin-top:18px;border:1px solid #29332f;background:#0d1110;padding:24px}.warning{border-left:3px solid #ff8f70;background:#17100e;padding:14px;color:#ffd8ce}.grid{display:grid;grid-template-columns:180px 1fr;gap:12px;margin:24px 0;font-size:14px}.label{color:#8d9a94}.value{font-family:monospace;overflow-wrap:anywhere}.actions{display:flex;gap:12px;flex-wrap:wrap}button{min-height:44px;border:1px solid #4f655c;background:#121815;color:#fff;padding:0 18px;font-weight:700;cursor:pointer}button.primary{background:#dfffee;color:#05100b;border-color:#dfffee}button:disabled{opacity:.45;cursor:not-allowed}.confirm{display:flex;align-items:flex-start;gap:10px;margin:22px 0;color:#c5cec9;font-size:14px}.status{margin-top:18px;min-height:22px;font-family:monospace;color:#9ddfbe}a{color:#9ddfbe}@media(max-width:620px){.shell{margin:24px auto}.panel{padding:18px}.grid{grid-template-columns:1fr}.label{margin-top:8px}}
  </style>
</head>
<body>
  <main class="shell">
    <div class="eyebrow">Operator-only / X Layer mainnet</div>
    <h1>Deploy permit settlement</h1>
    <div class="panel">
      <div class="warning">INTERNALLY REVIEWED, NOT INDEPENDENTLY AUDITED. Deploy only the fixed, verified artifact shown below.</div>
      <div class="grid">
        <div class="label">Expected contract</div><div class="value">${address}</div>
        <div class="label">CREATE2 factory</div><div class="value">${factoryAddress}</div>
        <div class="label">Chain</div><div class="value">X Layer mainnet (196 / 0xC4)</div>
        <div class="label">Transaction value</div><div class="value">0 OKB</div>
        <div class="label">Estimated gas</div><div class="value">${estimatedGas.toString()}</div>
        <div class="label">Estimated max cost</div><div class="value">${maximumCostWei?.toString() ?? "unavailable"} wei</div>
        <div class="label">Payload hash</div><div class="value">${keccak256(deploymentData)}</div>
      </div>
      <label class="confirm"><input id="risk" type="checkbox"> <span>I understand this deploys internally reviewed code that has not received an independent audit and requires an OKX Wallet confirmation.</span></label>
      <div class="actions">
        <button id="connect">Connect OKX Wallet</button>
        <button id="deploy" class="primary" disabled>Deploy fixed contract</button>
      </div>
      <div id="status" class="status">Waiting for operator.</div>
    </div>
  </main>
  <script>
    const factory = ${JSON.stringify(factoryAddress)};
    const expected = ${JSON.stringify(address)};
    const data = ${JSON.stringify(deploymentData)};
    const chainId = "0xc4";
    let provider;
    let account;
    const status = document.getElementById("status");
    const deploy = document.getElementById("deploy");
    const risk = document.getElementById("risk");
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    function providerCode(error) {
      return error && typeof error === "object" && "code" in error ? Number(error.code) : undefined;
    }
    async function discoverOkx() {
      if (window.okxwallet) return window.okxwallet;
      let announced;
      const listener = (event) => {
        const detail = event.detail;
        const name = String(detail?.info?.name || "").toLowerCase();
        const rdns = String(detail?.info?.rdns || "").toLowerCase();
        if (name.includes("okx") || rdns.includes("okx")) announced = detail.provider;
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
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
      } catch (error) {
        if (providerCode(error) !== 4902) throw error;
        await provider.request({ method: "wallet_addEthereumChain", params: [{
          chainId,
          chainName: "X Layer mainnet",
          nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
          rpcUrls: ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"],
          blockExplorerUrls: ["https://www.okx.com/web3/explorer/xlayer"],
        }] });
      }
    }
    function refreshButton() {
      deploy.disabled = !(provider && account && risk.checked);
    }
    risk.addEventListener("change", refreshButton);
    document.getElementById("connect").addEventListener("click", async () => {
      try {
        provider = await discoverOkx();
        if (!provider) throw new Error("OKX Wallet was not injected into this localhost page");
        const accounts = await provider.request({ method: "eth_requestAccounts" });
        if (!Array.isArray(accounts) || typeof accounts[0] !== "string") throw new Error("No wallet account returned");
        account = accounts[0];
        await ensureChain();
        status.textContent = "Connected: " + account;
        refreshButton();
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "Wallet connection failed";
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
        const code = await provider.request({ method: "eth_getCode", params: [expected, "latest"] });
        if (code && code !== "0x") throw new Error("Code already exists at the expected address");
        status.textContent = "Review the fixed deployment transaction in OKX Wallet.";
        const hash = await provider.request({ method: "eth_sendTransaction", params: [{
          from: account,
          to: factory,
          value: "0x0",
          data,
        }] });
        if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
          throw new Error("OKX Wallet returned an invalid deployment transaction hash");
        }
        status.textContent = "Submitted: ";
        const link = document.createElement("a");
        link.target = "_blank";
        link.rel = "noreferrer";
        link.href = "https://www.okx.com/web3/explorer/xlayer/tx/" + hash;
        link.textContent = hash;
        status.appendChild(link);
        for (let attempt = 0; attempt < 90; attempt += 1) {
          const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [hash] });
          if (receipt) {
            if (receipt.status !== "0x1") throw new Error("Deployment transaction reverted: " + hash);
            const deployedCode = await provider.request({ method: "eth_getCode", params: [expected, "latest"] });
            if (!deployedCode || deployedCode === "0x") throw new Error("Receipt succeeded but expected contract code is missing");
            status.textContent = "Deployment confirmed. Return to Codex for bytecode verification.";
            return;
          }
          await wait(2_000);
        }
        throw new Error("Deployment confirmation timed out; check the explorer before retrying");
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "Deployment failed";
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
  process.stdout.write(`SAFEEXIT deployment page: http://127.0.0.1:${port}/\n`);
}

if (command === "payload") {
  await printPayload();
} else if (command === "serve") {
  await serveDeployer();
} else if (command === "prepare" || command === "verify") {
  await prepareOrVerify();
} else {
  throw new Error(`Unknown command ${command}`);
}
