# Voice Provider Implementation Guide

This document provides a comprehensive overview of the three voice AI providers implemented in this project: **Vogent**, **Vapi**, and **Ultravox**. Each provider has distinct architectures, use cases, and trade-offs.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Vogent](#vogent)
3. [Vapi](#vapi)
4. [Ultravox](#ultravox)
5. [Comparison Matrix](#comparison-matrix)
6. [Choosing the Right Provider](#choosing-the-right-provider)

---

## Architecture Overview

All three providers follow a similar high-level pattern:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Browser/UI    │────▶│   Next.js API   │────▶│  Provider API   │
│  (Client SDK)   │◀────│   /api/omni-    │◀────│  (Vogent/Vapi/  │
│                 │     │     voice       │     │   Ultravox)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                               │
        │              WebRTC / WebSocket               │
        └───────────────────────────────────────────────┘
```

### Shared Components

- **`/lib/ai/omni-voice.ts`** - Server-side API functions for each provider
- **`/hooks/use-omni-chat.ts`** - Unified React hook with provider-specific implementations
- **`/app/(chat)/api/omni-voice/route.ts`** - API route handler for all providers

---

## Vogent

### Overview

Vogent is an AI voice platform that uses a **pre-configured agent** model. Agents are configured via the Vogent dashboard, and your application simply initiates calls using an agent ID.

### Architecture

```
┌──────────────┐    POST /api/dials     ┌──────────────┐
│   Browser    │ ───────────────────▶   │  Vogent API  │
│              │ ◀─────────────────────  │              │
│              │  {sessionId, dialId,   │              │
│              │   dialToken}           │              │
└──────┬───────┘                        └──────────────┘
       │
       │  VogentCall SDK
       │  (WebRTC connection)
       │
       ▼
┌──────────────┐
│ Vogent Agent │  ◀── Configured in Vogent Dashboard
│  (Voice AI)  │      - System prompt
└──────────────┘      - Voice settings
                      - Tools/Functions
                      - Model selection
```

### Implementation Details

**Server-side (`/lib/ai/omni-voice.ts`):**
```typescript
const response = await fetch("https://api.vogent.ai/api/dials", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.VOGENT_PUBLIC_API_KEY}`,
  },
  body: JSON.stringify({
    callAgentId: config.callAgentId,
    browserCall: true,
  }),
});
```

**Client-side (`/hooks/use-omni-chat.ts`):**
```typescript
const call = new VogentCall({ sessionId, dialId, token: dialToken });
call.on("status", (status) => { /* handle status changes */ });
call.monitorTranscript((transcripts) => { /* handle transcripts */ });
await call.start();
await call.connectAudio();
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `VOGENT_PUBLIC_API_KEY` | API key from Vogent dashboard |
| `VOGENT_CALL_AGENT_ID` | Pre-configured agent ID |

### Transcript Format

```typescript
{
  speaker: "HUMAN" | "AI",  // Uppercase
  text: string
}
```

### Status States

| Status | Description |
|--------|-------------|
| `connecting` | Establishing connection |
| `connected` | Call is active |
| `ended` | Call has ended |
| `error` | An error occurred |

### Pros

| Advantage | Description |
|-----------|-------------|
| **Dashboard Configuration** | Agent behavior, voice, and tools are configured via UI - no code changes needed |
| **Simple Integration** | Minimal code required - just need agent ID |
| **Centralized Management** | Update agent behavior without redeploying |
| **Rapid Prototyping** | Create and test agents quickly via dashboard |
| **Team Collaboration** | Non-technical team members can modify agent behavior |

### Cons

| Disadvantage | Description |
|--------------|-------------|
| **Less Code Control** | Can't dynamically adjust prompts/settings per session |
| **Dashboard Dependency** | Must use external dashboard for configuration |
| **Limited Runtime Flexibility** | Agent behavior is fixed at call start |
| **Vendor Lock-in** | Agent configurations are stored on Vogent's platform |

### Best Use Cases

- Production deployments with stable agent configurations
- Teams with non-technical members managing agent behavior
- Rapid prototyping and iteration
- Applications requiring minimal code complexity

---

## Vapi

### Overview

Vapi is a conversational AI platform that allows **dynamic assistant configuration** at runtime. You define the assistant's model, voice, system prompt, and tools directly in your API calls.

### Architecture

```
┌──────────────┐   POST /call/web      ┌──────────────┐
│   Browser    │ ───────────────────▶  │   Vapi API   │
│              │   {assistant: {       │              │
│              │     model, voice,     │              │
│              │     systemPrompt,     │              │
│              │     tools...}}        │              │
│              │ ◀─────────────────────│              │
│              │   {webCallUrl, id}    │              │
└──────┬───────┘                       └──────────────┘
       │                                      │
       │  Vapi Web SDK                        │
       │  (WebRTC)                            │
       ▼                                      ▼
┌──────────────┐                      ┌──────────────┐
│   Browser    │◀────────────────────▶│  OpenAI +    │
│   Audio      │    Real-time audio   │  ElevenLabs  │
└──────────────┘                      └──────────────┘
```

### Implementation Details

**Server-side (`/lib/ai/omni-voice.ts`):**
```typescript
const assistant = {
  model: {
    provider: "openai",
    model: config.model || "gpt-4o",
    temperature: config.temperature || 0.7,
    messages: [
      { role: "system", content: config.systemPrompt },
      ...formatMessagesForVapi(config.messages),
    ],
  },
  voice: {
    provider: "11labs",
    voiceId: getVapiVoiceId(config.voice),
  },
  firstMessage: "Hello! How can I help you today?",
};

const response = await fetch("https://api.vapi.ai/call/web", {
  headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
  body: JSON.stringify({ assistant }),
});
```

**Client-side (`/hooks/use-omni-chat.ts`):**
```typescript
const vapi = new Vapi(process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY);

vapi.on("call-start", () => { /* connected */ });
vapi.on("call-end", () => { /* disconnected */ });
vapi.on("speech-start", () => { /* user speaking */ });
vapi.on("speech-end", () => { /* user stopped */ });
vapi.on("message", (msg) => { /* transcripts & function calls */ });
vapi.on("error", (err) => { /* handle errors */ });

await vapi.start(assistantId);
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `VAPI_API_KEY` | Server-side API key |
| `NEXT_PUBLIC_VAPI_PUBLIC_KEY` | Client-side public key |
| `NEXT_PUBLIC_VAPI_ASSISTANT_ID` | Optional pre-configured assistant |
| `VAPI_SERVER_URL` | Optional webhook URL for server events |
| `VAPI_SERVER_URL_SECRET` | Secret for webhook verification |

### Event Types

| Event | Description |
|-------|-------------|
| `call-start` | Call successfully connected |
| `call-end` | Call has ended |
| `speech-start` | User started speaking |
| `speech-end` | User stopped speaking |
| `message` | Transcript or function call received |
| `error` | An error occurred |

### Message Types

```typescript
// Transcript message
{
  type: "transcript",
  transcriptType: "final" | "partial",
  role: "user" | "assistant",
  transcript: string
}

// Function call message
{
  type: "function-call",
  functionCall: {
    name: string,
    parameters: object,
    id: string
  }
}
```

### Pros

| Advantage | Description |
|-----------|-------------|
| **Runtime Configuration** | Dynamically configure assistant per session |
| **ElevenLabs Integration** | High-quality voice synthesis built-in |
| **Rich Event System** | Detailed events for UI feedback (speech-start, speech-end) |
| **Function Calling** | Native support for OpenAI-style function calls |
| **Conversation History** | Pass previous messages for context |
| **Model Flexibility** | Choose OpenAI models dynamically |

### Cons

| Disadvantage | Description |
|--------------|-------------|
| **More Complex Setup** | Requires more configuration in code |
| **Multiple API Keys** | Needs both server and client keys |
| **Higher Latency** | Multiple services (Vapi → OpenAI → ElevenLabs) |
| **Cost** | Multiple service costs (Vapi + OpenAI + ElevenLabs) |
| **Error Handling** | "Meeting ended" errors on normal call termination |

### Best Use Cases

- Applications requiring dynamic prompt customization
- Multi-tenant apps with different assistant behaviors
- Integration with existing OpenAI/ElevenLabs infrastructure
- Applications needing detailed speech events for UI

---

## Ultravox

### Overview

Ultravox is a **real-time voice AI** platform with its own optimized model (`fixie-ai/ultravox-70B`). It features **client-side tool execution**, meaning tools run in the browser rather than on the server.

### Architecture

```
┌──────────────┐   POST /api/calls     ┌──────────────┐
│   Browser    │ ───────────────────▶  │ Ultravox API │
│              │   {systemPrompt,      │              │
│              │    model, voice,      │              │
│              │    tools...}          │              │
│              │ ◀─────────────────────│              │
│              │   {joinUrl, callId}   │              │
└──────┬───────┘                       └──────────────┘
       │
       │  UltravoxSession SDK
       │  (WebSocket)
       │
       ▼
┌──────────────────────────────────────────────────────┐
│                    Browser                            │
│  ┌─────────────┐    ┌─────────────────────────────┐  │
│  │   Audio     │    │   Tool Implementations       │  │
│  │  I/O        │    │   - webSearch()             │  │
│  │             │    │   - customTool()            │  │
│  └─────────────┘    └─────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### Implementation Details

**Server-side (`/lib/ai/omni-voice.ts`):**
```typescript
const response = await fetch("https://api.ultravox.ai/api/calls", {
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": process.env.ULTRAVOX_API_KEY,
  },
  body: JSON.stringify({
    systemPrompt: config.systemPrompt,
    model: config.model || "fixie-ai/ultravox-70B",
    voice: config.voice || "Mark",
    temperature: config.temperature || 0.7,
    languageHint: config.languageHint || "en",
    selectedTools: [ULTRAVOX_WEB_SEARCH_TOOL, ULTRAVOX_NYC_MAYOR_TOOL],
    initialMessages: formatMessagesForUltravox(config.messages),
  }),
});
```

**Client-side tool registration (`/hooks/use-omni-chat.ts`):**
```typescript
const session = new UltravoxSession();

// Register tool implementations that run in the browser
session.registerToolImplementation("webSearch", async (params) => {
  const response = await fetch("/api/search", {
    method: "POST",
    body: JSON.stringify({ query: params.query }),
  });
  const { summary } = await response.json();
  return summary;
});

session.addEventListener("status", () => { /* handle status */ });
session.addEventListener("transcripts", () => { /* handle transcripts */ });

await session.joinCall(joinUrl);
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ULTRAVOX_API_KEY` | API key from Ultravox dashboard |

### Status States

| Status | Description |
|--------|-------------|
| `DISCONNECTED` | Not connected |
| `DISCONNECTING` | Ending connection |
| `CONNECTING` | Establishing connection |
| `IDLE` | Connected, waiting for speech |
| `LISTENING` | User is speaking |
| `THINKING` | Processing user input |
| `SPEAKING` | AI is responding |

### Tool Definition Format

```typescript
const tool = {
  temporaryTool: {
    modelToolName: "webSearch",
    description: "Search the web for information",
    dynamicParameters: [
      {
        name: "query",
        location: "PARAMETER_LOCATION_BODY",
        schema: {
          type: "string",
          description: "The search query",
        },
        required: true,
      },
    ],
    client: {},  // Indicates client-side execution
  },
};
```

### Pros

| Advantage | Description |
|-----------|-------------|
| **Optimized Model** | Custom model designed for real-time voice |
| **Low Latency** | Single service, optimized for speed |
| **Rich Status States** | Detailed states (LISTENING, THINKING, SPEAKING) |
| **Client-Side Tools** | Tools execute in browser, reducing server load |
| **Language Hints** | Built-in multi-language support |
| **Initial Messages** | Pass conversation history for context |
| **Single API Key** | Simpler authentication setup |

### Cons

| Disadvantage | Description |
|--------------|-------------|
| **Fixed Model** | Limited to Ultravox's model (no GPT-4, Claude, etc.) |
| **Client-Side Tool Complexity** | Tools must be implemented in browser code |
| **Newer Platform** | Less mature ecosystem compared to others |
| **Limited Voice Options** | Fewer voice choices than ElevenLabs |
| **Tool Security** | Client-side tools may expose sensitive logic |

### Best Use Cases

- Applications requiring minimal latency
- Real-time voice interactions with detailed status feedback
- Browser-based tool execution (search, calculations)
- Applications where Ultravox's model quality is sufficient

---

## Comparison Matrix

| Feature | Vogent | Vapi | Ultravox |
|---------|--------|------|----------|
| **Configuration** | Dashboard | Code | Code |
| **Model Selection** | Dashboard | OpenAI models | Ultravox model only |
| **Voice Provider** | Dashboard | ElevenLabs | Built-in |
| **Tool Execution** | Server-side | Server-side | Client-side |
| **Status Granularity** | Basic (4 states) | Medium (events) | Rich (7 states) |
| **Latency** | Medium | Higher | Lower |
| **Setup Complexity** | Low | High | Medium |
| **Runtime Flexibility** | Low | High | Medium |
| **API Keys Required** | 1 | 2-3 | 1 |
| **Transcript Format** | HUMAN/AI | user/assistant | user/assistant |

### Pricing Considerations

| Provider | Pricing Model |
|----------|---------------|
| **Vogent** | Per-minute voice usage |
| **Vapi** | Per-minute + OpenAI costs + ElevenLabs costs |
| **Ultravox** | Per-minute voice usage |

*Note: Actual pricing varies. Check each provider's pricing page for current rates.*

---

## Choosing the Right Provider

### Choose Vogent if:

- You want a simple, dashboard-driven configuration
- Non-technical team members need to modify agent behavior
- You prefer centralized agent management
- You're building a production app with stable requirements
- You want minimal code complexity

### Choose Vapi if:

- You need dynamic, per-session configuration
- You want to use specific OpenAI models (GPT-4, GPT-4o)
- You require high-quality ElevenLabs voices
- You need detailed speech events for UI feedback
- You're building a multi-tenant application

### Choose Ultravox if:

- Latency is your primary concern
- You want detailed status states (LISTENING, THINKING, SPEAKING)
- You prefer client-side tool execution
- You're comfortable with Ultravox's model quality
- You want a simpler single-API-key setup

---

## Implementation Files

| File | Description |
|------|-------------|
| `/lib/ai/omni-voice.ts` | Server-side provider functions |
| `/hooks/use-omni-chat.ts` | Unified React hook |
| `/app/(chat)/api/omni-voice/route.ts` | API route handler |
| `/components/multimodal-input.tsx` | UI integration |

---

## Adding a New Provider

To add a new voice provider:

1. **Add types and API functions** in `/lib/ai/omni-voice.ts`
2. **Create provider hook** in `/hooks/use-omni-chat.ts` (follow existing patterns)
3. **Add case to switch statements** in API route and hook
4. **Update `VoiceProvider` type** and `PROVIDER_INFO`
5. **Install provider SDK** via npm/pnpm
6. **Add environment variables** to `.env.example` and Vercel

---

## Troubleshooting

### Common Issues

| Issue | Provider | Solution |
|-------|----------|----------|
| "Agent not found" | Vogent | Verify `VOGENT_CALL_AGENT_ID` is correct |
| "Meeting ended" errors | Vapi | These are normal on call end; suppressed in code |
| Transcripts showing wrong role | Vogent | Check speaker mapping (HUMAN/AI uppercase) |
| Call button disappears | All | Check `isVoiceActive` logic in UI |
| Tools not executing | Ultravox | Ensure `registerToolImplementation` is called |

### Debug Logging

All providers include console logging for debugging:

```typescript
console.log("[Vogent] Status changed:", status);
console.log("[Vogent] Transcript:", { speaker, mappedRole, text });
```

Check browser console for detailed debugging information.
