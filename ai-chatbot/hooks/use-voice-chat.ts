"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { VogentCall } from "@vogent/vogent-web-client";
import { getStatusMessage, type VogentStatus } from "@/lib/ai/voice";

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
  onStatusChange?: (status: UltravoxSessionStatus) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onError?: (error: Error) => void;
}

interface VoiceChatState {
  isConnected: boolean;
  isConnecting: boolean;
  status: VogentStatus | "disconnected";
  statusMessage: string;
  transcripts: { role: string; text: string }[];
  dialId: string | null;
  error: string | null;
  isPaused: boolean;
}

export function useVoiceChat(options: UseVoiceChatOptions = {}) {
  const callRef = useRef<VogentCall | null>(null);
  const transcriptUnsubscribeRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<VoiceChatState>({
    isConnected: false,
    isConnecting: false,
    status: "disconnected",
    statusMessage: "Disconnected",
    transcripts: [],
    dialId: null,
    error: null,
    isPaused: false,
  });

  // Vogent uses a callback pattern for transcripts
  const handleTranscriptUpdate = useCallback((transcript: Array<{text: string; speaker: string}>) => {
    const formattedTranscripts = transcript.map((t) => {
      const role = t.speaker === "user" ? "user" : "assistant";
      console.log("[Voice] Transcript:", {
        rawSpeaker: t.speaker,
        role,
        text: t.text?.substring(0, 50)
      });
      return {
        role,
        text: t.text,
      };
    });

    setState((prev) => ({ ...prev, transcripts: formattedTranscripts }));
    options.onTranscriptUpdate?.(formattedTranscripts);
  }, [options]);

  const startCall = useCallback(async () => {
    if (state.isConnecting || state.isConnected) return;

    setState((prev) => ({ ...prev, isConnecting: true, error: null }));

    try {
      // Step 1: Create a dial via the API
      const response = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: options.messages,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const { sessionId, dialId, dialToken } = await response.json();

      // Step 2: Create VogentCall instance
      const call = new VogentCall({
        sessionId,
        dialId,
        token: dialToken,
      });
      callRef.current = call;

      // Step 3: Set up status listener
      call.on("status", (status: VogentStatus) => {
        console.log("[Voice] Status changed:", status);
        setState((prev) => ({
          ...prev,
          status,
          statusMessage: getStatusMessage(status),
          isConnected: status === "connected",
        }));
        options.onStatusChange?.(status as any);
      });

      // Step 4: Set up transcript monitoring
      const unsubscribe = call.monitorTranscript(handleTranscriptUpdate);
      transcriptUnsubscribeRef.current = unsubscribe;

      // Step 5: Start the call
      await call.start();

      // Step 6: Connect audio
      await call.connectAudio();

      setState((prev) => ({
        ...prev,
        isConnecting: false,
        isConnected: true,
        dialId,
        status: "connected",
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
  }, [state.isConnecting, state.isConnected, options, handleTranscriptUpdate]);

  const endCall = useCallback(async () => {
    if (!callRef.current) return;

    try {
      // Unsubscribe from transcript updates
      if (transcriptUnsubscribeRef.current) {
        transcriptUnsubscribeRef.current();
        transcriptUnsubscribeRef.current = null;
      }

      // Hangup the call
      await callRef.current.hangup();

      // Optionally notify server (Vogent handles cleanup automatically)
      if (state.dialId) {
        await fetch(`/api/voice?dialId=${state.dialId}`, {
          method: "DELETE",
        });
      }
    } catch (error) {
      console.error("Error ending call:", error);
    } finally {
      callRef.current = null;
      setState({
        isConnected: false,
        isConnecting: false,
        status: "disconnected",
        statusMessage: "Disconnected",
        transcripts: [],
        dialId: null,
        error: null,
        isPaused: false,
      });
    }
  }, [state.dialId]);

  const togglePause = useCallback(async () => {
    if (!callRef.current) return;

    const newPausedState = !state.isPaused;
    try {
      await callRef.current.setPaused(newPausedState);
      setState((prev) => ({ ...prev, isPaused: newPausedState }));
    } catch (error) {
      console.error("Error toggling pause:", error);
    }
  }, [state.isPaused]);

  useEffect(() => {
    return () => {
      if (callRef.current) {
        callRef.current.hangup();
        callRef.current = null;
      }
      if (transcriptUnsubscribeRef.current) {
        transcriptUnsubscribeRef.current();
        transcriptUnsubscribeRef.current = null;
      }
    };
  }, []);

  return {
    ...state,
    isMuted: state.isPaused, // Expose isPaused as isMuted for compatibility
    startCall,
    endCall,
    toggleMute: togglePause, // Renamed but keeping interface for compatibility
  };
}
