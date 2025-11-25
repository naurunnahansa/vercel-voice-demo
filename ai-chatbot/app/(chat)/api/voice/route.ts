import { auth } from "@/app/(auth)/auth";
import { createVapiCall, endVapiCall, DEFAULT_SYSTEM_PROMPT } from "@/lib/ai/voice";

export async function POST(request: Request) {
  const session = await auth();

  if (!session || !session.user || !session.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await request.json();
    const { systemPrompt, voice, model, temperature, messages } = body;

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

    await endVapiCall(callId);

    return new Response("Call ended", { status: 200 });
  } catch (error) {
    console.error("Failed to end voice call:", error);
    return new Response("Failed to end call", { status: 500 });
  }
}
