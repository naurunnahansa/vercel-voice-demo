"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { UltravoxSession, UltravoxSessionStatus } from "ultravox-client";
import { getStatusMessage } from "@/lib/ai/voice";

export interface ToolCall {
  toolName: string;
  parameters: Record<string, unknown>;
  invocationId: string;
}

interface UseVoiceChatOptions {
  systemPrompt?: string;
  voice?: string;
  model?: string;
  temperature?: number;
  onTranscriptUpdate?: (transcript: { role: string; text: string }[]) => void;
  onStatusChange?: (status: UltravoxSessionStatus) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onError?: (error: Error) => void;
}

interface VoiceChatState {
  isConnected: boolean;
  isConnecting: boolean;
  status: UltravoxSessionStatus;
  statusMessage: string;
  transcripts: { role: string; text: string }[];
  callId: string | null;
  error: string | null;
  isMuted: boolean;
}

export function useVoiceChat(options: UseVoiceChatOptions = {}) {
  const sessionRef = useRef<UltravoxSession | null>(null);
  const [state, setState] = useState<VoiceChatState>({
    isConnected: false,
    isConnecting: false,
    status: UltravoxSessionStatus.DISCONNECTED,
    statusMessage: "Disconnected",
    transcripts: [],
    callId: null,
    error: null,
    isMuted: false,
  });

  const updateTranscripts = useCallback(() => {
    if (!sessionRef.current) return;

    const transcripts = sessionRef.current.transcripts.map((t) => ({
      role: t.speaker === "user" ? "user" : "assistant",
      text: t.text,
    }));

    setState((prev) => ({ ...prev, transcripts }));
    options.onTranscriptUpdate?.(transcripts);
  }, [options]);

  const startCall = useCallback(async () => {
    if (state.isConnecting || state.isConnected) return;

    setState((prev) => ({ ...prev, isConnecting: true, error: null }));

    try {
      const response = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: options.systemPrompt,
          voice: options.voice,
          model: options.model,
          temperature: options.temperature,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const { joinUrl, callId } = await response.json();

      const session = new UltravoxSession();
      sessionRef.current = session;

      session.addEventListener("status", () => {
        const status = session.status;
        setState((prev) => ({
          ...prev,
          status,
          statusMessage: getStatusMessage(status),
          isConnected: status !== UltravoxSessionStatus.DISCONNECTED &&
                       status !== UltravoxSessionStatus.DISCONNECTING,
        }));
        options.onStatusChange?.(status);
      });

      session.addEventListener("transcripts", updateTranscripts);

      // Listen for experimental messages (includes tool calls)
      session.addEventListener("experimentalMessage", (event: any) => {
        const message = event.message;
        if (message?.type === "client_tool_invocation") {
          const toolCall: ToolCall = {
            toolName: message.toolName,
            parameters: message.parameters || {},
            invocationId: message.invocationId,
          };
          options.onToolCall?.(toolCall);
        }
      });

      // Register web search tool handler
      session.registerToolImplementation(
        "webSearch",
        async (parameters: Record<string, unknown>) => {
          const query = parameters.query as string;

          try {
            const response = await fetch("/api/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query }),
            });

            if (!response.ok) {
              return "Search failed. Please try again.";
            }

            const { summary } = await response.json();
            return summary || "No results found.";
          } catch (error) {
            console.error("Web search error:", error);
            return "Search failed due to an error.";
          }
        }
      );

      // Register NYC mayor tool handler
      session.registerToolImplementation(
        "getCurrentMayorOfNewYork",
        async () => {
          return "Himashi";
        }
      );

      await session.joinCall(joinUrl);

      setState((prev) => ({
        ...prev,
        isConnecting: false,
        isConnected: true,
        callId,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to start call";
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        error: errorMessage,
      }));
      options.onError?.(error instanceof Error ? error : new Error(errorMessage));
    }
  }, [state.isConnecting, state.isConnected, options, updateTranscripts]);

  const endCall = useCallback(async () => {
    if (!sessionRef.current) return;

    try {
      sessionRef.current.leaveCall();

      if (state.callId) {
        await fetch(`/api/voice?callId=${state.callId}`, {
          method: "DELETE",
        });
      }
    } catch (error) {
      console.error("Error ending call:", error);
    } finally {
      sessionRef.current = null;
      setState({
        isConnected: false,
        isConnecting: false,
        status: UltravoxSessionStatus.DISCONNECTED,
        statusMessage: "Disconnected",
        transcripts: [],
        callId: null,
        error: null,
      });
    }
  }, [state.callId]);

  const toggleMute = useCallback(() => {
    if (!sessionRef.current) return;

    const currentlyMuted = sessionRef.current.isMicMuted;
    if (currentlyMuted) {
      sessionRef.current.unmuteMic();
    } else {
      sessionRef.current.muteMic();
    }
    setState((prev) => ({ ...prev, isMuted: !currentlyMuted }));
  }, []);

  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        sessionRef.current.leaveCall();
        sessionRef.current = null;
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
