"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Vapi from "@vapi-ai/web";

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
      // Get the join URL from the backend
      const response = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: options.systemPrompt,
          voice: options.voice,
          model: options.model,
          temperature: options.temperature,
          messages: options.messages,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const { joinUrl, callId } = await response.json();

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
          callId,
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
          const role = message.role === "user" ? "user" : "assistant";
          const text = message.transcript || message.content || "";

          setState((prev) => {
            const newTranscripts = [
              ...prev.transcripts,
              { role, text },
            ];
            options.onTranscriptUpdate?.(newTranscripts);
            return { ...prev, transcripts: newTranscripts };
          });
        }

        if (message.type === "function-call") {
          const toolCall: ToolCall = {
            toolName: message.functionCall?.name || "",
            parameters: message.functionCall?.parameters || {},
            invocationId: message.functionCall?.id || "",
          };
          options.onToolCall?.(toolCall);
        }
      });

      vapi.on("error", (error: any) => {
        console.error("Vapi error:", error);
        const errorMessage = error?.message || "Voice call error";
        setState((prev) => ({ ...prev, error: errorMessage }));
        options.onError?.(new Error(errorMessage));
      });

      // Start the call with the web call URL
      await vapi.start(joinUrl);

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

  const endCall = useCallback(async () => {
    if (!vapiRef.current) return;

    try {
      vapiRef.current.stop();

      if (state.callId) {
        await fetch(`/api/voice?callId=${state.callId}`, {
          method: "DELETE",
        });
      }
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
  }, [state.callId]);

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
