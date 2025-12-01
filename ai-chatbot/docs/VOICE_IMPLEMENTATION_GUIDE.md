# Voice Provider Implementation Guide

A detailed technical guide explaining how each voice provider (Vogent, Vapi, Ultravox) was implemented in this project, including step-by-step code walkthroughs, data flows, and comprehensive pros/cons analysis.

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [Vogent Implementation](#vogent-implementation)
3. [Vapi Implementation](#vapi-implementation)
4. [Ultravox Implementation](#ultravox-implementation)
5. [Unified Hook Architecture](#unified-hook-architecture)
6. [UI Integration](#ui-integration)
7. [Detailed Pros & Cons Analysis](#detailed-pros--cons-analysis)

---

## Project Structure

```
ai-chatbot/
├── lib/
│   └── ai/
│       └── omni-voice.ts          # Server-side API functions for all providers
├── hooks/
│   └── use-omni-chat.ts           # Unified React hook with provider implementations
├── app/
│   └── (chat)/
│       └── api/
│           └── omni-voice/
│               └── route.ts       # API endpoint handling all providers
├── components/
│   └── multimodal-input.tsx       # UI component with voice controls
└── package.json                   # SDK dependencies
```

### Dependencies

```json
{
  "@vogent/vogent-web-client": "^x.x.x",
  "@vapi-ai/web": "^x.x.x",
  "ultravox-client": "^x.x.x"
}
```

---

## Vogent Implementation

### Overview

Vogent uses an **agent-based architecture** where voice agents are pre-configured in the Vogent dashboard. Your application creates a "dial" session that connects to a specific agent.

### Step 1: Server-Side API Setup

**File: `/lib/ai/omni-voice.ts`**

```typescript
// Type definitions
export interface VogentDialConfig {
  callAgentId: string;      // ID of pre-configured agent from Vogent dashboard
  messages?: ChatMessage[]; // Optional conversation history (not used by Vogent)
}

export interface VogentDialResult {
  sessionId: string;   // Session identifier
  dialId: string;      // Unique dial/call identifier
  dialToken: string;   // JWT token for client authentication
}

// API function to create a dial session
export async function createVogentDial(config: VogentDialConfig): Promise<VogentDialResult> {
  // 1. Validate API key exists
  const apiKey = process.env.VOGENT_PUBLIC_API_KEY || "";
  if (!apiKey) {
    throw new Error("VOGENT_PUBLIC_API_KEY is not configured");
  }

  // 2. Make API request to Vogent
  const response = await fetch("https://api.vogent.ai/api/dials", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      callAgentId: config.callAgentId,  // The agent to connect to
      browserCall: true,                 // Indicates this is a browser-based call
    }),
  });

  // 3. Handle errors
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create Vogent dial: ${error}`);
  }

  // 4. Return credentials for client
  const data = await response.json();
  return {
    sessionId: data.sessionId,
    dialId: data.dialId,
    dialToken: data.dialToken,
  };
}
```

**Key Points:**
- Vogent doesn't accept system prompts or configuration at runtime
- All agent behavior is configured in the Vogent dashboard
- The `browserCall: true` flag is required for WebRTC connections
- Returns three tokens needed by the client SDK

### Step 2: API Route Handler

**File: `/app/(chat)/api/omni-voice/route.ts`**

```typescript
export async function POST(request: Request) {
  // 1. Authenticate user
  const session = await auth();
  if (!session || !session.user || !session.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await request.json();
    const { provider } = body;

    switch (provider) {
      case "vogent": {
        // 2. Get agent ID from env or use default
        const callAgentId = process.env.VOGENT_CALL_AGENT_ID || "default-agent-id";

        // 3. Create dial session
        const dialData = await createVogentDial({ callAgentId });

        // 4. Return credentials to client
        return Response.json({
          sessionId: dialData.sessionId,
          dialId: dialData.dialId,
          dialToken: dialData.dialToken,
        });
      }
      // ... other providers
    }
  } catch (error) {
    return new Response(error.message, { status: 500 });
  }
}
```

### Step 3: Client-Side Hook Implementation

**File: `/hooks/use-omni-chat.ts`**

```typescript
// Dynamic import to reduce bundle size
let VogentCall: typeof import("@vogent/vogent-web-client").VogentCall;

function useVogentProvider(options, state, setState) {
  // References to maintain across renders
  const callRef = useRef<InstanceType<typeof VogentCall> | null>(null);
  const transcriptUnsubscribeRef = useRef<(() => void) | null>(null);

  // Transcript handler - maps Vogent's format to our standard format
  const handleTranscriptUpdate = useCallback(
    (transcript: Array<{ text: string; speaker: string }>) => {
      const formattedTranscripts = transcript
        // Filter empty messages (Vogent sends these on pauses)
        .filter((t) => t.text && t.text.trim().length > 0)
        .map((t) => {
          // Vogent uses "HUMAN" and "AI" (uppercase)
          const speaker = String(t.speaker || "").toUpperCase();
          const role = speaker === "HUMAN" || speaker === "USER" ? "user" : "assistant";
          return { role, text: t.text };
        });

      setState((prev) => ({ ...prev, transcripts: formattedTranscripts }));
      options.onTranscriptUpdate?.(formattedTranscripts);
    },
    [options, setState]
  );

  const startCall = useCallback(async () => {
    // Prevent duplicate calls
    if (state.isConnecting || state.isConnected) return;
    setState((prev) => ({ ...prev, isConnecting: true, error: null }));

    try {
      // 1. Dynamically import SDK (reduces initial bundle)
      if (!VogentCall) {
        const vogentModule = await import("@vogent/vogent-web-client");
        VogentCall = vogentModule.VogentCall;
      }

      // 2. Get dial credentials from our API
      const response = await fetch("/api/omni-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "vogent" }),
      });
      if (!response.ok) throw new Error(await response.text());
      const { sessionId, dialId, dialToken } = await response.json();

      // 3. Create VogentCall instance
      const call = new VogentCall({
        sessionId,
        dialId,
        token: dialToken
      });
      callRef.current = call;

      // 4. Set up status listener
      call.on("status", (status: VogentStatus) => {
        const normalizedStatus = String(status).toLowerCase();
        const isConnected = normalizedStatus === "connected";
        setState((prev) => ({
          ...prev,
          status: normalizedStatus,
          isConnected,
          isConnecting: isConnected ? false : prev.isConnecting,
        }));
      });

      // 5. Set up transcript monitoring
      const unsubscribe = call.monitorTranscript(handleTranscriptUpdate);
      transcriptUnsubscribeRef.current = unsubscribe;

      // 6. Start the call and connect audio
      await call.start();
      await call.connectAudio();

      // 7. Update state to connected
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        isConnected: true,
        callId: dialId,
        status: "connected",
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        error: error.message
      }));
      options.onError?.(error);
    }
  }, [state.isConnecting, state.isConnected, options, handleTranscriptUpdate, setState]);

  const endCall = useCallback(async () => {
    if (!callRef.current) return;
    try {
      // Unsubscribe from transcripts
      transcriptUnsubscribeRef.current?.();
      transcriptUnsubscribeRef.current = null;
      // Hang up the call
      await callRef.current.hangup();
    } catch (error) {
      console.error("Error ending Vogent call:", error);
    } finally {
      callRef.current = null;
    }
  }, []);

  const toggleMute = useCallback(async () => {
    if (!callRef.current) return;
    const newPausedState = !state.isMuted;
    await callRef.current.setPaused(newPausedState);
    setState((prev) => ({ ...prev, isMuted: newPausedState }));
  }, [state.isMuted, setState]);

  return { startCall, endCall, toggleMute, cleanup };
}
```

### Vogent Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         VOGENT FLOW                              │
└─────────────────────────────────────────────────────────────────┘

1. USER CLICKS "Start Call"
         │
         ▼
2. Client: fetch("/api/omni-voice", { provider: "vogent" })
         │
         ▼
3. Server: createVogentDial({ callAgentId })
         │
         ▼
4. Vogent API: POST https://api.vogent.ai/api/dials
         │
         ▼
5. Returns: { sessionId, dialId, dialToken }
         │
         ▼
6. Client: new VogentCall({ sessionId, dialId, token })
         │
         ▼
7. Client: call.start() → WebRTC connection established
         │
         ▼
8. Client: call.connectAudio() → Microphone/speaker connected
         │
         ▼
9. CALL ACTIVE
   │
   ├── call.on("status") → Status updates (connected, ended, etc.)
   │
   └── call.monitorTranscript() → Real-time transcripts
         │
         ▼
10. User speaks → Vogent processes → AI responds
         │
         ▼
11. Transcripts arrive: { speaker: "HUMAN"/"AI", text: "..." }
         │
         ▼
12. Mapped to: { role: "user"/"assistant", text: "..." }
```

---

## Vapi Implementation

### Overview

Vapi allows **dynamic assistant configuration** at runtime. You define the AI model, voice, system prompt, and tools directly in API calls, giving full control over assistant behavior per session.

### Step 1: Server-Side API Setup

**File: `/lib/ai/omni-voice.ts`**

```typescript
// Type definitions
export interface VapiCallConfig {
  systemPrompt: string;      // The AI's behavior instructions
  model?: string;            // OpenAI model (gpt-4o, gpt-4, etc.)
  voice?: string;            // Voice name (Mark, Jessica, etc.)
  temperature?: number;      // Response randomness (0-1)
  messages?: ChatMessage[];  // Previous conversation for context
}

// Helper: Convert our message format to Vapi's format
function formatMessagesForVapi(
  messages: ChatMessage[]
): Array<{ role: "user" | "assistant" | "system"; content: string }> {
  return messages
    .map((msg) => {
      const textPart = msg.parts.find((p) => p.type === "text" && p.text);
      if (!textPart?.text) return null;

      const role = msg.role === "user" ? "user"
                 : msg.role === "system" ? "system"
                 : "assistant";

      return { role, content: textPart.text };
    })
    .filter((m) => m !== null);
}

// Helper: Map voice names to ElevenLabs voice IDs
function getVapiVoiceId(voiceName: string): string {
  const voiceMap: Record<string, string> = {
    Mark: "mark",
    Jessica: "jessica",
    Sarah: "sarah",
    John: "john",
  };
  return voiceMap[voiceName] || "mark";
}

// API function to create a Vapi call
export async function createVapiCall(config: VapiCallConfig): Promise<VapiCallResult> {
  // Build the assistant configuration
  const assistant = {
    // Model configuration
    model: {
      provider: "openai",
      model: config.model || "gpt-4o",
      temperature: config.temperature || 0.7,
      // Messages array includes system prompt + conversation history
      messages: [
        {
          role: "system" as const,
          content: config.systemPrompt,
        },
        ...(config.messages ? formatMessagesForVapi(config.messages) : []),
      ],
    },
    // Voice configuration (ElevenLabs)
    voice: {
      provider: "11labs",
      voiceId: getVapiVoiceId(config.voice || "Mark"),
    },
    // First message the AI speaks when call connects
    firstMessage: "Hello! How can I help you today?",
    // Optional: Server webhook for function calls
    ...(process.env.VAPI_SERVER_URL && {
      serverUrl: process.env.VAPI_SERVER_URL,
      serverUrlSecret: process.env.VAPI_SERVER_URL_SECRET,
    }),
  };

  // Make API request
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
```

**Key Points:**
- Full control over model, voice, and behavior at runtime
- System prompt is sent with each call
- Can include conversation history for context
- Uses ElevenLabs for high-quality voice synthesis

### Step 2: Client-Side Hook Implementation

**File: `/hooks/use-omni-chat.ts`**

```typescript
let Vapi: typeof import("@vapi-ai/web").default;

function useVapiProvider(options, state, setState) {
  const vapiRef = useRef<InstanceType<typeof Vapi> | null>(null);

  const startCall = useCallback(async () => {
    if (state.isConnecting || state.isConnected) return;
    setState((prev) => ({ ...prev, isConnecting: true, error: null }));

    try {
      // 1. Dynamically import Vapi SDK
      if (!Vapi) {
        const vapiModule = await import("@vapi-ai/web");
        Vapi = vapiModule.default;
      }

      // 2. Create Vapi instance with public key
      const vapi = new Vapi(process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY || "");
      vapiRef.current = vapi;

      // 3. Set up event listeners

      // Call lifecycle events
      vapi.on("call-start", () => {
        setState((prev) => ({
          ...prev,
          isConnecting: false,
          isConnected: true,
          status: "connected",
        }));
      });

      vapi.on("call-end", () => {
        setState((prev) => ({
          ...prev,
          isConnected: false,
          callId: null,
          status: "disconnected",
        }));
      });

      // Speech detection events (great for UI feedback)
      vapi.on("speech-start", () => {
        setState((prev) => ({ ...prev, status: "listening" }));
      });

      vapi.on("speech-end", () => {
        setState((prev) => ({ ...prev, status: "thinking" }));
      });

      // Message handler for transcripts and function calls
      vapi.on("message", (message: any) => {
        // Handle final transcripts
        if (message.type === "transcript" && message.transcriptType === "final") {
          const role = message.role === "user" ? "user" : "assistant";
          const text = message.transcript || message.content || "";

          if (!text.trim()) return; // Skip empty transcripts

          setState((prev) => {
            const newTranscripts = [...prev.transcripts, { role, text }];
            // Async callback to avoid setState during render
            setTimeout(() => options.onTranscriptUpdate?.(newTranscripts), 0);
            return { ...prev, transcripts: newTranscripts };
          });
        }

        // Handle function calls
        if (message.type === "function-call") {
          const toolCall = {
            toolName: message.functionCall?.name || "",
            parameters: message.functionCall?.parameters || {},
            invocationId: message.functionCall?.id || "",
          };
          setTimeout(() => options.onToolCall?.(toolCall), 0);
        }
      });

      // Error handling
      vapi.on("error", (error: any) => {
        const errorMessage = error?.message || error?.error?.message || "";
        // Ignore normal call termination errors
        if (errorMessage.toLowerCase().includes("meeting ended") ||
            errorMessage.toLowerCase().includes("ejection")) {
          return;
        }
        if (errorMessage) {
          setState((prev) => ({ ...prev, error: errorMessage }));
          options.onError?.(new Error(errorMessage));
        }
      });

      // 4. Start the call with assistant ID
      const assistantId = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID || "default-id";
      const call = await vapi.start(assistantId);

      if (call?.id) {
        setState((prev) => ({ ...prev, callId: call.id }));
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        error: error.message
      }));
    }
  }, [state.isConnecting, state.isConnected, options, setState]);

  const endCall = useCallback(() => {
    if (!vapiRef.current) return;
    try {
      vapiRef.current.stop();
    } catch (error) {
      // Ignore "meeting ended" errors
      if (!error.message?.toLowerCase().includes("meeting ended")) {
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

  return { startCall, endCall, toggleMute, cleanup };
}
```

### Vapi Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                          VAPI FLOW                               │
└─────────────────────────────────────────────────────────────────┘

1. USER CLICKS "Start Call"
         │
         ▼
2. Client: new Vapi(NEXT_PUBLIC_VAPI_PUBLIC_KEY)
         │
         ▼
3. Client: Set up event listeners (call-start, message, etc.)
         │
         ▼
4. Client: vapi.start(assistantId)
         │
         ▼
5. Vapi SDK: Connects to Vapi servers via WebRTC
         │
         ▼
6. Vapi servers: Connect to OpenAI + ElevenLabs
         │
         ▼
7. Event: "call-start" → Call connected
         │
         ▼
8. CALL ACTIVE
   │
   ├── User speaks → Event: "speech-start"
   │         │
   │         ▼
   │   User stops → Event: "speech-end"
   │         │
   │         ▼
   │   Vapi processes speech → OpenAI generates response
   │         │
   │         ▼
   │   Event: "message" { type: "transcript", role: "user", ... }
   │         │
   │         ▼
   │   ElevenLabs synthesizes speech → Audio plays
   │         │
   │         ▼
   │   Event: "message" { type: "transcript", role: "assistant", ... }
   │
   └── Function calls:
         Event: "message" { type: "function-call", functionCall: {...} }
```

### Vapi Event Timeline Example

```
Time    Event              Data
─────────────────────────────────────────────────────
0.0s    call-start         { id: "call-123" }
0.1s    speech-start       {}
1.5s    speech-end         {}
1.6s    message            { type: "transcript", role: "user",
                             transcript: "Hello" }
2.0s    message            { type: "transcript", role: "assistant",
                             transcript: "Hi there!" }
3.0s    speech-start       {}
...
```

---

## Ultravox Implementation

### Overview

Ultravox is built for **low-latency real-time voice** with its custom-optimized model. A unique feature is **client-side tool execution** - tools run in the browser, not on your server.

### Step 1: Server-Side API Setup

**File: `/lib/ai/omni-voice.ts`**

```typescript
// Type definitions
export interface UltravoxCallConfig {
  systemPrompt: string;
  model?: string;            // Default: "fixie-ai/ultravox-70B"
  voice?: string;            // Voice name
  temperature?: number;
  languageHint?: string;     // e.g., "en", "es", "fr"
  messages?: ChatMessage[];  // Previous conversation
}

// Tool definitions - these describe tools the AI can use
export const ULTRAVOX_WEB_SEARCH_TOOL = {
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
    client: {},  // Empty object indicates client-side execution
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

// Helper: Format messages for Ultravox
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
    .filter((m) => m !== null);
}

// API function to create an Ultravox call
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
      // Include tool definitions
      selectedTools: [ULTRAVOX_WEB_SEARCH_TOOL, ULTRAVOX_NYC_MAYOR_TOOL],
      // Include conversation history if provided
      ...(initialMessages && initialMessages.length > 0 && { initialMessages }),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create Ultravox call: ${error}`);
  }

  const data = await response.json();
  return {
    joinUrl: data.joinUrl,  // WebSocket URL to join
    callId: data.callId,
  };
}
```

**Key Points:**
- Tools are defined server-side but executed client-side
- `client: {}` in tool definition indicates client-side execution
- Supports initial messages for conversation context
- Uses Ultravox's own optimized model

### Step 2: Client-Side Hook with Tool Registration

**File: `/hooks/use-omni-chat.ts`**

```typescript
let UltravoxSession: typeof import("ultravox-client").UltravoxSession;
let UltravoxSessionStatus: typeof import("ultravox-client").UltravoxSessionStatus;

function useUltravoxProvider(options, state, setState) {
  const sessionRef = useRef<InstanceType<typeof UltravoxSession> | null>(null);

  // Transcript update handler
  const updateTranscripts = useCallback(() => {
    if (!sessionRef.current) return;

    // Ultravox maintains transcript array on the session object
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

  // Status message helper
  const getUltravoxStatusMessage = useCallback((status: any): string => {
    if (!UltravoxSessionStatus) return "Unknown";
    switch (status) {
      case UltravoxSessionStatus.DISCONNECTED:  return "Disconnected";
      case UltravoxSessionStatus.DISCONNECTING: return "Disconnecting...";
      case UltravoxSessionStatus.CONNECTING:    return "Connecting...";
      case UltravoxSessionStatus.IDLE:          return "Connected - Ready";
      case UltravoxSessionStatus.LISTENING:     return "Listening...";
      case UltravoxSessionStatus.THINKING:      return "Thinking...";
      case UltravoxSessionStatus.SPEAKING:      return "Speaking...";
      default:                                   return "Unknown";
    }
  }, []);

  const startCall = useCallback(async () => {
    if (state.isConnecting || state.isConnected) return;
    setState((prev) => ({ ...prev, isConnecting: true, error: null }));

    try {
      // 1. Dynamically import Ultravox SDK
      if (!UltravoxSession) {
        const ultravoxModule = await import("ultravox-client");
        UltravoxSession = ultravoxModule.UltravoxSession;
        UltravoxSessionStatus = ultravoxModule.UltravoxSessionStatus;
      }

      // 2. Get join URL from our API
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

      // 3. Create session
      const session = new UltravoxSession();
      sessionRef.current = session;

      // 4. Set up status listener
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

      // 5. Set up transcript listener
      session.addEventListener("transcripts", updateTranscripts);

      // 6. Set up tool call listener
      session.addEventListener("experimentalMessage", (event: any) => {
        const message = event.message;
        if (message?.type === "client_tool_invocation") {
          const toolCall = {
            toolName: message.toolName,
            parameters: message.parameters || {},
            invocationId: message.invocationId,
          };
          options.onToolCall?.(toolCall);
        }
      });

      // 7. REGISTER CLIENT-SIDE TOOL IMPLEMENTATIONS
      // This is the unique part - tools run in the browser!

      session.registerToolImplementation(
        "webSearch",
        async (parameters: Record<string, unknown>) => {
          const query = parameters.query as string;
          try {
            // Call our search API from the browser
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
        async () => "Eric Adams"  // Example static response
      );

      // 8. Join the call
      await session.joinCall(joinUrl);

      // 9. Update state
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        isConnected: true,
        callId,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        error: error.message
      }));
    }
  }, [state.isConnecting, state.isConnected, options, updateTranscripts, setState]);

  const endCall = useCallback(async () => {
    if (!sessionRef.current) return;
    try {
      sessionRef.current.leaveCall();
      // Notify server to clean up
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

  return { startCall, endCall, toggleMute, cleanup };
}
```

### Ultravox Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                       ULTRAVOX FLOW                              │
└─────────────────────────────────────────────────────────────────┘

1. USER CLICKS "Start Call"
         │
         ▼
2. Client: fetch("/api/omni-voice", { provider: "ultravox", ... })
         │
         ▼
3. Server: createUltravoxCall({ systemPrompt, tools, ... })
         │
         ▼
4. Ultravox API: POST https://api.ultravox.ai/api/calls
         │
         ▼
5. Returns: { joinUrl, callId }
         │
         ▼
6. Client: new UltravoxSession()
         │
         ▼
7. Client: session.registerToolImplementation("webSearch", fn)
         │
         ▼
8. Client: session.joinCall(joinUrl) → WebSocket connection
         │
         ▼
9. CALL ACTIVE
   │
   ├── Status changes:
   │   CONNECTING → IDLE → LISTENING → THINKING → SPEAKING → IDLE
   │
   ├── Transcripts updated via "transcripts" event
   │
   └── Tool calls:
         │
         ▼
       AI decides to use "webSearch"
         │
         ▼
       Event: "experimentalMessage" { type: "client_tool_invocation" }
         │
         ▼
       Browser executes: fetch("/api/search", { query })
         │
         ▼
       Result returned to Ultravox → AI continues response
```

### Ultravox Status State Machine

```
                    ┌──────────────┐
                    │ DISCONNECTED │
                    └──────┬───────┘
                           │ joinCall()
                           ▼
                    ┌──────────────┐
                    │  CONNECTING  │
                    └──────┬───────┘
                           │ connected
                           ▼
          ┌────────────────────────────────────┐
          │               IDLE                 │◀─────────────┐
          │        (Ready for input)           │              │
          └────────────────┬───────────────────┘              │
                           │ user speaks                      │
                           ▼                                  │
                    ┌──────────────┐                          │
                    │  LISTENING   │                          │
                    │ (User speak) │                          │
                    └──────┬───────┘                          │
                           │ user stops                       │
                           ▼                                  │
                    ┌──────────────┐                          │
                    │   THINKING   │                          │
                    │ (Processing) │                          │
                    └──────┬───────┘                          │
                           │ response ready                   │
                           ▼                                  │
                    ┌──────────────┐                          │
                    │   SPEAKING   │──────────────────────────┘
                    │ (AI speaks)  │     done speaking
                    └──────────────┘
```

---

## Unified Hook Architecture

The `useOmniChat` hook provides a unified interface to all three providers:

```typescript
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

  // Initialize all provider hooks
  const vogent = useVogentProvider(options, state, setState);
  const vapi = useVapiProvider(options, state, setState);
  const ultravox = useUltravoxProvider(options, state, setState);

  // Provider selector
  const getProvider = useCallback(() => {
    switch (options.provider) {
      case "vogent":    return vogent;
      case "vapi":      return vapi;
      case "ultravox":  return ultravox;
      default:          return vogent;
    }
  }, [options.provider, vogent, vapi, ultravox]);

  // Unified interface
  const startCall = useCallback(async () => {
    const provider = getProvider();
    await provider.startCall();
  }, [getProvider]);

  const endCall = useCallback(async () => {
    const provider = getProvider();
    await provider.endCall();
    // Reset state
    setState((prev) => ({
      ...prev,
      isConnected: false,
      isConnecting: false,
      status: "disconnected",
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

  return {
    ...state,
    startCall,
    endCall,
    toggleMute,
  };
}
```

### Usage in Components

```typescript
const {
  isConnected,
  isConnecting,
  status,
  transcripts,
  isMuted,
  error,
  startCall,
  endCall,
  toggleMute,
} = useOmniChat({
  provider: "vogent",  // or "vapi" or "ultravox"
  onTranscriptUpdate: (transcripts) => {
    // Handle new transcripts
  },
  onError: (error) => {
    toast.error(error.message);
  },
});
```

---

## UI Integration

**File: `/components/multimodal-input.tsx`**

```typescript
// State for provider selection
const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>("vogent");

// Use the unified hook
const {
  isConnected: isVoiceConnected,
  isConnecting: isVoiceConnecting,
  status: voiceStatus,
  isMuted,
  transcripts,
  startCall,
  endCall,
  toggleMute,
} = useOmniChat({
  provider: voiceProvider,
  messages,
  onTranscriptUpdate: async (newTranscripts) => {
    // Update message UI with transcripts
    // Save to database
  },
  onError: (error) => {
    toast.error(error.message);
  },
});

// Determine if voice controls should show
const isVoiceActive = isVoiceConnected || isVoiceConnecting ||
  (voiceStatus !== "disconnected" && voiceStatus !== "ended");

// Render voice controls
{isVoiceActive ? (
  <>
    <Button onClick={toggleMute}>
      {isMuted ? <MicOff /> : <Mic />}
    </Button>
    <Button onClick={endCall}>
      <PhoneOff />
    </Button>
    <span>{voiceStatus}</span>
  </>
) : (
  <DropdownMenu>
    <DropdownMenuTrigger>
      <Phone /> {PROVIDER_INFO[voiceProvider].name}
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      {["vogent", "vapi", "ultravox"].map((p) => (
        <DropdownMenuItem onClick={() => {
          setVoiceProvider(p);
          startCall();
        }}>
          {PROVIDER_INFO[p].name}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
)}
```

---

## Detailed Pros & Cons Analysis

### Vogent

#### Pros

| Category | Advantage | Details |
|----------|-----------|---------|
| **Simplicity** | Minimal code | Just need agent ID - no prompt/voice/model configuration in code |
| **Management** | Dashboard control | Non-technical team members can modify agent behavior |
| **Updates** | No redeployment | Change agent behavior instantly via dashboard |
| **Consistency** | Centralized config | Agent behavior is consistent across all sessions |
| **Security** | Hidden prompts | System prompts aren't exposed in client/API code |
| **Testing** | Easy A/B testing | Create multiple agents and switch IDs |

#### Cons

| Category | Disadvantage | Details |
|----------|--------------|---------|
| **Flexibility** | Static behavior | Can't customize per user/session at runtime |
| **Dependency** | External dashboard | Must use Vogent's UI for all configuration |
| **Portability** | Vendor lock-in | Agent configs stored on Vogent's servers |
| **Debugging** | Limited visibility | Harder to debug prompt issues |
| **Context** | No conversation history | Can't pass previous messages to agent |
| **Format** | Unusual transcript format | Uses HUMAN/AI (uppercase) requiring mapping |

#### Best For
- Production apps with stable requirements
- Teams with non-technical stakeholders
- Rapid prototyping
- Applications requiring quick iteration without deployments

---

### Vapi

#### Pros

| Category | Advantage | Details |
|----------|-----------|---------|
| **Flexibility** | Runtime config | Full control over prompt/model/voice per session |
| **Voice Quality** | ElevenLabs | High-quality, natural-sounding voices |
| **Models** | OpenAI access | Use GPT-4, GPT-4o, or other OpenAI models |
| **Events** | Rich feedback | speech-start, speech-end events for UI |
| **Functions** | Tool support | Native OpenAI-style function calling |
| **Context** | History support | Pass previous messages for context |
| **Multi-tenant** | Per-user config | Different behavior for different users |

#### Cons

| Category | Disadvantage | Details |
|----------|--------------|---------|
| **Complexity** | More setup | Requires building assistant config in code |
| **Latency** | Multiple hops | Vapi → OpenAI → ElevenLabs adds latency |
| **Cost** | Multiple services | Pay for Vapi + OpenAI + ElevenLabs |
| **Keys** | Multiple API keys | Need server key + client key + optional webhook |
| **Errors** | Noisy termination | "Meeting ended" errors on normal call end |
| **Setup** | Webhook optional | Full features need server webhook setup |

#### Best For
- Multi-tenant applications
- Apps needing different prompts per user
- Integration with existing OpenAI/ElevenLabs usage
- Applications needing detailed speech events

---

### Ultravox

#### Pros

| Category | Advantage | Details |
|----------|-----------|---------|
| **Latency** | Optimized | Single service, purpose-built for real-time |
| **Status** | Detailed states | LISTENING, THINKING, SPEAKING for rich UI |
| **Tools** | Client-side | Tools run in browser, reducing server load |
| **Auth** | Single key | Only one API key needed |
| **Language** | Multi-language | Built-in language hint support |
| **Context** | Initial messages | Pass conversation history |
| **Model** | Optimized | Model specifically designed for voice |

#### Cons

| Category | Disadvantage | Details |
|----------|--------------|---------|
| **Model** | No choice | Can only use Ultravox's model |
| **Tools** | Client exposure | Tool logic runs in browser (security concern) |
| **Maturity** | Newer platform | Smaller ecosystem, less documentation |
| **Voices** | Limited options | Fewer voice choices than ElevenLabs |
| **Debugging** | Tool complexity | Client-side tools harder to debug |
| **API** | Experimental features | Some features marked "experimental" |

#### Best For
- Latency-critical applications
- Rich UI with status indicators
- Browser-based tool execution
- Applications where Ultravox's model quality suffices

---

## Quick Reference

### Environment Variables

| Variable | Provider | Type | Description |
|----------|----------|------|-------------|
| `VOGENT_PUBLIC_API_KEY` | Vogent | Server | API key |
| `VOGENT_CALL_AGENT_ID` | Vogent | Server | Agent ID |
| `VAPI_API_KEY` | Vapi | Server | Server API key |
| `NEXT_PUBLIC_VAPI_PUBLIC_KEY` | Vapi | Client | Client API key |
| `NEXT_PUBLIC_VAPI_ASSISTANT_ID` | Vapi | Client | Optional assistant ID |
| `ULTRAVOX_API_KEY` | Ultravox | Server | API key |

### SDK Packages

```bash
pnpm add @vogent/vogent-web-client @vapi-ai/web ultravox-client
```

### Transcript Formats

| Provider | User Speaker | AI Speaker | Format |
|----------|-------------|------------|--------|
| Vogent | `"HUMAN"` | `"AI"` | Uppercase |
| Vapi | `"user"` | `"assistant"` | Lowercase |
| Ultravox | `"user"` | `"agent"` | Lowercase |
