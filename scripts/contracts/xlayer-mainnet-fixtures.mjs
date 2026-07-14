import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  concatHex,
  createPublicClient,
  defineChain,
  encodeAbiParameters,
  getAddress,
  getCreate2Address,
  http,
  keccak256,
  stringToHex,
  zeroAddress,
  zeroHash,
} from "viem";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(scriptDirectory, "../..");
const sourceName = "SafeExitMainnetFixtures.sol";
const factoryAddress = getAddress("0x4e59b44847b379578588920cA78FbF26c0B4956C");
const expectedFactoryRuntime =
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";
const deploymentFile = resolve(rootDirectory, "contracts/deployments/xlayer-mainnet.json");

const fixtures = [
  {
    contractName: "SafeExitTestERC3009",
    route: "ERC3009_RECEIVE_WITH_AUTHORIZATION",
    name: "SafeExit ERC3009 TEST ONLY - NO VALUE",
  },
  {
    contractName: "SafeExitTestERC2612",
    route: "ERC2612_PERMIT_SETTLEMENT",
    name: "SafeExit ERC2612 TEST ONLY - NO VALUE",
  },
  {
    contractName: "SafeExitTestDaiPermit",
    route: "DAI_PERMIT_SETTLEMENT",
    name: "SafeExit DAI Permit TEST ONLY - NO VALUE",
  },
  {
    contractName: "SafeExitTestERC4494",
    route: "ERC4494_PERMIT_SETTLEMENT",
    name: "SafeExit ERC4494 TEST ONLY - NO VALUE",
  },
];

const domainAbi = [
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
    name: "DOMAIN_SEPARATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
];

const capabilityAbi = [
  {
    type: "function",
    name: "RECEIVE_WITH_AUTHORIZATION_TYPEHASH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "PERMIT_TYPEHASH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "authorizationState",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "supportsInterface",
    stateMutability: "view",
    inputs: [{ name: "interfaceId", type: "bytes4" }],
    outputs: [{ name: "", type: "bool" }],
  },
];

const xLayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.xlayer.tech"] },
  },
});

function rpcUrl() {
  const configured = process.env.XLAYER_RPC_URL?.trim();
  return configured || xLayer.rpcUrls.default.http[0];
}

async function loadArtifact(contractName) {
  const artifactPath = resolve(
    rootDirectory,
    `contracts/artifacts/contracts/src/${sourceName}/${contractName}.json`,
  );
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  if (typeof artifact.bytecode !== "string" || !artifact.bytecode.startsWith("0x")) {
    throw new Error(`Artifact ${contractName} has no deployable bytecode`);
  }
  return artifact;
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

function expectedDomainSeparator(name, address) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        keccak256(stringToHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
        keccak256(stringToHex(name)),
        keccak256(stringToHex("1")),
        196n,
        address,
      ],
    ),
  );
}

async function verifyBehavior(client, fixture, address) {
  try {
    const [domain, separator] = await Promise.all([
      client.readContract({ address, abi: domainAbi, functionName: "eip712Domain" }),
      client.readContract({ address, abi: domainAbi, functionName: "DOMAIN_SEPARATOR" }),
    ]);
    const [fields, name, version, chainId, verifyingContract, salt, extensions] = domain;
    if (
      fields !== "0x0f" ||
      name !== fixture.name ||
      version !== "1" ||
      chainId !== 196n ||
      verifyingContract.toLowerCase() !== address.toLowerCase() ||
      salt !== zeroHash ||
      extensions.length !== 0 ||
      separator !== expectedDomainSeparator(fixture.name, address)
    ) {
      return { verified: false, reason: "EIP-712 domain mismatch" };
    }

    if (fixture.route === "ERC3009_RECEIVE_WITH_AUTHORIZATION") {
      const [typehash, used] = await Promise.all([
        client.readContract({
          address,
          abi: capabilityAbi,
          functionName: "RECEIVE_WITH_AUTHORIZATION_TYPEHASH",
        }),
        client.readContract({
          address,
          abi: capabilityAbi,
          functionName: "authorizationState",
          args: [zeroAddress, zeroHash],
        }),
      ]);
      const expected = keccak256(
        stringToHex(
          "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)",
        ),
      );
      return typehash === expected && !used
        ? { verified: true, reason: null }
        : { verified: false, reason: "ERC-3009 capability mismatch" };
    }

    if (fixture.route === "DAI_PERMIT_SETTLEMENT") {
      const [typehash, nonce] = await Promise.all([
        client.readContract({ address, abi: capabilityAbi, functionName: "PERMIT_TYPEHASH" }),
        client.readContract({ address, abi: capabilityAbi, functionName: "nonces", args: [zeroAddress] }),
      ]);
      const expected = keccak256(
        stringToHex("Permit(address holder,address spender,uint256 nonce,uint256 expiry,bool allowed)"),
      );
      return typehash === expected && nonce === 0n
        ? { verified: true, reason: null }
        : { verified: false, reason: "DAI-style permit capability mismatch" };
    }

    if (fixture.route === "ERC4494_PERMIT_SETTLEMENT") {
      const supported = await client.readContract({
        address,
        abi: capabilityAbi,
        functionName: "supportsInterface",
        args: ["0x5604e225"],
      });
      return supported
        ? { verified: true, reason: null }
        : { verified: false, reason: "ERC-4494 interface is not supported" };
    }

    const nonce = await client.readContract({
      address,
      abi: capabilityAbi,
      functionName: "nonces",
      args: [zeroAddress],
    });
    return nonce === 0n
      ? { verified: true, reason: null }
      : { verified: false, reason: "ERC-2612 nonce capability mismatch" };
  } catch (error) {
    return {
      verified: false,
      reason: error instanceof Error ? error.message.slice(0, 240) : "Capability verification failed",
    };
  }
}

async function buildEntries(client) {
  return Promise.all(
    fixtures.map(async (fixture) => {
      const { contractName, route } = fixture;
      const artifact = await loadArtifact(contractName);
      const initCode = artifact.bytecode;
      const salt = keccak256(stringToHex(`SafeExit X Layer mainnet fixture v1:${contractName}`));
      const initCodeHash = keccak256(initCode);
      const address = getCreate2Address({
        from: factoryAddress,
        salt,
        bytecodeHash: initCodeHash,
      });
      const runtime = await client.getCode({ address });
      const expectedRuntimeHash = keccak256(maskImmutables(artifact.deployedBytecode, artifact.immutableReferences));
      const actualRuntimeHash = runtime ? keccak256(runtime) : null;
      const actualTemplateHash = runtime
        ? keccak256(maskImmutables(runtime, artifact.immutableReferences))
        : null;
      const behavior = runtime
        ? await verifyBehavior(client, fixture, address)
        : { verified: false, reason: "Contract is not deployed" };

      return {
        contractName,
        route,
        address,
        salt,
        initCodeHash,
        expectedRuntimeHash,
        actualRuntimeHash,
        actualTemplateHash,
        behavior,
        status: !runtime
          ? "NOT_DEPLOYED"
          : actualTemplateHash === expectedRuntimeHash && behavior.verified
            ? "VERIFIED"
            : "CODE_MISMATCH",
      };
    }),
  );
}

async function writeManifest(entries, blockNumber) {
  const manifest = {
    warning: "TEST ONLY - OPENLY MINTABLE ASSETS WITH NO MONETARY VALUE",
    chainId: xLayer.id,
    chainName: xLayer.name,
    factoryAddress,
    observedAtBlock: blockNumber.toString(),
    generatedAt: new Date().toISOString(),
    fixtures: entries,
    realAssets: [
      {
        symbol: "xETH",
        address: getAddress("0xe7b000003a45145decf8a28fc755ad5ec5ea025a"),
        verifiedRoute: "ERC2612_PERMIT_SETTLEMENT",
      },
      {
        symbol: "xBTC",
        address: getAddress("0xb7c00000bcdeef966b20b3d884b98e64d2b06b4f"),
        verifiedRoute: "ERC2612_PERMIT_SETTLEMENT",
      },
    ],
  };

  await mkdir(dirname(deploymentFile), { recursive: true });
  await writeFile(deploymentFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

async function prepareOrVerify() {
  const client = await createVerifiedClient();
  const [entries, blockNumber] = await Promise.all([buildEntries(client), client.getBlockNumber()]);
  const manifest = await writeManifest(entries, blockNumber);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);

  if (process.argv[2] === "verify" && entries.some((entry) => entry.status !== "VERIFIED")) {
    process.exitCode = 1;
  }
}

async function printPayload(contractName) {
  const fixture = fixtures.find((candidate) => candidate.contractName === contractName);
  if (!fixture) {
    throw new Error(`Unknown fixture ${contractName}`);
  }
  const artifact = await loadArtifact(contractName);
  const salt = keccak256(stringToHex(`SafeExit X Layer mainnet fixture v1:${contractName}`));
  process.stdout.write(concatHex([salt, artifact.bytecode]));
}

const command = process.argv[2] ?? "prepare";
if (command === "payload") {
  await printPayload(process.argv[3]);
} else if (command === "prepare" || command === "verify") {
  await prepareOrVerify();
} else {
  throw new Error(`Unknown command ${command}`);
}
