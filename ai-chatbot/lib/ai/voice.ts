export interface VoiceConfig {
  apiKey: string;
  systemPrompt?: string;
  voice?: string;
  temperature?: number;
  model?: string;
}

interface ChatMessage {
  role: string;
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>;
}

export interface DialConfig {
  callAgentId: string;
  messages?: ChatMessage[];
}

export async function createVogentDial(config: DialConfig): Promise<{
  sessionId: string;
  dialId: string;
  dialToken: string;
}> {
  const response = await fetch("https://api.vogent.ai/api/dials", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.VOGENT_PUBLIC_API_KEY || ""}`,
    },
    body: JSON.stringify({
      callAgentId: config.callAgentId,
      browserCall: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create Vogent dial: ${error}`);
  }

  const data = await response.json();
  return {
    sessionId: data.sessionId,
    dialId: data.dialId,
    dialToken: data.dialToken,
  };
}

export type VogentStatus = "connecting" | "connected" | "ended" | "error";

export function getStatusMessage(status: VogentStatus): string {
  switch (status) {
    case "connecting":
      return "Connecting...";
    case "connected":
      return "Connected";
    case "ended":
      return "Call Ended";
    case "error":
      return "Error";
    default:
      return "Unknown";
  }
}

export const DEFAULT_SYSTEM_PROMPT = `You are an expert teaching assistant dedicated to helping students learn effectively.

Your approach:
- Ask probing questions to understand the student's current knowledge level
- Identify knowledge gaps and misconceptions
- Break down complex topics into digestible pieces
- Use analogies and real-world examples to explain concepts
- Encourage critical thinking rather than just giving answers
- Celebrate progress and provide constructive feedback
- Adapt your teaching style to the student's needs

When a student asks a question:
1. First assess what they already know about the topic
2. Identify any misconceptions
3. Build on their existing knowledge
4. Check for understanding before moving on

Use the web search tool when you need current information, statistics, or to verify facts.

Keep responses conversational and engaging. Speak naturally without markdown or lists since this is a voice conversation.`;

// Note: Tools and voice options are now configured in the Vogent Call Agent
// via the Vogent dashboard, not in code
