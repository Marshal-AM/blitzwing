/** Canonical Blitzwing ENS text record keys. */

export const RECORD_KEYS = {
  hostId: "com.blitzwing.hostId",
  hederaAccountId: "com.blitzwing.hederaAccountId",
  blockIndices: "com.blitzwing.blockIndices",
  layersHosted: "com.blitzwing.layersHosted",
  model: "com.blitzwing.model",
  role: "com.blitzwing.role",
  status: "com.blitzwing.status",
} as const;

export type HostRole = "mother" | "contributor";
export type HostStatus = "online" | "offline";

export interface BlitzwingHostRecord {
  hostId: string;
  hederaAccountId: string;
  blockIndices: string;
  layersHosted: number;
  model: string;
  role: HostRole;
  status: HostStatus;
}

const HEDERA_RE = /^0\.0\.\d+$/;
const BLOCK_RE = /^\d+:\d+$/;

export function validateHederaAccountId(value: string): string {
  const v = (value || "").trim();
  if (!HEDERA_RE.test(v)) {
    throw new Error(`Invalid hederaAccountId: ${value}`);
  }
  return v;
}

export function validateBlockIndices(value: string): string {
  const v = (value || "").trim();
  if (!BLOCK_RE.test(v)) {
    throw new Error(`Invalid blockIndices: ${value}`);
  }
  const [a, b] = v.split(":").map(Number);
  if (!(a < b)) {
    throw new Error(`blockIndices start must be < end: ${v}`);
  }
  return v;
}

export function hostIdToLabel(hostId: string): string {
  if (hostId === "mother") return "mother";
  const m = /^host-([a-f0-9]+)$/i.exec(hostId);
  if (!m) throw new Error(`Invalid hostId: ${hostId}`);
  return `host-${m[1].slice(0, 8)}`;
}

export function hostIdToEnsName(hostId: string, parentName: string): string {
  return `${hostIdToLabel(hostId)}.${parentName}`;
}

export function recordToTexts(record: BlitzwingHostRecord): { key: string; value: string }[] {
  validateHederaAccountId(record.hederaAccountId);
  validateBlockIndices(record.blockIndices);
  return [
    { key: RECORD_KEYS.hostId, value: record.hostId },
    { key: RECORD_KEYS.hederaAccountId, value: record.hederaAccountId },
    { key: RECORD_KEYS.blockIndices, value: record.blockIndices },
    { key: RECORD_KEYS.layersHosted, value: String(record.layersHosted) },
    { key: RECORD_KEYS.model, value: record.model },
    { key: RECORD_KEYS.role, value: record.role },
    { key: RECORD_KEYS.status, value: record.status },
  ];
}

export function textsToRecord(
  ensName: string,
  texts: Record<string, string | null | undefined>,
): BlitzwingHostRecord | null {
  const hostId = texts[RECORD_KEYS.hostId];
  const hedera = texts[RECORD_KEYS.hederaAccountId];
  const blocks = texts[RECORD_KEYS.blockIndices];
  if (!hostId || !hedera || !blocks) return null;
  const layers = Number(texts[RECORD_KEYS.layersHosted] || "0");
  return {
    hostId,
    hederaAccountId: hedera,
    blockIndices: blocks,
    layersHosted: Number.isFinite(layers) ? layers : 0,
    model: texts[RECORD_KEYS.model] || "",
    role: (texts[RECORD_KEYS.role] as HostRole) || "contributor",
    status: (texts[RECORD_KEYS.status] as HostStatus) || "offline",
    ensName,
  } as BlitzwingHostRecord & { ensName?: string };
}

export function parseRecordFromTexts(
  ensName: string,
  entries: { key: string; value: string }[],
): BlitzwingHostRecord | null {
  const map: Record<string, string> = {};
  for (const e of entries) map[e.key] = e.value;
  const rec = textsToRecord(ensName, map);
  return rec;
}
