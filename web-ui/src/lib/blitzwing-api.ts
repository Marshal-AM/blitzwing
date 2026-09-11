import { API_CONFIG } from "@/config";

export type HostPublic = {
  host_id: string;
  role: "mother" | "contributor" | string;
  model: string;
  block_indices: string;
  layers_hosted: number;
  status: "pending" | "online" | "offline" | string;
  public_ip?: string | null;
  last_heartbeat: number;
  hedera_account_id?: string | null;
  ens_name?: string | null;
  ens_verified?: boolean | null;
  petals_running?: boolean | null;
};

export type HostListResponse = {
  model: string;
  total_layers: number;
  max_layers_available: number;
  cost_per_layer_tinybars?: number | null;
  hosts: HostPublic[];
};

export type SwarmManifestResponse = {
  model: string;
  total_layers: number;
  complete: boolean;
  detail?: string | null;
  hosts: HostPublic[];
};

export type MotherRecord = {
  model: string;
  mother_url: string;
  total_layers: number;
  updated_at: number;
};

export type ChatStreamCallbacks = {
  onToken: (token: string) => void;
  onPhase?: (phase: "paying" | "routing" | "streaming") => void;
  onComplete: (meta?: { payment?: unknown }) => void;
  onError?: (message: string) => void;
};

export function parseBlockIndices(blockIndices: string): [number, number] {
  const [start, end] = blockIndices.split(":").map((v) => Number.parseInt(v, 10));
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return [0, 0];
  }
  return [start, end];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export type SwarmSnapshot = {
  discoveryUrl: string;
  motherUrl: string;
  model: string;
  hosts: HostListResponse;
  manifest: SwarmManifestResponse;
};

export async function fetchSwarmSnapshot(): Promise<SwarmSnapshot> {
  const res = await fetch("/api/swarm", { headers: { accept: "application/json" } });
  const body = (await res.json()) as SwarmSnapshot & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || `Swarm poll failed (${res.status})`);
  }
  return body;
}

export async function discoverMother(model: string): Promise<MotherRecord> {
  const snap = await fetchSwarmSnapshot();
  return {
    model: snap.model,
    mother_url: snap.motherUrl,
    total_layers: snap.hosts.total_layers,
    updated_at: Math.floor(Date.now() / 1000),
  };
}

export async function fetchHosts(_motherUrl: string): Promise<HostListResponse> {
  const snap = await fetchSwarmSnapshot();
  return snap.hosts;
}

export async function fetchManifest(_motherUrl: string): Promise<SwarmManifestResponse> {
  const snap = await fetchSwarmSnapshot();
  return snap.manifest;
}

export async function sendChatCompletion(
  prompt: string,
  callbacks: ChatStreamCallbacks,
  options?: { model?: string; maxTokens?: number },
): Promise<void> {
  const model = options?.model ?? API_CONFIG.model;
  const maxTokens = options?.maxTokens ?? API_CONFIG.maxTokens;

  callbacks.onPhase?.("paying");

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt,
      model,
      max_tokens: maxTokens,
      stream: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    callbacks.onError?.(text || `Inference failed (${res.status})`);
    throw new Error(text || `Inference failed (${res.status})`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream") && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let paymentMeta: unknown;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        try {
          const data = JSON.parse(payload) as {
            type?: string;
            phase?: "paying" | "routing" | "streaming";
            token?: string;
            payment?: unknown;
            message?: string;
            choices?: Array<{ delta?: { content?: string } }>;
          };
          if (data.type === "phase" && data.phase) {
            callbacks.onPhase?.(data.phase);
            continue;
          }
          if (data.type === "error" && data.message) {
            callbacks.onError?.(data.message);
            throw new Error(data.message);
          }
          if (data.type === "payment" && data.payment) {
            paymentMeta = data.payment;
            continue;
          }
          const token =
            data.token ??
            data.choices?.[0]?.delta?.content ??
            "";
          if (token) callbacks.onToken(token);
        } catch {
          /* ignore malformed chunks */
        }
      }
    }

    callbacks.onComplete({ payment: paymentMeta });
    return;
  }

  const json = (await res.json()) as {
    content?: string;
    payment?: unknown;
    error?: string;
  };
  if (json.error) {
    callbacks.onError?.(json.error);
    throw new Error(json.error);
  }

  callbacks.onPhase?.("streaming");
  const content = json.content ?? "";
  const parts = content.match(/\S+\s*|\s+/g) ?? [];
  for (const part of parts) {
    if (part.trim()) callbacks.onToken(part);
  }
  callbacks.onComplete({ payment: json.payment });
}
