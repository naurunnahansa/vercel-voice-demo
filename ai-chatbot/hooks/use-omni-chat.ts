"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  type VoiceProvider,
  type VogentStatus,
  getVogentStatusMessage,
  getVapiStatusMessage,
} from "@/lib/ai/omni-voice";

// Dynamic imports for provider SDKs
let VogentCall: typeof import("@vogent/vogent-web-client").VogentCall;
let Vapi: typeof import("@vapi-ai/web").default;
let UltravoxSession: typeof import("ultravox-client").UltravoxSession;
let UltravoxSessionStatus: typeof import("ultravox-client").UltravoxSessionStatus;

export interface ToolCall {
  toolName: string;
  parameters: Record<string, unknown>;
  invocationId: string;
}

interface ChatMessage {
  role: string;
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>;
}

interface UseOmniChatOptions {
  provider: VoiceProvider;
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

interface OmniChatState {
  isConnected: boolean;
  isConnecting: boolean;
  status: string;
  statusMessage: string;
  transcripts: { role: string; text: string }[];
  callId: string | null;
  error: string | null;
  isMuted: boolean;
  provider: VoiceProvider;
}

// ============================================================================
// Vogent Provider Implementation
// ============================================================================

function useVogentProvider(
  options: UseOmniChatOptions,
  state: OmniChatState,
  setState: React.Dispatch<React.SetStateAction<OmniChatState>>
) {
  const callRef = useRef<InstanceType<typeof VogentCall> | null>(null);
  const transcriptUnsubscribeRef = useRef<(() => void) | null>(null);

  const handleTranscriptUpdate = useCallback(
    (transcript: Array<{ text: string; speaker: string }>) => {
      // Filter out empty/blank messages and map speaker to role
      const formattedTranscripts = transcript
        .filter((t) => t.text && t.text.trim().length > 0)
        .map((t) => {
          // Vogent uses "HUMAN" for user and "AI" for assistant (uppercase)
          const speaker = String(t.speaker || "").toUpperCase();
          const role = speaker === "HUMAN" || speaker === "USER" ? "user" : "assistant";
          console.log("[Vogent] Transcript:", { speaker: t.speaker, mappedRole: role, text: t.text?.substring(0, 30) });
          return {
            role,
            text: t.text,
          };
        });
      setState((prev) => ({ ...prev, transcripts: formattedTranscripts }));
      options.onTranscriptUpdate?.(formattedTranscripts);
    },
    [options, setState]
  );

  const startCall = useCallback(async () => {
    if (state.isConnecting || state.isConnected) return;
    setState((prev) => ({ ...prev, isConnecting: true, error: null }));

    try {
      // Dynamically import Vogent SDK
      if (!VogentCall) {
        const vogentModule = await import("@vogent/vogent-web-client");
        VogentCall = vogentModule.VogentCall;
      }

      const response = await fetch("/api/omni-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "vogent",
          messages: options.messages,
        }),
      });

      if (!response.ok) throw new Error(await response.text());

      const { sessionId, dialId, dialToken } = await response.json();

      const call = new VogentCall({ sessionId, dialId, token: dialToken });
      callRef.current = call;

      call.on("status", (status: VogentStatus) => {
        console.log("[Vogent] Status changed:", status);
        // Vogent status can be: "connecting", "connected", "ended", "error"
        const normalizedStatus = String(status).toLowerCase();
        const isConnected = normalizedStatus === "connected";
        setState((prev) => ({
          ...prev,
          status: normalizedStatus,
          statusMessage: getVogentStatusMessage(normalizedStatus as VogentStatus),
          isConnected,
          // Keep isConnecting false once connected
          isConnecting: isConnected ? false : prev.isConnecting,
        }));
        options.onStatusChange?.(normalizedStatus);
      });

      const unsubscribe = call.monitorTranscript(handleTranscriptUpdate);
      transcriptUnsubscribeRef.current = unsubscribe;

      await call.start();
      await call.connectAudio();

      setState((prev) => ({
        ...prev,
        isConnecting: false,
        isConnected: true,
        callId: dialId,
        status: "connected",
      }));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to start call";
      setState((prev) => ({ ...prev, isConnecting: false, error: errorMessage }));
      options.onError?.(
        error instanceof Error ? error : new Error(errorMessage)
      );
    }
  }, [state.isConnecting, state.isConnected, options, handleTranscriptUpdate, setState]);

  const endCall = useCallback(async () => {
    if (!callRef.current) return;
    try {
      transcriptUnsubscribeRef.current?.();
      transcriptUnsubscribeRef.current = null;
      await callRef.current.hangup();
      if (state.callId) {
        await fetch(`/api/omni-voice?provider=vogent&dialId=${state.callId}`, {
          method: "DELETE",
        });
      }
    } catch (error) {
      console.error("Error ending Vogent call:", error);
    } finally {
      callRef.current = null;
    }
  }, [state.callId]);

  const toggleMute = useCallback(async () => {
    if (!callRef.current) return;
    const newPausedState = !state.isMuted;
    try {
      await callRef.current.setPaused(newPausedState);
      setState((prev) => ({ ...prev, isMuted: newPausedState }));
    } catch (error) {
      console.error("Error toggling mute:", error);
    }
  }, [state.isMuted, setState]);

  const cleanup = useCallback(() => {
    if (callRef.current) {
      callRef.current.hangup();
      callRef.current = null;
    }
    transcriptUnsubscribeRef.current?.();
    transcriptUnsubscribeRef.current = null;
  }, []);

  return { startCall, endCall, toggleMute, cleanup };
}

// ============================================================================
// Vapi Provider Implementation
// ============================================================================

function useVapiProvider(
  options: UseOmniChatOptions,
  state: OmniChatState,
  setState: React.Dispatch<React.SetStateAction<OmniChatState>>
) {
  const vapiRef = useRef<InstanceType<typeof Vapi> | null>(null);

  const updateStatus = useCallback(
    (status: string, message: string) => {
      setState((prev) => ({ ...prev, status, statusMessage: message }));
      options.onStatusChange?.(status);
    },
    [options, setState]
  );

  const startCall = useCallback(async () => {
    if (state.isConnecting || state.isConnected) return;
    setState((prev) => ({ ...prev, isConnecting: true, error: null }));

    try {
      // Dynamically import Vapi SDK
      if (!Vapi) {
        const vapiModule = await import("@vapi-ai/web");
        Vapi = vapiModule.default;
      }

      const vapi = new Vapi(process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY || "");
      vapiRef.current = vapi;

      vapi.on("call-start", () => {
        updateStatus("connected", "Connected - Ready");
        setState((prev) => ({ ...prev, isConnecting: false, isConnected: true }));
      });

      vapi.on("call-end", () => {
        updateStatus("disconnected", "Disconnected");
        setState((prev) => ({ ...prev, isConnected: false, callId: null }));
      });

      vapi.on("speech-start", () => updateStatus("listening", "Listening..."));
      vapi.on("speech-end", () => updateStatus("thinking", "Thinking..."));

      vapi.on("message", (message: any) => {
        if (message.type === "transcript" && message.transcriptType === "final") {
          const role = message.role === "user" ? "user" : "assistant";
          const text = message.transcript || message.content || "";
          if (!text.trim()) return;

          setState((prev) => {
            const newTranscripts = [...prev.transcripts, { role, text }];
            setTimeout(() => options.onTranscriptUpdate?.(newTranscripts), 0);
            return { ...prev, transcripts: newTranscripts };
          });
        }

        if (message.type === "function-call") {
          const toolCall: ToolCall = {
            toolName: message.functionCall?.name || "",
            parameters: message.functionCall?.parameters || {},
            invocationId: message.functionCall?.id || "",
          };
          setTimeout(() => options.onToolCall?.(toolCall), 0);
        }
      });

      vapi.on("error", (error: any) => {
        const errorMessage = error?.message || error?.error?.message || "";
        if (
          errorMessage.toLowerCase().includes("meeting ended") ||
          errorMessage.toLowerCase().includes("ejection")
        )
          return;
        if (errorMessage) {
          console.error("Vapi error:", error);
          setState((prev) => ({ ...prev, error: errorMessage }));
          options.onError?.(new Error(errorMessage));
        }
      });

      // Start with assistant ID from env or hardcoded
      const assistantId = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID || "7defa15b-5fcf-48d5-9bd6-07a676a8317c";
      const call = await vapi.start(assistantId);

      if (call?.id) {
        setState((prev) => ({ ...prev, callId: call.id }));
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to start call";
      setState((prev) => ({ ...prev, isConnecting: false, error: errorMessage }));
      options.onError?.(
        error instanceof Error ? error : new Error(errorMessage)
      );
    }
  }, [state.isConnecting, state.isConnected, options, updateStatus, setState]);

  const endCall = useCallback(() => {
    if (!vapiRef.current) return;
    try {
      vapiRef.current.stop();
    } catch (error: any) {
      // Ignore "meeting ended" errors - these are normal call termination
      const errorMessage = error?.message || "";
      if (
        !errorMessage.toLowerCase().includes("meeting ended") &&
        !errorMessage.toLowerCase().includes("ejection")
      ) {
        console.error("Error ending Vapi call:", error);
      }
    } finally {
      vapiRef.current = null;
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (!vapiRef.current) return;
    const currentlyMuted = vapiRef.current.isMuted();
    vapiRef.current.setMuted(!currentlyMuted);
    setState((prev) => ({ ...prev, isMuted: !currentlyMuted }));
  }, [setState]);

  const cleanup = useCallback(() => {
    if (vapiRef.current) {
      try {
        vapiRef.current.stop();
      } catch {
        // Ignore cleanup errors
      }
      vapiRef.current = null;
    }
  }, []);

  return { startCall, endCall, toggleMute, cleanup };
}

// ============================================================================
// Ultravox Provider Implementation
// ============================================================================

function useUltravoxProvider(
  options: UseOmniChatOptions,
  state: OmniChatState,
  setState: React.Dispatch<React.SetStateAction<OmniChatState>>
) {
  const sessionRef = useRef<InstanceType<typeof UltravoxSession> | null>(null);

  const updateTranscripts = useCallback(() => {
    if (!sessionRef.current) return;
    const transcripts = sessionRef.current.transcripts.map((t: any) => {
      const speaker = String(t.speaker || "").toLowerCase();
      return {
        role: speaker === "user" ? "user" : "assistant",
        text: t.text,
      };
    });
    setState((prev) => ({ ...prev, transcripts }));
    options.onTranscriptUpdate?.(transcripts);
  }, [options, setState]);

  const getUltravoxStatusMessage = useCallback((status: any): string => {
    if (!UltravoxSessionStatus) return "Unknown";
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
  }, []);

  const startCall = useCallback(async () => {
    if (state.isConnecting || state.isConnected) return;
    setState((prev) => ({ ...prev, isConnecting: true, error: null }));

    try {
      // Dynamically import Ultravox SDK
      if (!UltravoxSession) {
        const ultravoxModule = await import("ultravox-client");
        UltravoxSession = ultravoxModule.UltravoxSession;
        UltravoxSessionStatus = ultravoxModule.UltravoxSessionStatus;
      }

      const response = await fetch("/api/omni-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "ultravox",
          systemPrompt: options.systemPrompt,
          voice: options.voice,
          model: options.model,
          temperature: options.temperature,
          messages: options.messages,
        }),
      });

      if (!response.ok) throw new Error(await response.text());

      const { joinUrl, callId } = await response.json();

      const session = new UltravoxSession();
      sessionRef.current = session;

      session.addEventListener("status", () => {
        const status = session.status;
        setState((prev) => ({
          ...prev,
          status: String(status),
          statusMessage: getUltravoxStatusMessage(status),
          isConnected:
            status !== UltravoxSessionStatus.DISCONNECTED &&
            status !== UltravoxSessionStatus.DISCONNECTING,
        }));
        options.onStatusChange?.(String(status));
      });

      session.addEventListener("transcripts", updateTranscripts);

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

      // Register tool handlers
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
            if (!response.ok) return "Search failed. Please try again.";
            const { summary } = await response.json();
            return summary || "No results found.";
          } catch {
            return "Search failed due to an error.";
          }
        }
      );

      session.registerToolImplementation(
        "getCurrentMayorOfNewYork",
        async () => "Himashi"
      );

      await session.joinCall(joinUrl);

      setState((prev) => ({
        ...prev,
        isConnecting: false,
        isConnected: true,
        callId,
      }));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to start call";
      setState((prev) => ({ ...prev, isConnecting: false, error: errorMessage }));
      options.onError?.(
        error instanceof Error ? error : new Error(errorMessage)
      );
    }
  }, [
    state.isConnecting,
    state.isConnected,
    options,
    updateTranscripts,
    getUltravoxStatusMessage,
    setState,
  ]);

  const endCall = useCallback(async () => {
    if (!sessionRef.current) return;
    try {
      sessionRef.current.leaveCall();
      if (state.callId) {
        await fetch(`/api/omni-voice?provider=ultravox&callId=${state.callId}`, {
          method: "DELETE",
        });
      }
    } catch (error) {
      console.error("Error ending Ultravox call:", error);
    } finally {
      sessionRef.current = null;
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
  }, [setState]);

  const cleanup = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.leaveCall();
      sessionRef.current = null;
    }
  }, []);

  return { startCall, endCall, toggleMute, cleanup };
}

// ============================================================================
// Main Hook
// ============================================================================

export function useOmniChat(options: UseOmniChatOptions) {
  const [state, setState] = useState<OmniChatState>({
    isConnected: false,
    isConnecting: false,
    status: "disconnected",
    statusMessage: "Disconnected",
    transcripts: [],
    callId: null,
    error: null,
    isMuted: false,
    provider: options.provider,
  });

  const vogent = useVogentProvider(options, state, setState);
  const vapi = useVapiProvider(options, state, setState);
  const ultravox = useUltravoxProvider(options, state, setState);

  const getProvider = useCallback(() => {
    switch (options.provider) {
      case "vogent":
        return vogent;
      case "vapi":
        return vapi;
      case "ultravox":
        return ultravox;
      default:
        return vogent;
    }
  }, [options.provider, vogent, vapi, ultravox]);

  const startCall = useCallback(async () => {
    const provider = getProvider();
    await provider.startCall();
  }, [getProvider]);

  const endCall = useCallback(async () => {
    const provider = getProvider();
    await provider.endCall();
    setState((prev) => ({
      ...prev,
      isConnected: false,
      isConnecting: false,
      status: "disconnected",
      statusMessage: "Disconnected",
      transcripts: [],
      callId: null,
      error: null,
      isMuted: false,
    }));
  }, [getProvider]);

  const toggleMute = useCallback(async () => {
    const provider = getProvider();
    await provider.toggleMute();
  }, [getProvider]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      vogent.cleanup();
      vapi.cleanup();
      ultravox.cleanup();
    };
  }, []);

  // Update provider in state when it changes
  useEffect(() => {
    setState((prev) => ({ ...prev, provider: options.provider }));
  }, [options.provider]);

  return {
    ...state,
    startCall,
    endCall,
    toggleMute,
  };
}
