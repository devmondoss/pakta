import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The on-chain identifiers a proof is bound to. Read from
 * `deployments/<network>.json` rather than hardcoded, because the registration
 * digest commits to the contract and asset ids — a proof signed against one
 * deployment must not be quietly submitted to another.
 */
export type Deployment = {
  network: string;
  networkPassphrase: string;
  rpcUrl: string;
  contractId: string;
  assetCode: string;
  assetContractId: string;
};

type Manifest = {
  network: { name: string; passphrase: string; rpc: string };
  asset: { code: string; sacContractId: string };
  contracts: { payableGate: { contractId: string } };
};

export function deploymentFromManifest(manifest: Manifest): Deployment {
  return {
    network: manifest.network.name,
    networkPassphrase: manifest.network.passphrase,
    rpcUrl: manifest.network.rpc,
    contractId: manifest.contracts.payableGate.contractId,
    assetCode: manifest.asset.code,
    assetContractId: manifest.asset.sacContractId,
  };
}

export function loadDeployment(network = "testnet"): Deployment {
  const file = fileURLToPath(new URL(`../../../deployments/${network}.json`, import.meta.url));
  return deploymentFromManifest(JSON.parse(readFileSync(file, "utf8")) as Manifest);
}
