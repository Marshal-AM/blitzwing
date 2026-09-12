export const API_CONFIG = {
  discoveryUrl:
    import.meta.env.VITE_DISCOVERY_URL || "http://34.70.57.65:9000",
  gatewayUrl:
    import.meta.env.VITE_X402_GATEWAY_URL || "http://34.9.229.188:8000",
  pollInterval: 2000,
  model: import.meta.env.VITE_BLITZWING_MODEL || "HuggingFaceTB/SmolLM2-360M-Instruct",
  defaultPrompt:
    import.meta.env.VITE_DEFAULT_PROMPT ||
    "Explain distributed inference in one short sentence.",
  maxTokens: Number(import.meta.env.VITE_MAX_TOKENS || 24),
};
