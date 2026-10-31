import type { ContextParams, LlamaContext } from "llama.rn";

export type ModelFile = { name: string; uri: string; size?: number };
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};
export type ModelOptions = {
  base: ModelFile;
  adapter?: ModelFile;
  adapterScale: number;
  gpuLayers: number;
};
export type ModelSession = {
  generate: (messages: ChatMessage[], onText: (text: string) => void) => Promise<{
    text: string;
    tokensPerSecond: number;
    truncated: boolean;
  }>;
  stop: () => Promise<void>;
  release: () => Promise<void>;
};

type Context = Pick<LlamaContext, "completion" | "stopCompletion" | "release" | "model">;
type InitContext = (options: ContextParams, onProgress?: (progress: number) => void) => Promise<Context>;

export function validateGguf(file: ModelFile) {
  if (!file.name.toLowerCase().endsWith(".gguf")) {
    throw new Error("Choose a .gguf file. Kaggle safetensors adapters must be converted or merged and exported first.");
  }
  if (file.size === 0) throw new Error("This file is empty. Download the complete model first.");
}

/** Keeps the adapter attached for the entire lifetime of this conversation. */
export async function createModelSession(
  init: InitContext,
  options: ModelOptions,
  onProgress: (progress: number) => void,
): Promise<ModelSession> {
  validateGguf(options.base);
  if (options.adapter) validateGguf(options.adapter);
  if (options.adapter && (!Number.isFinite(options.adapterScale) || options.adapterScale <= 0 || options.adapterScale > 2)) {
    throw new Error("Adapter strength must be a number greater than 0 and at most 2.");
  }
  const context = await init({
    model: options.base.uri,
    n_ctx: 2048,
    n_batch: 128,
    n_parallel: 1,
    n_gpu_layers: options.gpuLayers,
    use_mmap: true,
    use_mlock: false,
    ...(options.adapter ? { lora_list: [{ path: options.adapter.uri, scaled: options.adapterScale }] } : {}),
  }, onProgress);

  // The deprecated isChatTemplateSupported flag only describes llama-chat.cpp.
  // Modern instruction templates can be supported exclusively by the Jinja engine.
  const templates = context.model.chatTemplates;
  const useJinja = !!(templates?.jinja?.default || templates?.jinja?.toolUse);
  if (!useJinja && !templates?.llamaChat) {
    const template = (context.model.metadata as Record<string, unknown>)?.["tokenizer.chat_template"];
    const hasTemplate = typeof template === "string" && template.trim().length > 0;
    await context.release();
    throw new Error(hasTemplate
      ? "This GGUF includes a chat template, but the runtime could not parse it. Check template compatibility with llama.rn."
      : "No supported chat template was detected in this GGUF. Export the instruction model with its tokenizer and chat template.");
  }

  return {
    async generate(messages, onText) {
      let text = "";
      const result = await context.completion({
        messages: messages.map(({ role, content }) => ({ role, content })),
        jinja: useJinja,
        enable_thinking: false,
        reasoning_format: "auto",
        n_predict: 256,
        temperature: 1,
        top_p: 0.95,
        top_k: 64,
        seed: 3407,
      }, (data) => {
        text = data.content ?? data.accumulated_text ?? text + data.token;
        onText(text);
      });
      return { text: result.content ?? result.text, tokensPerSecond: result.timings.predicted_per_second, truncated: result.truncated };
    },
    stop: () => context.stopCompletion(),
    release: () => context.release(),
  };
}
