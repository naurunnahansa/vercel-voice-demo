import { auth } from "@/app/(auth)/auth";
import { createVogentDial } from "@/lib/ai/voice";

export async function POST(request: Request) {
  const session = await auth();

  if (!session || !session.user || !session.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await request.json();
    const { messages } = body;

    const callAgentId = process.env.VOGENT_CALL_AGENT_ID || "01e3b006-5366-4ef4-b41e-8837b920dd4c";

    const dialData = await createVogentDial({
      callAgentId,
      messages,
    });

    return Response.json({
      sessionId: dialData.sessionId,
      dialId: dialData.dialId,
      dialToken: dialData.dialToken,
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
    const dialId = searchParams.get("dialId");

    if (!dialId) {
      return new Response("Dial ID required", { status: 400 });
    }

    // Vogent calls typically end when client calls hangup()
    // This endpoint is here for cleanup but may not be necessary
    // as the client SDK handles the hangup

    return new Response("Call ended", { status: 200 });
  } catch (error) {
    console.error("Failed to end voice call:", error);
    return new Response("Failed to end call", { status: 500 });
  }
}
