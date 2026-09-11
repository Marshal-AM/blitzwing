export const API_CONFIG = {
  discoveryUrl:
    import.meta.env.VITE_DISCOVERY_URL || "http://34.60.5.221:9000",
  gatewayUrl:
    import.meta.env.VITE_X402_GATEWAY_URL || "http://127.0.0.1:8000",
  pollInterval: 2000,
  model: import.meta.env.VITE_BLITZWING_MODEL || "bigscience/bloom-560m",
  defaultPrompt:
    import.meta.env.VITE_DEFAULT_PROMPT ||
    "Explain distributed inference in one short sentence.",
  maxTokens: Number(import.meta.env.VITE_MAX_TOKENS || 24),
};
