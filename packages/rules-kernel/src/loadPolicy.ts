import { load as loadYaml } from "js-yaml";
import { Policy, type Policy as PolicyType } from "@pakta/canonical-model";

/**
 * Loads a policy.yaml (shape: Pakta_Documento_Maestro.md §18.4) and
 * validates it at the boundary — never trust raw YAML, same principle as
 * every other input crossing into the system (§14 threat model).
 */
export function loadPolicyFromYaml(yamlText: string): PolicyType {
  const parsed = loadYaml(yamlText);
  return Policy.parse(parsed);
}
