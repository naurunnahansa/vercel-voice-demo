import { UltravoxSession, UltravoxSessionStatus } from "ultravox-client";

export interface VoiceConfig {
  apiKey: string;
  systemPrompt?: string;
  voice?: string;
  temperature?: number;
  model?: string;
}

export interface CallConfig {
  systemPrompt: string;
  model?: string;
  voice?: string;
  temperature?: number;
  languageHint?: string;
}

export async function createUltravoxCall(config: CallConfig): Promise<{ joinUrl: string; callId: string }> {
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

export const DEFAULT_SYSTEM_PROMPT = `You are a helpful voice assistant. Keep your responses concise and conversational.
Speak naturally as if having a friendly conversation. Avoid using markdown, lists, or other text formatting
since you are speaking out loud.`;

export const VOICE_OPTIONS = [
  { id: "Mark", name: "Mark (Male)" },
  { id: "Jessica", name: "Jessica (Female)" },
  { id: "Sarah", name: "Sarah (Female)" },
  { id: "John", name: "John (Male)" },
];
