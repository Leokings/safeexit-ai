import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const settlementScript = resolve(scriptDirectory, "xlayer-permit-settlement.mjs");
const command = process.argv[2] ?? "prepare";
const supportedCommands = new Set(["prepare", "verify", "estimate"]);
if (!supportedCommands.has(command)) {
  throw new Error(`Expected prepare, verify, or estimate, received ${command}`);
}

const defaultChains = [
  "ethereum",
  "bnb",
  "polygon",
  "arbitrum",
  "optimism",
  "base",
  "avalanche",
  "xlayer",
];
const requestedChains = process.argv.slice(3);
const chains = requestedChains.length > 0 ? requestedChains : defaultChains;

for (const chain of chains) {
  const exitCode = await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [settlementScript, command, chain], {
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${chain} ${command} terminated by ${signal}`));
        return;
      }
      resolvePromise(code ?? 1);
    });
  });
  if (exitCode !== 0) {
    throw new Error(`${chain} ${command} failed with exit code ${exitCode}`);
  }
}
