import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { encodeFunctionData, getAddress, parseUnits } from "viem";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = resolve(rootDirectory, "contracts/deployments/xlayer-mainnet.json");

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

const erc721FaucetAbi = [{
  type: "function",
  name: "faucet",
  stateMutability: "nonpayable",
  inputs: [{ name: "recipient", type: "address" }],
  outputs: [{ name: "tokenId", type: "uint256" }],
}];

const [contractName, rawRecipient, rawAmount = "100"] = process.argv.slice(2);
if (!contractName || !rawRecipient) {
  throw new Error("Usage: npm run contracts:faucet-data:xlayer -- <contractName> <recipient> [token amount]");
}

const recipient = getAddress(rawRecipient);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const fixture = manifest.fixtures.find((candidate) => candidate.contractName === contractName);
if (!fixture || fixture.status !== "VERIFIED") {
  throw new Error(`Fixture ${contractName} is absent or not verified`);
}

const isNft = fixture.route === "ERC4494_PERMIT_ATOMIC_BATCH";
const data = isNft
  ? encodeFunctionData({ abi: erc721FaucetAbi, functionName: "faucet", args: [recipient] })
  : encodeFunctionData({
      abi: erc20FaucetAbi,
      functionName: "faucet",
      args: [recipient, parseUnits(rawAmount, 18)],
    });

process.stdout.write(data);
