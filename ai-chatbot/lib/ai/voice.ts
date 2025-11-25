import { UltravoxSession, UltravoxSessionStatus } from "ultravox-client";

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

export interface CallConfig {
  systemPrompt: string;
  model?: string;
  voice?: string;
  temperature?: number;
  languageHint?: string;
  messages?: ChatMessage[];
}

function formatMessagesForUltravox(messages: ChatMessage[]): Array<{ role: string; content: string }> {
  return messages
    .map((msg) => {
      const textPart = msg.parts.find((p) => p.type === "text" && p.text);
      if (!textPart?.text) return null;
      return {
        role: msg.role === "user" ? "user" : "assistant",
        content: textPart.text,
      };
    })
    .filter((m): m is { role: string; content: string } => m !== null);
}

export async function createUltravoxCall(config: CallConfig): Promise<{ joinUrl: string; callId: string }> {
  const initialMessages = config.messages ? formatMessagesForUltravox(config.messages) : undefined;

  const response = await fetch("https://api.ultravox.ai/api/calls", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": process.env.ULTRAVOX_API_KEY || "",
    },
    body: JSON.stringify({
      systemPrompt: config.systemPrompt,
      model: config.model || "fixie-ai/ultravox-70B",
      voice: config.voice || "Mark",
      temperature: config.temperature || 0.7,
      languageHint: config.languageHint || "en",
      selectedTools: [WEB_SEARCH_TOOL, NYC_MAYOR_TOOL],
      ...(initialMessages && initialMessages.length > 0 && { initialMessages }),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create Ultravox call: ${error}`);
  }

  const data = await response.json();
  return {
    joinUrl: data.joinUrl,
    callId: data.callId,
  };
}

export function createVoiceSession(): UltravoxSession {
  return new UltravoxSession();
}

export function getStatusMessage(status: UltravoxSessionStatus): string {
  switch (status) {
    case UltravoxSessionStatus.DISCONNECTED:
      return "Disconnected";
    case UltravoxSessionStatus.DISCONNECTING:
      return "Disconnecting...";
    case UltravoxSessionStatus.CONNECTING:
      return "Connecting...";
    case UltravoxSessionStatus.IDLE:
      return "Connected - Ready";
    case UltravoxSessionStatus.LISTENING:
      return "Listening...";
    case UltravoxSessionStatus.THINKING:
      return "Thinking...";
    case UltravoxSessionStatus.SPEAKING:
      return "Speaking...";
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

export const WEB_SEARCH_TOOL = {
  temporaryTool: {
    modelToolName: "webSearch",
    description: "Search the web for current information, facts, statistics, or to answer questions that require up-to-date knowledge.",
    dynamicParameters: [
      {
        name: "query",
        location: "PARAMETER_LOCATION_BODY",
        schema: {
          type: "string",
          description: "The search query to look up on the web",
        },
        required: true,
      },
    ],
    client: {},
  },
};

export const NYC_MAYOR_TOOL = {
  temporaryTool: {
    modelToolName: "getCurrentMayorOfNewYork",
    description: "Get the current mayor of New York City.",
    dynamicParameters: [],
    client: {},
  },
};

export const VOICE_OPTIONS = [
  { id: "Mark", name: "Mark (Male)" },
  { id: "Jessica", name: "Jessica (Female)" },
  { id: "Sarah", name: "Sarah (Female)" },
  { id: "John", name: "John (Male)" },
];
