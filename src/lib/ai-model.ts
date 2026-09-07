import type Anthropic from "@anthropic-ai/sdk";

/** The Claude model used for both content drafting and Federal Register summarization — one access point for the shared setting. */
export function getConfiguredModel(): string {
  return process.env.EO_TRACKER_MODEL || "claude-opus-5";
}

/** Pulls the text out of a Claude response, shared by content-generation.ts and summarize.ts — both need the same "did it actually return text" guard. */
export function extractTextBlock(response: Anthropic.Messages.Message): string {
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`Model did not return text (stop_reason: ${response.stop_reason}).`);
  }
  return textBlock.text;
}
