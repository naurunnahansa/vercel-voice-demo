import { auth } from "@/app/(auth)/auth";
import {
  type VoiceProvider,
  createVogentDial,
  createVapiCall,
  createUltravoxCall,
  endVapiCall,
  endUltravoxCall,
  DEFAULT_SYSTEM_PROMPT,
} from "@/lib/ai/omni-voice";

export async function POST(request: Request) {
  const session = await auth();

  if (!session || !session.user || !session.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      provider,
      systemPrompt,
      voice,
      model,
      temperature,
      messages,
    } = body as {
      provider: VoiceProvider;
      systemPrompt?: string;
      voice?: string;
      model?: string;
      temperature?: number;
      messages?: any[];
    };

    switch (provider) {
      case "vogent": {
        const callAgentId = process.env.VOGENT_CALL_AGENT_ID;
        if (!callAgentId) {
          throw new Error("VOGENT_CALL_AGENT_ID is not configured");
        }

        const dialData = await createVogentDial({
          callAgentId,
          messages,
        });

        return Response.json({
          sessionId: dialData.sessionId,
          dialId: dialData.dialId,
          dialToken: dialData.dialToken,
        });
      }

      case "vapi": {
        const callData = await createVapiCall({
          systemPrompt: systemPrompt || DEFAULT_SYSTEM_PROMPT,
          voice: voice || "Mark",
          model: model || "gpt-4o",
          temperature: temperature || 0.7,
          messages,
        });

        return Response.json({
          joinUrl: callData.joinUrl,
          callId: callData.callId,
        });
      }

      case "ultravox": {
        const callData = await createUltravoxCall({
          systemPrompt: systemPrompt || DEFAULT_SYSTEM_PROMPT,
          voice: voice || "Mark",
          model: model || "fixie-ai/ultravox-70B",
          temperature: temperature || 0.7,
          messages,
        });

        return Response.json({
          joinUrl: callData.joinUrl,
          callId: callData.callId,
        });
      }

      default:
        return new Response(`Unknown provider: ${provider}`, { status: 400 });
    }
  } catch (error) {
    console.error("Failed to create voice call:", error);
    return new Response(
      error instanceof Error ? error.message : "Failed to create voice call",
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const session = await auth();

  if (!session || !session.user || !session.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") as VoiceProvider | null;
    const callId = searchParams.get("callId");
    const dialId = searchParams.get("dialId");

    if (!provider) {
      return new Response("Provider required", { status: 400 });
    }

    switch (provider) {
      case "vogent": {
        if (!dialId) {
          return new Response("Dial ID required", { status: 400 });
        }
        // Vogent calls typically end when client calls hangup()
        // This endpoint is here for cleanup but may not be necessary
        return new Response("Call ended", { status: 200 });
      }

      case "vapi": {
        if (!callId) {
          return new Response("Call ID required", { status: 400 });
        }
        await endVapiCall(callId);
        return new Response("Call ended", { status: 200 });
      }

      case "ultravox": {
        if (!callId) {
          return new Response("Call ID required", { status: 400 });
        }
        await endUltravoxCall(callId);
        return new Response("Call ended", { status: 200 });
      }

      default:
        return new Response(`Unknown provider: ${provider}`, { status: 400 });
    }
  } catch (error) {
    console.error("Failed to end voice call:", error);
    return new Response("Failed to end call", { status: 500 });
  }
}
