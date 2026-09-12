export const TOTAL_LAYERS = 32;

export type Tone = "cyan" | "magenta" | "amber" | "lime" | "violet";

export type NodeStatus = "offline" | "idle" | "receiving" | "computing" | "emitting" | "done";

export type NodeRole = "mother" | "relay" | "tail";

export interface SwarmNode {
  index: number;
  id: string;
  label: string;
  host: string;
  region: string;
  role: NodeRole;
  blocks: [number, number];
  tone: Tone;
  online: boolean;
  ensName?: string | null;
  ensVerified?: boolean | null;
  hederaAccountId?: string | null;
}

export interface PaymentHostRow {
  host_id: string;
  ens_name?: string | null;
  hedera_account_id?: string | null;
  layers?: number;
  amount_tinybars?: number;
}

export interface PaymentReceipt {
  request_id?: string;
  x402_tx_id?: string | null;
  payout_tx_id?: string | null;
  hcs_topic_id?: string | null;
  hcs_sequence?: string | null;
  cost_per_layer_tinybars?: number;
  total_tinybars?: number;
  hosts?: PaymentHostRow[];
}

export interface NodeRuntime {
  status: NodeStatus;
  load: number;
  hops: number;
  lastMs: number;
  kv: number;
  logs: string[];
}

export interface OrchLog {
  id: number;
  scope: string;
  text: string;
  tone: Tone;
  href?: string | null;
}

export interface Pulse {
  key: string;
  wire: string;
  tone: Tone;
  duration: number;
}

export type Phase = "idle" | "paying" | "routing" | "streaming" | "complete";

const TONES: Tone[] = ["cyan", "magenta", "amber", "lime", "violet"];
const REGIONS = [
  "local-wsl",
  "gcp-asia-s1",
  "hetzner-fsn1",
  "aws-eu-w2",
  "oracle-mum",
  "fly-sin",
  "vast-us-e",
  "azure-uks",
];

function hostId(i: number) {
  const seed = (i + 3) * 2654435761;
  return `host-${(seed % 0xffffff).toString(16).padStart(6, "0")}${((seed >> 7) % 0xfff)
    .toString(16)
    .padStart(3, "0")}`;
}

export function buildNodes(count: number, offline: Set<number> = new Set()): SwarmNode[] {
  const per = Math.floor(TOTAL_LAYERS / count);
  let cursor = 0;

  return Array.from({ length: count }, (_, i) => {
    const isLast = i === count - 1;
    const start = cursor;
    const end = isLast ? TOTAL_LAYERS : start + per;
    cursor = end;

    return {
      index: i,
      id: `n${i}`,
      label: i === 0 ? "mother" : hostId(i),
      host: i === 0 ? "10.0.0.1:31337" : `${34 + i}.${120 + i * 7}.${11 + i}.${40 + i}:31337`,
      region: i === 0 ? "mother-node" : REGIONS[(i - 1) % REGIONS.length]!,
      role: i === 0 ? "mother" : isLast ? "tail" : "relay",
      blocks: [start, end] as [number, number],
      tone: TONES[i % TONES.length]!,
      online: !offline.has(i),
    };
  });
}
