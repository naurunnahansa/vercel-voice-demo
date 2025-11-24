import { auth } from "@/app/(auth)/auth";

export async function POST(request: Request) {
  const session = await auth();

  if (!session || !session.user || !session.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const { query } = await request.json();

    if (!query) {
      return new Response("Query required", { status: 400 });
    }

    // Use DuckDuckGo instant answer API (no API key needed)
    const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;

    const response = await fetch(searchUrl);

    if (!response.ok) {
      throw new Error("Search failed");
    }

    const data = await response.json();

    // Extract relevant information from DuckDuckGo response
    const results = {
      abstract: data.Abstract || "",
      abstractSource: data.AbstractSource || "",
      abstractURL: data.AbstractURL || "",
      answer: data.Answer || "",
      definition: data.Definition || "",
      relatedTopics: (data.RelatedTopics || []).slice(0, 5).map((topic: any) => ({
        text: topic.Text || "",
        url: topic.FirstURL || "",
      })).filter((t: any) => t.text),
    };

    // Format as a readable summary
    let summary = "";

    if (results.answer) {
      summary = results.answer;
    } else if (results.abstract) {
      summary = `${results.abstract} (Source: ${results.abstractSource})`;
    } else if (results.definition) {
      summary = results.definition;
    } else if (results.relatedTopics.length > 0) {
      summary = "Related information: " + results.relatedTopics.map((t: any) => t.text).join(". ");
    } else {
      summary = "No specific results found. Try rephrasing the search query.";
    }

    return Response.json({ summary, results });
  } catch (error) {
    console.error("Search error:", error);
    return new Response("Search failed", { status: 500 });
  }
}
