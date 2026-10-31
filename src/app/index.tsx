import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MessageContent } from "../components/message-content";
import { loadModel, runtimeNotice } from "../lib/load-model";
import { validateGguf, type ChatMessage, type ModelFile, type ModelSession } from "../lib/model-session";
import { getTextDirection } from "../lib/text-direction";

type Phase = "idle" | "files" | "loading" | "generating" | "unloading";

function Button({ title, onPress, disabled, secondary = false }: {
  title: string; onPress: () => void; disabled?: boolean; secondary?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.button, secondary && styles.secondaryButton,
        disabled && styles.disabled, pressed && styles.pressed]}>
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{title}</Text>
    </Pressable>
  );
}

export default function ChatScreen() {
  const [base, setBase] = useState<ModelFile>();
  const [adapter, setAdapter] = useState<ModelFile>();
  const [useAdapter, setUseAdapter] = useState(false);
  const [scale, setScale] = useState("1");
  const [useGpu, setUseGpu] = useState(Platform.OS === "ios");
  const [phase, setPhase] = useState<Phase>("idle");
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [stats, setStats] = useState("");
  const [stopping, setStopping] = useState(false);
  const session = useRef<ModelSession | null>(null);
  const list = useRef<FlatList<ChatMessage>>(null);
  const activeJob = useRef<Promise<void> | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const stopRequested = useRef(false);
  const ownedCacheUris = useRef(new Set<string>());
  const working = phase !== "idle";

  function trackOwnedCacheUri(uri: string) {
    if (Platform.OS === "web") return;
    const cacheRoot = Paths.cache.uri.endsWith("/") ? Paths.cache.uri : `${Paths.cache.uri}/`;
    if (uri.startsWith(cacheRoot)) ownedCacheUris.current.add(uri);
  }

  function deleteOwnedCacheUri(uri?: string) {
    if (!uri || !ownedCacheUris.current.has(uri)) return;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
      ownedCacheUris.current.delete(uri);
    } catch {
      // Keep the URI registered so a later lifecycle cleanup can retry it.
    }
  }

  function deleteAllOwnedCacheFiles() {
    for (const uri of ownedCacheUris.current) deleteOwnedCacheUri(uri);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Never free native model memory while loading or decoding is still in progress.
      void (async () => {
        await session.current?.stop().catch(() => {});
        await activeJob.current?.catch(() => {});
        try {
          await session.current?.release();
          session.current = null;
          deleteAllOwnedCacheFiles();
        } catch {
          // Keep cached model files if native release fails.
        }
      })();
    };
  }, []);

  function run(nextPhase: Phase, action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPhase(nextPhase);
    setError("");
    activeJob.current = (async () => {
      try { await action(); }
      catch (cause) {
        if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        busy.current = false;
        if (mounted.current) { setPhase("idle"); setStopping(false); }
      }
    })();
  }

  function chooseFile(kind: "base" | "adapter") {
    run("files", async () => {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*", multiple: false, copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      trackOwnedCacheUri(file.uri);
      if (!mounted.current) {
        deleteOwnedCacheUri(file.uri);
        return;
      }
      try {
        validateGguf(file);
      } catch (cause) {
        deleteOwnedCacheUri(file.uri);
        throw cause;
      }
      const previous = kind === "base" ? base : adapter;
      if (kind === "base") setBase(file);
      else { setAdapter(file); setUseAdapter(true); }
      if (previous?.uri !== file.uri) deleteOwnedCacheUri(previous?.uri);
    });
  }

  function openModel() {
    if (!base || (useAdapter && !adapter)) return;
    run("loading", async () => {
      setProgress(0);
      const loaded = await loadModel({
        base, adapter: useAdapter ? adapter : undefined,
        adapterScale: Number(scale), gpuLayers: useGpu ? 99 : 0,
      }, (value) => { if (mounted.current) setProgress(value); });
      session.current = loaded;
      if (!mounted.current) return;
      setReady(true);
      setMessages([]);
      setStats("");
    });
  }

  function closeModel() {
    run("unloading", async () => {
      await session.current?.release();
      session.current = null;
      deleteAllOwnedCacheFiles();
      if (mounted.current) {
        setBase(undefined);
        setAdapter(undefined);
        setUseAdapter(false);
        setReady(false);
        setMessages([]);
        setStats("");
      }
    });
  }

  function send() {
    const text = draft.trim();
    const model = session.current;
    if (!text || !model || busy.current) return;
    const id = Date.now().toString();
    const history: ChatMessage[] = [...messages, { id, role: "user", content: text }];
    const answerId = `${id}-answer`;
    run("generating", async () => {
      setDraft("");
      setStats("");
      stopRequested.current = false;
      setMessages([...history, { id: answerId, role: "assistant", content: "" }]);
      try {
        const result = await model.generate(history, (content) => {
          if (mounted.current) setMessages((items) => items.map((item) => item.id === answerId ? { ...item, content } : item));
        });
        if (!mounted.current) return;
        if (!result.text.trim()) {
          setMessages(messages);
          setDraft(text);
          if (!stopRequested.current) throw new Error("The model returned no text. Try a new chat, or check the model export and chat template.");
          return;
        }
        setMessages([...history, { id: answerId, role: "assistant", content: result.text }]);
        setStats(`${stopRequested.current ? "Stopped · " : ""}${result.tokensPerSecond.toFixed(1)} tokens/s`);
        if (result.truncated) setError("The conversation exceeded the 2,048-token context. Start a new chat for a fresh test.");
      } catch (cause) {
        if (mounted.current) { setMessages(messages); setDraft(text); }
        throw cause;
      }
    });
  }

  async function stop() {
    if (stopping) return;
    stopRequested.current = true;
    setStopping(true);
    try { await session.current?.stop(); }
    catch (cause) {
      if (mounted.current) { setError(String(cause)); setStopping(false); }
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <View style={styles.brand}><Text style={styles.logo}>o</Text></View>
          <View style={styles.headerTitle}><Text style={styles.title}>OfflineLLM</Text><Text style={styles.subtitle}>A conversation, on your device.</Text></View>
          <View style={[styles.badge, ready && styles.readyBadge]}><Text style={styles.badgeText}>{ready ? "LOCAL" : "SETUP"}</Text></View>
        </View>
        {!ready ? (
          <ScrollView style={styles.setupScroll} contentContainerStyle={styles.setup} keyboardShouldPersistTaps="handled">
            <Text style={styles.eyebrow}>YOUR MODEL</Text>
            <Text style={styles.setupTitle}>Bring your own intelligence.</Text>
            <Text style={styles.help}>{runtimeNotice}</Text>
            <View style={styles.fileRow}>
              <View style={styles.fileLabel}><Text style={styles.label}>Base or merged model</Text><Text numberOfLines={1} style={styles.fileName}>{base?.name ?? "Choose a local .gguf file"}</Text></View>
              <Button title="Choose" secondary disabled={working} onPress={() => chooseFile("base")} />
            </View>
            <View style={styles.fileRow}>
              <View style={styles.fileLabel}><Text style={styles.label}>LoRA adapter · optional</Text><Text numberOfLines={1} style={styles.fileName}>{adapter?.name ?? "A separate GGUF adapter"}</Text></View>
              <Button title="Choose" secondary disabled={working} onPress={() => chooseFile("adapter")} />
            </View>
            <View style={styles.option}>
              <Text style={styles.label}>Use adapter</Text>
              <Switch accessibilityLabel="Use LoRA adapter" value={useAdapter} onValueChange={setUseAdapter} disabled={working || !adapter} trackColor={{ true: "#28785e" }} />
            </View>
            {useAdapter && <View style={styles.option}>
              <Text style={styles.label}>Adapter strength</Text>
              <TextInput accessibilityLabel="Adapter strength" style={styles.scaleInput} value={scale} onChangeText={setScale} keyboardType="decimal-pad" editable={!working} />
            </View>}
            <View style={styles.option}>
              <View style={styles.fileLabel}><Text style={styles.label}>GPU acceleration</Text><Text style={styles.fileName}>Turn off if loading fails on your phone.</Text></View>
              <Switch accessibilityLabel="GPU acceleration" value={useGpu} onValueChange={setUseGpu} disabled={working} trackColor={{ true: "#28785e" }} />
            </View>
            <Text style={styles.small}>Gemma 4 E2B: use the matching base export. A merged fine-tuned GGUF loads here without a separate adapter. Files and chats are kept for this session.</Text>
            <Button title={phase === "loading" ? `Loading model… ${Math.round(progress)}%` : phase === "files" ? "Importing file…" : "Load model"} disabled={working || !base || (useAdapter && !adapter)} onPress={openModel} />
          </ScrollView>
        ) : (
          <View style={styles.loadedBar}>
            <View style={styles.fileLabel}><Text numberOfLines={1} style={styles.label}>{base?.name}</Text><Text style={styles.fileName}>{useAdapter ? `LoRA enabled · strength ${scale}` : "Base / merged model · no separate adapter"}</Text></View>
            <Button title="Unload" secondary disabled={working} onPress={closeModel} />
          </View>
        )}
        {error ? <View accessibilityRole="alert" style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}
        <FlatList ref={list} style={styles.conversation} contentContainerStyle={messages.length ? styles.messages : styles.emptyContainer}
          data={messages} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={ready ? <View style={styles.empty}>
            <Text style={styles.emptyIcon}>✳</Text>
            <Text style={styles.emptyTitle}>{ready ? "What’s on your mind?" : "Your chat starts here."}</Text>
            <Text style={styles.emptyText}>{ready ? "Try the same prompt with and without your adapter to compare the results." : "Load a model to send your first message. Your prompts stay on your phone."}</Text>
            {ready && <Button secondary title="Test a Dari greeting" onPress={() => setDraft("سلام! خودت را به زبان دری معرفی کن.")} />}
          </View> : <Text style={styles.emptyText}>Load your model to start chatting.</Text>}
          renderItem={({ item }) => <View style={[styles.message, item.role === "user" ? styles.userMessage : styles.assistantMessage]}>
            <Text style={styles.messageRole}>{item.role === "user" ? "YOU" : "ASSISTANT"}</Text>
            {item.content ? <MessageContent content={item.content} role={item.role}
              streaming={phase === "generating" && item.id === messages[messages.length - 1]?.id} /> : <ActivityIndicator color="#28785e" style={styles.spinner} />}
          </View>} />
        <View style={styles.footer}>
          {ready && <View style={styles.chatActions}><Text style={styles.small}>{stats || "2,048 context · 256 reply tokens"}</Text><Pressable accessibilityRole="button" disabled={working} onPress={() => { setMessages([]); setStats(""); setError(""); }}><Text style={[styles.newChat, working && styles.disabled]}>New chat</Text></Pressable></View>}
          <View style={styles.composer}>
            <TextInput accessibilityLabel="Message" placeholder={ready ? "Message your model…" : "Load a model first…"}
              placeholderTextColor="#8a928e" multiline maxLength={8000} value={draft} onChangeText={setDraft}
              editable={ready && !working} style={[styles.messageInput, draft ? {
                textAlign: getTextDirection(draft) === "rtl" ? "right" : "left",
                writingDirection: getTextDirection(draft),
              } : null]} />
            {phase === "generating" ? <Button title={stopping ? "Stopping…" : "Stop"} disabled={stopping} onPress={() => void stop()} /> : <Button title="Send ↑" disabled={!ready || working || !draft.trim()} onPress={send} />}
          </View>
          <Text style={styles.footerNote}>ON-DEVICE INFERENCE · NO CHAT SERVER</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f6f5ef" },
  page: { flex: 1, width: "100%", maxWidth: 860, alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 22, paddingVertical: 20 },
  brand: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#1b3f34", alignItems: "center", justifyContent: "center" },
  logo: { fontSize: 37, color: "#d8edb3", lineHeight: 42, fontWeight: "600" },
  headerTitle: { flex: 1 }, title: { fontSize: 21, fontWeight: "700", color: "#20382e" },
  subtitle: { fontSize: 12, color: "#68766e", marginTop: 3 },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: "#e8e9df" },
  readyBadge: { backgroundColor: "#d9edda" }, badgeText: { fontSize: 10, letterSpacing: 1, fontWeight: "700", color: "#385b45" },
  setupScroll: { flexGrow: 0, flexShrink: 1, maxHeight: "62%", marginHorizontal: 16, borderRadius: 20, backgroundColor: "#fffefa", borderWidth: 1, borderColor: "#e4e6da" },
  setup: { padding: 20, gap: 12 }, eyebrow: { fontSize: 10, fontWeight: "700", letterSpacing: 2, color: "#63785d" },
  setupTitle: { fontSize: 24, fontWeight: "600", color: "#253e30", letterSpacing: -0.7 },
  help: { fontSize: 13, lineHeight: 20, color: "#66736a" },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, borderTopColor: "#edeee6", paddingTop: 12 },
  fileLabel: { flex: 1 }, label: { fontSize: 13, color: "#273c30", fontWeight: "600" },
  fileName: { fontSize: 11, color: "#778176", marginTop: 4 },
  option: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 34 },
  scaleInput: { backgroundColor: "#f1f2e9", color: "#273c30", borderRadius: 8, padding: 8, minWidth: 60, textAlign: "center" },
  small: { fontSize: 11, lineHeight: 17, color: "#74806e", flexShrink: 1 },
  button: { backgroundColor: "#28785e", paddingHorizontal: 17, paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  secondaryButton: { backgroundColor: "#eef1e6" }, secondaryText: { color: "#3d6048" },
  disabled: { opacity: 0.4 }, pressed: { opacity: 0.75 },
  loadedBar: { flexDirection: "row", gap: 12, alignItems: "center", marginHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#e1e5d9" },
  error: { marginHorizontal: 20, marginTop: 12, padding: 12, backgroundColor: "#f9e9e2", borderRadius: 12 },
  errorText: { color: "#944634", fontSize: 12, lineHeight: 18 },
  conversation: { flex: 1 }, messages: { padding: 20, gap: 16 },
  emptyContainer: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  empty: { maxWidth: 330, gap: 10, alignItems: "center", paddingVertical: 12 },
  emptyIcon: { fontSize: 30, color: "#82956c" }, emptyTitle: { fontSize: 20, fontWeight: "600", color: "#3d5141" },
  emptyText: { fontSize: 13, textAlign: "center", color: "#7a8475", lineHeight: 20, marginBottom: 6 },
  message: { borderRadius: 17, padding: 16, gap: 8, minWidth: 0 },
  userMessage: { alignSelf: "flex-end", maxWidth: "92%", backgroundColor: "#e3eddc" },
  assistantMessage: { alignSelf: "flex-start", width: "92%", backgroundColor: "#fffefa", borderWidth: 1, borderColor: "#e5e7dd" },
  messageRole: { fontSize: 9, letterSpacing: 1.5, fontWeight: "700", color: "#6d8165" },
  spinner: { alignSelf: "flex-start" },
  footer: { paddingHorizontal: 20, paddingBottom: 10, gap: 10 },
  chatActions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  newChat: { fontSize: 12, color: "#28785e", padding: 6 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 10, backgroundColor: "#fffefa", borderWidth: 1, borderColor: "#dce1d2", borderRadius: 18, padding: 9 },
  messageInput: { flex: 1, minHeight: 42, maxHeight: 120, fontSize: 15, padding: 10, color: "#243b2c", textAlignVertical: "top" },
  footerNote: { fontSize: 9, letterSpacing: 1.5, textAlign: "center", color: "#949c8c" },
});
