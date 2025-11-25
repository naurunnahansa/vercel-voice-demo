import { auth } from "@/app/(auth)/auth";
import { db, getChatById, saveChat } from "@/lib/db/queries";
import { message } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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

    // Check if chat exists, create it if not
    const existingChat = await getChatById({ id: chatId });
    if (!existingChat) {
      // Create the chat with a default title from the first message
      const firstMessage = messages[0];
      const title = firstMessage?.text?.slice(0, 100) || "Voice conversation";

      await saveChat({
        id: chatId,
        userId: session.user.id,
        title,
        visibility,
      });
    }

    // Use upsert pattern: delete existing messages and insert new ones
    const messageIds = messages.map((msg: { id: string }) => msg.id);

    if (messageIds.length > 0) {
      // Delete existing messages with these IDs
      await Promise.all(
        messageIds.map((msgId) =>
          db.delete(message).where(eq(message.id, msgId))
        )
      );

      // Insert all messages
      const dbMessages = messages.map((msg: {
        id: string;
        role: string;
        text: string;
        createdAt: string;
      }) => ({
        id: msg.id,
        chatId,
        role: msg.role,
        parts: [{ type: "text", text: msg.text }],
        attachments: [],
        createdAt: new Date(msg.createdAt),
      }));

      await db.insert(message).values(dbMessages);
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
