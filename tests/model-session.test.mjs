import assert from "node:assert/strict";
import test from "node:test";
import { createModelSession, validateGguf } from "../src/lib/model-session.ts";
import { getTextDirection } from "../src/lib/text-direction.ts";

const base = { name: "gemma-base.gguf", uri: "file:///models/base.gguf" };
const adapter = { name: "tutor.gguf", uri: "file:///models/tutor.gguf" };
const options = { base, adapterScale: 1, gpuLayers: 0 };

test("detects Dari and Pashto as RTL from the first strong character", () => {
  assert.equal(getTextDirection("سلام، حالت چطور است؟"), "rtl");
  assert.equal(getTextDirection("... ۱۲۳ پښتو ژبه"), "rtl");
  assert.equal(getTextDirection("(42) English text"), "ltr");
  assert.equal(getTextDirection("12345"), "ltr");
});

function mockContext(overrides = {}) {
  return {
    model: {
      chatTemplates: { llamaChat: true, jinja: { default: true, toolUse: false } },
      isChatTemplateSupported: true,
      metadata: {},
    },
    completion: async () => ({ text: "Hello", timings: { predicted_per_second: 8 }, truncated: false }),
    stopCompletion: async () => {}, release: async () => {}, ...overrides,
  };
}

test("rejects raw Kaggle adapters and empty downloads before initializing native memory", async () => {
  for (const file of [{ name: "adapter_model.safetensors" }, { name: "empty.gguf", size: 0 }]) {
    assert.throws(() => validateGguf(file));
  }
  let initialized = false;
  await assert.rejects(createModelSession(async () => { initialized = true; }, { ...options, adapter: { ...adapter, name: "adapter.zip" } }, () => {}));
  assert.equal(initialized, false);
});

test("attaches the selected adapter and strength to the same base context", async () => {
  let params;
  await createModelSession(async (value, progress) => { params = value; progress(50); return mockContext(); }, { ...options, adapter, adapterScale: 0.75 }, (value) => assert.equal(value, 50));
  assert.equal(params.model, base.uri);
  assert.deepEqual(params.lora_list, [{ path: adapter.uri, scaled: 0.75 }]);
  assert.equal(params.n_parallel, 1);
});

test("base-only comparison does not secretly keep an adapter attached", async () => {
  let params;
  await createModelSession(async (value) => { params = value; return mockContext(); }, options, () => {});
  assert.equal("lora_list" in params, false);
});

test("validates strength only when a separate adapter is enabled", async () => {
  await assert.rejects(createModelSession(async () => mockContext(), { ...options, adapter, adapterScale: NaN }, () => {}), /strength/);
  const session = await createModelSession(async () => mockContext(), { ...options, adapterScale: NaN }, () => {});
  await session.release();
});

test("releases an unusable context if the chat template is missing", async () => {
  let released = false;
  await assert.rejects(createModelSession(async () => mockContext({ model: { isChatTemplateSupported: false }, release: async () => { released = true; } }), options, () => {}), /chat template/);
  assert.equal(released, true);
});

test("accepts Jinja-only templates even when the deprecated support flag is false", async () => {
  const session = await createModelSession(async () => mockContext({
    model: {
      isChatTemplateSupported: false,
      chatTemplates: { llamaChat: false, jinja: { default: true, toolUse: false } },
      metadata: { "tokenizer.chat_template": "model-specific Jinja template" },
    },
    completion: async (params) => {
      assert.equal(params.jinja, true);
      return { text: "Hello", timings: { predicted_per_second: 8 }, truncated: false };
    },
  }), options, () => {});
  assert.equal((await session.generate([{ id: "1", role: "user", content: "Hi" }], () => {})).text, "Hello");
});

test("uses the legacy engine for a model supported only by llama-chat", async () => {
  const session = await createModelSession(async () => mockContext({
    model: { chatTemplates: { llamaChat: true, jinja: { default: false, toolUse: false } }, metadata: {} },
    completion: async (params) => {
      assert.equal(params.jinja, false);
      return { text: "Hello", timings: { predicted_per_second: 8 }, truncated: false };
    },
  }), options, () => {});
  await session.generate([{ id: "1", role: "user", content: "Hi" }], () => {});
});

test("distinguishes an unparseable embedded template from a missing template and releases memory", async () => {
  let released = false;
  await assert.rejects(createModelSession(async () => mockContext({
    model: {
      isChatTemplateSupported: true,
      chatTemplates: { llamaChat: false, jinja: { default: false, toolUse: false } },
      metadata: { "tokenizer.chat_template": "unsupported template" },
    },
    release: async () => { released = true; },
  }), options, () => {}), /includes a chat template.*could not parse/);
  assert.equal(released, true);
});

test("streams text, sends the complete role history, and delegates stop and release", async () => {
  let stopped = false, released = false;
  const history = [{ id: "1", role: "user", content: "سلام" }];
  const chunks = [];
  const session = await createModelSession(async () => mockContext({
    completion: async (params, onToken) => {
      assert.deepEqual(params.messages, [{ role: "user", content: "سلام" }]);
      assert.equal(params.jinja, true);
      onToken({ token: "Hel" }); onToken({ token: "lo" });
      onToken({ token: "!", accumulated_text: "Hello!" });
      return { text: "Hello!", timings: { predicted_per_second: 8 }, truncated: false };
    },
    stopCompletion: async () => { stopped = true; }, release: async () => { released = true; },
  }), options, () => {});
  assert.deepEqual(await session.generate(history, (chunk) => chunks.push(chunk)), { text: "Hello!", tokensPerSecond: 8, truncated: false });
  assert.deepEqual(chunks, ["Hel", "Hello", "Hello!"]);
  await session.stop(); await session.release();
  assert.equal(stopped && released, true);
});

test("keeps parsed answer content rather than reasoning blocks in the next turn", async () => {
  const chunks = [];
  const session = await createModelSession(async () => mockContext({
    completion: async (params, onToken) => {
      assert.equal(params.enable_thinking, false);
      onToken({ token: "raw thought", content: "", accumulated_text: "raw thought" });
      onToken({ token: "Hello", content: "Hello", accumulated_text: "raw thought Hello" });
      return { text: "raw thought Hello", content: "Hello", timings: { predicted_per_second: 8 }, truncated: false };
    },
  }), options, () => {});
  const result = await session.generate([{ id: "1", role: "user", content: "Hi" }], (value) => chunks.push(value));
  assert.deepEqual(chunks, ["", "Hello"]);
  assert.equal(result.text, "Hello");
});
