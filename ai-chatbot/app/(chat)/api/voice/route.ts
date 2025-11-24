import { auth } from "@/app/(auth)/auth";
import { createUltravoxCall, DEFAULT_SYSTEM_PROMPT } from "@/lib/ai/voice";

export async function POST(request: Request) {
  const session = await auth();

  if (!session || !session.user || !session.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await request.json();
    const { systemPrompt, voice, model, temperature } = body;

    const callData = await createUltravoxCall({
      systemPrompt: systemPrompt || DEFAULT_SYSTEM_PROMPT,
      voice: voice || "Mark",
      model: model || "fixie-ai/ultravox-70B",
      temperature: temperature || 0.7,
    });

    return Response.json({
      joinUrl: callData.joinUrl,
      callId: callData.callId,
    });
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
    const callId = searchParams.get("callId");

    if (!callId) {
      return new Response("Call ID required", { status: 400 });
    }

    const response = await fetch(`https://api.ultravox.ai/api/calls/${callId}`, {
      method: "DELETE",
      headers: {
        "X-API-Key": process.env.ULTRAVOX_API_KEY || "",
      },
    });

    // Accept success, not found (already ended), gone (expired), or too early as valid responses
    if (!response.ok && ![404, 410, 425].includes(response.status)) {
      console.error(`Failed to end call ${callId}: ${response.status}`);
      throw new Error("Failed to end call");
    }

    return new Response("Call ended", { status: 200 });
  } catch (error) {
    console.error("Failed to end voice call:", error);
    return new Response("Failed to end call", { status: 500 });
  }
}
