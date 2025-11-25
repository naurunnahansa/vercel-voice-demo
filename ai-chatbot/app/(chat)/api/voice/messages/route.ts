import { auth } from "@/app/(auth)/auth";
import { db, getChatById } from "@/lib/db/queries";
import { message, chat } from "@/lib/db/schema";

export async function POST(request: Request) {
  const session = await auth();

  if (!session || !session.user || !session.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await request.json();
    const { chatId, messages, visibility = "private" } = body;

    if (!chatId || !messages || !Array.isArray(messages)) {
      return new Response("Invalid request body", { status: 400 });
    }

    // Check if chat exists, create it if not (with conflict handling)
    const existingChat = await getChatById({ id: chatId });
    if (!existingChat) {
      // Create the chat with a default title from the first message
      const firstMessage = messages[0];
      const title = firstMessage?.text?.slice(0, 100) || "Voice conversation";

      try {
        // Use onConflictDoNothing to handle race conditions
        await db.insert(chat).values({
          id: chatId,
          createdAt: new Date(),
          userId: session.user.id,
          title,
          visibility,
        }).onConflictDoNothing();
      } catch (e) {
        // Ignore duplicate key errors - another request created the chat
        console.log("Chat may already exist, continuing...");
      }
    }

    if (messages.length > 0) {
      // Process each message individually with upsert logic
      for (const msg of messages) {
        const dbMessage = {
          id: msg.id,
          chatId,
          role: msg.role,
          parts: [{ type: "text", text: msg.text }],
          attachments: [],
          createdAt: new Date(msg.createdAt),
        };

        // Try to insert, on conflict update the message
        await db.insert(message).values(dbMessage).onConflictDoUpdate({
          target: message.id,
          set: {
            role: dbMessage.role,
            parts: dbMessage.parts,
          },
        });
      }
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error("Failed to save voice messages:", error);
    return new Response(
      error instanceof Error ? error.message : "Failed to save messages",
      { status: 500 }
    );
  }
}
