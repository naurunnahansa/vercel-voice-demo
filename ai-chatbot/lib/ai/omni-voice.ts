// Omni-Voice: Unified voice provider library supporting Vogent, Vapi, and Ultravox

export type VoiceProvider = "vogent" | "vapi" | "ultravox";

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

// ============================================================================
// Vogent Types & Functions
// ============================================================================

export interface VogentDialConfig {
  callAgentId: string;
  messages?: ChatMessage[];
}

export interface VogentDialResult {
  sessionId: string;
  dialId: string;
  dialToken: string;
}

export type VogentStatus = "connecting" | "connected" | "ended" | "error";

export async function createVogentDial(config: VogentDialConfig): Promise<VogentDialResult> {
  const response = await fetch("https://api.vogent.ai/api/dials", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VOGENT_PUBLIC_API_KEY || ""}`,
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

export function getVogentStatusMessage(status: VogentStatus): string {
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

// ============================================================================
// Vapi Types & Functions
// ============================================================================

export interface VapiCallConfig {
  systemPrompt: string;
  model?: string;
  voice?: string;
  temperature?: number;
  messages?: ChatMessage[];
}

export interface VapiCallResult {
  joinUrl: string;
  callId: string;
}

function formatMessagesForVapi(
  messages: ChatMessage[]
): Array<{ role: "user" | "assistant" | "system"; content: string }> {
  return messages
    .map((msg) => {
      const textPart = msg.parts.find((p) => p.type === "text" && p.text);
      if (!textPart?.text) return null;
      const role =
        msg.role === "user"
          ? "user"
          : msg.role === "system"
            ? "system"
            : "assistant";
      return {
        role,
        content: textPart.text,
      };
    })
    .filter(
      (m): m is { role: "user" | "assistant" | "system"; content: string } =>
        m !== null
    );
}

function getVapiVoiceId(voiceName: string): string {
  const voiceMap: Record<string, string> = {
    Mark: "mark",
    Jessica: "jessica",
    Sarah: "sarah",
    John: "john",
  };
  return voiceMap[voiceName] || "mark";
}

export async function createVapiCall(config: VapiCallConfig): Promise<VapiCallResult> {
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
      voiceId: getVapiVoiceId(config.voice || "Mark"),
    },
    firstMessage: "Hello! How can I help you today?",
    ...(process.env.VAPI_SERVER_URL && {
      serverUrl: process.env.VAPI_SERVER_URL,
      serverUrlSecret: process.env.VAPI_SERVER_URL_SECRET,
    }),
  };

  const response = await fetch("https://api.vapi.ai/call/web", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ assistant }),
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
}

export async function endVapiCall(callId: string): Promise<void> {
  try {
    const response = await fetch(`https://api.vapi.ai/call/${callId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      console.error(`Failed to end Vapi call: ${response.status}`);
    }
  } catch (error) {
    console.error("Failed to end Vapi call:", error);
  }
}

export function getVapiStatusMessage(status: string): string {
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

// ============================================================================
// Ultravox Types & Functions
// ============================================================================

export interface UltravoxCallConfig {
  systemPrompt: string;
  model?: string;
  voice?: string;
  temperature?: number;
  languageHint?: string;
  messages?: ChatMessage[];
}

export interface UltravoxCallResult {
  joinUrl: string;
  callId: string;
}

function formatMessagesForUltravox(
  messages: ChatMessage[]
): Array<{ role: string; content: string }> {
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

export const ULTRAVOX_WEB_SEARCH_TOOL = {
  temporaryTool: {
    modelToolName: "webSearch",
    description:
      "Search the web for current information, facts, statistics, or to answer questions that require up-to-date knowledge.",
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

export const ULTRAVOX_NYC_MAYOR_TOOL = {
  temporaryTool: {
    modelToolName: "getCurrentMayorOfNewYork",
    description: "Get the current mayor of New York City.",
    dynamicParameters: [],
    client: {},
  },
};

export async function createUltravoxCall(
  config: UltravoxCallConfig
): Promise<UltravoxCallResult> {
  const initialMessages = config.messages
    ? formatMessagesForUltravox(config.messages)
    : undefined;

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
      selectedTools: [ULTRAVOX_WEB_SEARCH_TOOL, ULTRAVOX_NYC_MAYOR_TOOL],
      ...(initialMessages &&
        initialMessages.length > 0 && { initialMessages }),
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

export async function endUltravoxCall(callId: string): Promise<void> {
  const response = await fetch(
    `https://api.ultravox.ai/api/calls/${callId}`,
    {
      method: "DELETE",
      headers: {
        "X-API-Key": process.env.ULTRAVOX_API_KEY || "",
      },
    }
  );

  // Accept success, not found (already ended), gone (expired), or too early as valid responses
  if (!response.ok && ![404, 410, 425].includes(response.status)) {
    console.error(`Failed to end call ${callId}: ${response.status}`);
    throw new Error("Failed to end call");
  }
}

// ============================================================================
// Shared Constants
// ============================================================================

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

export const PROVIDER_INFO: Record<
  VoiceProvider,
  { name: string; description: string }
> = {
  vogent: {
    name: "Vogent",
    description: "Vogent AI voice platform",
  },
  vapi: {
    name: "Vapi",
    description: "Vapi conversational AI",
  },
  ultravox: {
    name: "Ultravox",
    description: "Ultravox real-time voice AI",
  },
};
