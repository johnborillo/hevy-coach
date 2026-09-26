export type ModelCapabilities = {
  reasoning: {
    supported: boolean;
    chatEffort?: 'low' | 'medium' | 'high';
    programEffort?: 'low' | 'medium' | 'high';
  };
  jsonObject: boolean;
  maxTokens: { chat: number; program: number };
  timeoutMs: { chat: number; program: number };
  provider?: Record<string, unknown>;
};

export const REQUIRED_PROVIDER_POLICY = {
  data_collection: 'deny',
  allow_fallbacks: true,
} as const;

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  reasoning: { supported: true, chatEffort: 'medium', programEffort: 'low' },
  jsonObject: true,
  maxTokens: { chat: 2000, program: 5000 },
  timeoutMs: { chat: 45_000, program: 60_000 },
};

const CAPABILITIES: Record<string, ModelCapabilities> = {
  'z-ai/glm-5.3-flash': DEFAULT_CAPABILITIES,
  'openai/gpt-6-luna': DEFAULT_CAPABILITIES,
  'deepseek/deepseek-v4.1-flash': DEFAULT_CAPABILITIES,
  'deepseek/deepseek-v4-flash-0731': DEFAULT_CAPABILITIES,
};

export function getModelCapabilities(model: string): ModelCapabilities {
  return CAPABILITIES[model] ?? DEFAULT_CAPABILITIES;
}

export function providerForModel(capabilities: ModelCapabilities) {
  return {
    ...capabilities.provider,
    ...REQUIRED_PROVIDER_POLICY,
  };
}

export function chatRequestOptions(model: string) {
  const capabilities = getModelCapabilities(model);
  return {
    capabilities,
    max_tokens: capabilities.maxTokens.chat,
    ...(capabilities.reasoning.supported && capabilities.reasoning.chatEffort
      ? { reasoning: { effort: capabilities.reasoning.chatEffort } }
      : {}),
    provider: providerForModel(capabilities),
    timeoutMs: capabilities.timeoutMs.chat,
  };
}

export function programRequestOptions(model: string) {
  const capabilities = getModelCapabilities(model);
  return {
    capabilities,
    max_tokens: capabilities.maxTokens.program,
    ...(capabilities.reasoning.supported && capabilities.reasoning.programEffort
      ? { reasoning: { effort: capabilities.reasoning.programEffort } }
      : {}),
    ...(capabilities.jsonObject
      ? { response_format: { type: 'json_object' } }
      : {}),
    provider: providerForModel(capabilities),
    timeoutMs: capabilities.timeoutMs.program,
  };
}
