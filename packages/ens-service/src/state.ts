import fs from "node:fs";
import path from "node:path";
import { ENS_CONFIG } from "./config.js";

export interface HostMapping {
  hostId: string;
  ensName: string;
  updatedAt: number;
}

export interface ParentState {
  parentName: string;
  txHash?: string;
  registeredAt: number;
  userRegistryAddress?: string;
  resolverAddress?: string;
}

function statePath(): string {
  return path.join(ENS_CONFIG.stateDir, "ens_hosts.json");
}

function parentPath(): string {
  return path.join(ENS_CONFIG.stateDir, "ens_parent.json");
}

export function loadHostMappings(): Record<string, HostMapping> {
  const p = statePath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, HostMapping>;
  } catch {
    return {};
  }
}

export function saveHostMapping(hostId: string, ensName: string): void {
  const dir = ENS_CONFIG.stateDir;
  fs.mkdirSync(dir, { recursive: true });
  const all = loadHostMappings();
  all[hostId] = { hostId, ensName, updatedAt: Date.now() };
  fs.writeFileSync(statePath(), JSON.stringify(all, null, 2));
}

export function getEnsNameForHost(hostId: string): string | null {
  return loadHostMappings()[hostId]?.ensName ?? null;
}

export function loadParentBootstrap(): ParentState | null {
  const p = parentPath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as ParentState;
  } catch {
    return null;
  }
}

export function saveParentBootstrap(payload: ParentState): void {
  fs.mkdirSync(ENS_CONFIG.stateDir, { recursive: true });
  const prev = loadParentBootstrap() || { parentName: payload.parentName, registeredAt: Date.now() };
  fs.writeFileSync(parentPath(), JSON.stringify({ ...prev, ...payload }, null, 2));
}
