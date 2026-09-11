import { parseBlockIndices, type HostPublic } from "@/lib/blitzwing-api";
import type { NodeRole, NodeRuntime, NodeStatus, SwarmNode, Tone } from "@/components/sim/types";

const TONES: Tone[] = ["cyan", "magenta", "amber", "lime", "violet"];

export function assignTone(index: number): Tone {
  return TONES[index % TONES.length]!;
}

function inferRole(host: HostPublic, index: number, totalOnline: number): NodeRole {
  if (host.role === "mother" || index === 0) return "mother";
  if (index === totalOnline - 1) return "tail";
  return "relay";
}

function inferNodeStatus(host: HostPublic): NodeStatus {
  if (host.status !== "online") return "offline";
  if (host.petals_running === false) return "idle";
  return "idle";
}

export function sortHostsByLayers(hosts: HostPublic[]): HostPublic[] {
  return [...hosts].sort((a, b) => {
    const [aStart] = parseBlockIndices(a.block_indices);
    const [bStart] = parseBlockIndices(b.block_indices);
    if (aStart !== bStart) return aStart - bStart;
    if (a.role === "mother") return -1;
    if (b.role === "mother") return 1;
    return a.host_id.localeCompare(b.host_id);
  });
}

export function hostToSwarmNode(
  host: HostPublic,
  index: number,
  totalOnline: number,
): SwarmNode {
  const blocks = parseBlockIndices(host.block_indices);
  const label =
    host.ens_name ||
    (host.role === "mother" ? "mother" : `host-${host.host_id.replace(/^host-/, "").slice(0, 8)}`);

  return {
    index,
    id: host.host_id,
    label,
    host: host.public_ip || "unknown",
    region: host.role === "mother" ? "mother-node" : "contributor",
    role: inferRole(host, index, totalOnline),
    blocks,
    tone: assignTone(index),
    online: host.status === "online",
    ensName: host.ens_name,
    ensVerified: host.ens_verified,
    hederaAccountId: host.hedera_account_id,
  };
}

export function hostToNodeRuntime(host: HostPublic): NodeRuntime {
  return {
    status: inferNodeStatus(host),
    load: 0,
    hops: 0,
    lastMs: 0,
    kv: 0,
    logs: host.petals_running
      ? ["petals shard online"]
      : host.status === "online"
        ? ["host registered"]
        : [],
  };
}

export function hostsToSwarmNodes(hosts: HostPublic[]): SwarmNode[] {
  const onlineHosts = sortHostsByLayers(hosts.filter((h) => h.status === "online"));
  const offlineHosts = sortHostsByLayers(hosts.filter((h) => h.status !== "online"));

  const ordered = [...onlineHosts, ...offlineHosts];
  const onlineCount = onlineHosts.length;

  return ordered.map((host, index) =>
    hostToSwarmNode(host, index, onlineCount > 0 ? onlineCount : ordered.length),
  );
}
