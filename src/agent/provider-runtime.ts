import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { MacusConfig, ProviderConfig } from "../types.js";
import { usablePromptCapacity } from "../context/budget.js";

type PiProviderApi = "openai-completions" | "openai-responses";
type RuntimeModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;

function piApi(protocol: ProviderConfig["protocol"]): PiProviderApi {
  switch (protocol) {
    case "openai-responses": return "openai-responses";
    case "openai-compatible":
    case "openrouter":
    case "litellm": return "openai-completions";
  }
}

export interface ResolvedModel {
  model: RuntimeModel;
  alias: string;
  providerName: string;
  profileName: string;
}

/** Owns provider protocol translation, credentials, and model selection for one config. */
export class ProviderRuntime {
  private constructor(
    readonly runtime: ModelRuntime,
    private readonly config: MacusConfig,
  ) {}

  static async create(config: MacusConfig): Promise<ProviderRuntime> {
    const runtime = await ModelRuntime.create({ refreshOnCreate: false });
    for (const [providerName, provider] of Object.entries(config.models.providers)) {
      const profile = config.model_profiles[provider.profile];
      if (!profile) throw new Error("Unknown model profile " + provider.profile);
      const api = piApi(provider.protocol);
      runtime.registerProvider(providerName, {
        name: providerName,
        baseUrl: provider.base_url,
        api,
        authHeader: true,
        models: [{
          id: provider.model,
          name: provider.model,
          api,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: profile.context_window,
          maxTokens: profile.max_output_tokens,
        }],
      });
      if (provider.api_key_env) {
        const key = process.env[provider.api_key_env];
        if (!key) throw new Error("Missing environment variable " + provider.api_key_env);
        await runtime.setRuntimeApiKey(providerName, key);
      }
    }
    return new ProviderRuntime(runtime, config);
  }

  resolve(alias: string): ResolvedModel {
    const providerName = this.config.models.aliases[alias];
    if (!providerName) throw new Error("Unknown model alias " + alias);
    const provider = this.config.models.providers[providerName];
    if (!provider) throw new Error("Unknown model provider " + providerName);
    const profile = this.config.model_profiles[provider.profile];
    if (!profile) throw new Error("Unknown model profile " + provider.profile);
    usablePromptCapacity(profile, this.config.context);
    const model = this.runtime.getModel(providerName, provider.model);
    if (!model) throw new Error("Configured model unavailable: " + provider.model);
    return { model, alias, providerName, profileName: provider.profile };
  }
}
