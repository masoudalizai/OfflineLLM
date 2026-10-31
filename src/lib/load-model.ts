import type { ModelOptions, ModelSession } from "./model-session";

export const runtimeNotice = "Offline inference runs in an Android or iPhone development build. The browser previews the interface only.";

export async function loadModel(_options: ModelOptions, _onProgress: (progress: number) => void): Promise<ModelSession> {
  throw new Error(runtimeNotice);
}
