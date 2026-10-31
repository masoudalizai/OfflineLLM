import { EnrichedMarkdownText, type MarkdownStyle } from "react-native-enriched-markdown";
import { Linking, StyleSheet, Text } from "react-native";
import { getTextDirection } from "../lib/text-direction";

const markdownStyle: MarkdownStyle = {
  paragraph: { fontSize: 16, lineHeight: 25, color: "#263a2d", marginTop: 0, marginBottom: 10, textAlign: "auto" },
  h1: { fontSize: 24, lineHeight: 31, color: "#20382e", marginTop: 8, marginBottom: 10, textAlign: "auto" },
  h2: { fontSize: 21, lineHeight: 28, color: "#20382e", marginTop: 8, marginBottom: 8, textAlign: "auto" },
  h3: { fontSize: 18, lineHeight: 25, color: "#20382e", marginTop: 6, marginBottom: 6, textAlign: "auto" },
  h4: { fontSize: 16, lineHeight: 23, color: "#20382e", marginTop: 6, marginBottom: 5, textAlign: "auto" },
  strong: { color: "#1c3328" },
  em: { color: "#354d3e" },
  link: { color: "#28785e", underline: true },
  list: { fontSize: 16, lineHeight: 25, color: "#263a2d", bulletColor: "#28785e", markerColor: "#28785e", gapWidth: 8, itemSpacing: 4 },
  blockquote: { fontSize: 16, lineHeight: 24, color: "#46584c", borderColor: "#89a978", backgroundColor: "#f2f6ec", borderRadius: 8, padding: 10 },
  code: { fontSize: 14, color: "#2c5140", backgroundColor: "#edf1e8", borderColor: "#d8ded2" },
  codeBlock: { fontSize: 13, lineHeight: 20, color: "#e8eee9", backgroundColor: "#1f2e27", borderColor: "#34483d", borderRadius: 10, padding: 12 },
  thematicBreak: { color: "#d8ded2", height: 1, marginTop: 12, marginBottom: 12 },
  table: { fontSize: 14, lineHeight: 20, color: "#263a2d", headerBackgroundColor: "#e7eee1", headerTextColor: "#20382e", rowEvenBackgroundColor: "#fafbf6", rowOddBackgroundColor: "#f2f5ed", borderColor: "#d3dccd", borderRadius: 8, cellPaddingHorizontal: 9, cellPaddingVertical: 7 },
  math: { fontSize: 18, color: "#20382e", backgroundColor: "#f2f5ed", padding: 10, marginTop: 8, marginBottom: 10, textAlign: "center" },
  inlineMath: { color: "#20382e" },
};

export function MessageContent({ content, role, streaming }: {
  content: string;
  role: "user" | "assistant";
  streaming?: boolean;
}) {
  // The segmented native Markdown view can report transient intrinsic sizes while
  // its document is changing token by token. Keep streaming text in one stable
  // React Native Text node, then replace it with rich Markdown once generation
  // finishes.
  if (role === "user" || streaming) {
    const direction = getTextDirection(content);
    return (
      <Text selectable style={[styles.plainText, {
        textAlign: direction === "rtl" ? "right" : "left",
        writingDirection: direction,
      }]}>{content}</Text>
    );
  }

  return (
    <EnrichedMarkdownText
      markdown={content}
      flavor="github"
      md4cFlags={{ latexMath: true }}
      markdownStyle={markdownStyle}
      containerStyle={styles.markdown}
      writingDirection="first-strong"
      dir="auto"
      selectable
      onLinkPress={({ url }) => { void Linking.openURL(url); }}
    />
  );
}

const styles = StyleSheet.create({
  markdown: { width: "100%", alignSelf: "stretch", flexShrink: 1 },
  plainText: { width: "100%", flexShrink: 1, fontSize: 16, lineHeight: 25, color: "#263a2d" },
});
