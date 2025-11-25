"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Vapi from "@vapi-ai/web";

function getVoiceId(voiceName: string): string {
  const voiceMap: Record<string, string> = {
    Mark: "mark",
    Jessica: "jessica",
    Sarah: "sarah",
    John: "john",
  };
  return voiceMap[voiceName] || "mark";
}

export interface ToolCall {
  toolName: string;
  parameters: Record<string, unknown>;
  invocationId: string;
}

interface ChatMessage {
  role: string;
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>;
}

interface UseVoiceChatOptions {
  systemPrompt?: string;
  voice?: string;
  model?: string;
  temperature?: number;
  messages?: ChatMessage[];
  onTranscriptUpdate?: (transcript: { role: string; text: string }[]) => void;
  onStatusChange?: (status: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onError?: (error: Error) => void;
}

interface VoiceChatState {
  isConnected: boolean;
  isConnecting: boolean;
  status: string;
  statusMessage: string;
  transcripts: { role: string; text: string }[];
  callId: string | null;
  error: string | null;
  isMuted: boolean;
}

export function useVoiceChat(options: UseVoiceChatOptions = {}) {
  const vapiRef = useRef<Vapi | null>(null);
  const [state, setState] = useState<VoiceChatState>({
    isConnected: false,
    isConnecting: false,
    status: "disconnected",
    statusMessage: "Disconnected",
    transcripts: [],
    callId: null,
    error: null,
    isMuted: false,
  });

  const updateStatus = useCallback((status: string, message: string) => {
    setState((prev) => ({
      ...prev,
      status,
      statusMessage: message,
    }));
    options.onStatusChange?.(status);
  }, [options]);

  const startCall = useCallback(async () => {
    if (state.isConnecting || state.isConnected) return;

    setState((prev) => ({ ...prev, isConnecting: true, error: null }));

    try {
      // Initialize Vapi client
      const vapi = new Vapi(process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY || "");
      vapiRef.current = vapi;

      // Set up event listeners
      vapi.on("call-start", () => {
        updateStatus("connected", "Connected - Ready");
        setState((prev) => ({
          ...prev,
          isConnecting: false,
          isConnected: true,
        }));
      });

      vapi.on("call-end", () => {
        updateStatus("disconnected", "Disconnected");
        setState((prev) => ({
          ...prev,
          isConnected: false,
          callId: null,
        }));
      });

      vapi.on("speech-start", () => {
        updateStatus("listening", "Listening...");
      });

      vapi.on("speech-end", () => {
        updateStatus("thinking", "Thinking...");
      });

      vapi.on("message", (message: any) => {
        if (message.type === "transcript") {
          // Only process final transcripts, ignore partial ones
          // Vapi sends partial transcripts as speech is being recognized,
          // and a final transcript when the utterance is complete
          if (message.transcriptType !== "final") {
            return;
          }

          const role = message.role === "user" ? "user" : "assistant";
          const text = message.transcript || message.content || "";

          // Skip empty transcripts
          if (!text.trim()) {
            return;
          }

          setState((prev) => {
            const newTranscripts = [
              ...prev.transcripts,
              { role, text },
            ];
            // Call callback outside of setState to avoid setState-during-render errors
            // Use setTimeout to defer the callback to the next tick
            setTimeout(() => {
              options.onTranscriptUpdate?.(newTranscripts);
            }, 0);
            return { ...prev, transcripts: newTranscripts };
          });
        }

        if (message.type === "function-call") {
          const toolCall: ToolCall = {
            toolName: message.functionCall?.name || "",
            parameters: message.functionCall?.parameters || {},
            invocationId: message.functionCall?.id || "",
          };
          // Defer callback to avoid potential setState-during-render issues
          setTimeout(() => {
            options.onToolCall?.(toolCall);
          }, 0);
        }
      });

      vapi.on("error", (error: any) => {
        console.error("Vapi error:", error);
        const errorMessage = error?.message || error?.error?.message || "Voice call error";
        setState((prev) => ({ ...prev, error: errorMessage }));
        options.onError?.(new Error(errorMessage));
      });

      // Format messages for Vapi if provided
      const formattedMessages = options.messages
        ?.map((msg) => {
          const textPart = msg.parts.find((p) => p.type === "text" && p.text);
          if (!textPart?.text) return null;
          return {
            role: msg.role === "user" ? "user" as const : msg.role === "system" ? "system" as const : "assistant" as const,
            content: textPart.text,
          };
        })
        .filter((m): m is { role: "user" | "assistant" | "system"; content: string } => m !== null) || [];

      // Start the call with the assistant ID
      const call = await vapi.start("7defa15b-5fcf-48d5-9bd6-07a676a8317c");

      if (call?.id) {
        setState((prev) => ({ ...prev, callId: call.id }));
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to start call";
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        error: errorMessage,
      }));
      options.onError?.(error instanceof Error ? error : new Error(errorMessage));
    }
  }, [state.isConnecting, state.isConnected, options, updateStatus]);

  const endCall = useCallback(() => {
    if (!vapiRef.current) return;

    try {
      vapiRef.current.stop();
    } catch (error) {
      console.error("Error ending call:", error);
    } finally {
      vapiRef.current = null;
      setState({
        isConnected: false,
        isConnecting: false,
        status: "disconnected",
        statusMessage: "Disconnected",
        transcripts: [],
        callId: null,
        error: null,
        isMuted: false,
      });
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (!vapiRef.current) return;

    const currentlyMuted = vapiRef.current.isMuted();
    if (currentlyMuted) {
      vapiRef.current.setMuted(false);
    } else {
      vapiRef.current.setMuted(true);
    }
    setState((prev) => ({ ...prev, isMuted: !currentlyMuted }));
  }, []);

  useEffect(() => {
    return () => {
      if (vapiRef.current) {
        vapiRef.current.stop();
        vapiRef.current = null;
      }
    };
  }, []);

  return {
    ...state,
    startCall,
    endCall,
    toggleMute,
  };
}
