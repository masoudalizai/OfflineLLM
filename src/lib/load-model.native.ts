import Constants, { ExecutionEnvironment } from "expo-constants";
import { createModelSession, type ModelOptions, type ModelSession } from "./model-session";

export const runtimeNotice = Constants.executionEnvironment === ExecutionEnvironment.StoreClient
  ? "Model loading needs a development build. Expo Go can preview the chat interface only."
  : "All replies are generated on this phone. Select local GGUF files to begin.";

export async function loadModel(options: ModelOptions, onProgress: (progress: number) => void): Promise<ModelSession> {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    throw new Error(runtimeNotice);
  }
  // Delayed import lets Expo Go show setup instructions without loading an absent native module.
  const { initLlama } = await import("llama.rn");
  return createModelSession(initLlama, options, onProgress);
}
