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

function formatMessagesForVapi(messages: ChatMessage[]): Array<{ role: "user" | "assistant" | "system"; content: string }> {
  return messages
    .map((msg) => {
      const textPart = msg.parts.find((p) => p.type === "text" && p.text);
      if (!textPart?.text) return null;
      const role = msg.role === "user" ? "user" : msg.role === "system" ? "system" : "assistant";
      return {
        role,
        content: textPart.text,
      };
    })
    .filter((m): m is { role: "user" | "assistant" | "system"; content: string } => m !== null);
}

export async function createVapiCall(config: CallConfig): Promise<{ joinUrl: string; callId: string }> {
  try {
    // Create assistant configuration
    const assistant = {
      model: {
        provider: "openai",
        model: config.model || "gpt-4o",
        temperature: config.temperature || 0.7,
        messages: [
          {
            role: "system" as const,
            content: config.systemPrompt,
          },
          ...(config.messages ? formatMessagesForVapi(config.messages) : []),
        ],
      },
      voice: {
        provider: "11labs",
        voiceId: getVoiceId(config.voice || "Mark"),
      },
      firstMessage: "Hello! How can I help you today?",
      ...(process.env.VAPI_SERVER_URL && {
        serverUrl: process.env.VAPI_SERVER_URL,
        serverUrlSecret: process.env.VAPI_SERVER_URL_SECRET,
      }),
    };

    // Create a call with the assistant using REST API
    const response = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.VAPI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assistant,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create Vapi call: ${error}`);
    }

    const data = await response.json();

    return {
      joinUrl: data.webCallUrl || "",
      callId: data.id || "",
    };
  } catch (error) {
    console.error("Failed to create Vapi call:", error);
    throw new Error(`Failed to create Vapi call: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function getVoiceId(voiceName: string): string {
  const voiceMap: Record<string, string> = {
    Mark: "mark",
    Jessica: "jessica",
    Sarah: "sarah",
    John: "john",
  };
  return voiceMap[voiceName] || "mark";
}

export async function endVapiCall(callId: string): Promise<void> {
  try {
    const response = await fetch(`https://api.vapi.ai/call/${callId}`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${process.env.VAPI_API_KEY}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      console.error(`Failed to end Vapi call: ${response.status}`);
    }
  } catch (error) {
    // Ignore errors for already ended calls
    console.error("Failed to end Vapi call:", error);
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

export const VOICE_OPTIONS = [
  { id: "Mark", name: "Mark (Male)" },
  { id: "Jessica", name: "Jessica (Female)" },
  { id: "Sarah", name: "Sarah (Female)" },
  { id: "John", name: "John (Male)" },
];

// Status enum for Vapi
export enum VapiStatus {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  ACTIVE = "active",
  ENDED = "ended",
}

export function getStatusMessage(status: string): string {
  switch (status) {
    case "disconnected":
      return "Disconnected";
    case "connecting":
      return "Connecting...";
    case "connected":
      return "Connected - Ready";
    case "active":
      return "Active";
    case "ended":
      return "Call Ended";
    default:
      return "Unknown";
  }
}
