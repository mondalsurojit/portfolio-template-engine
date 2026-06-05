// Gemini chatbot proxy. The system prompt is BUILT DYNAMICALLY from the user's
// data.json in the private storage repo, so every deployed portfolio's bot
// answers as its own owner — no hardcoded identity.

const SYSTEM_PROMPT_TTL_MS = 5 * 60 * 1000; // re-fetch data.json every 5 minutes

let cached = null; // { prompt, fetchedAt }

async function fetchData() {
  const { GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN } = process.env;
  if (!GITHUB_OWNER || !GITHUB_REPO || !GITHUB_TOKEN) {
    throw new Error("Missing GITHUB_OWNER / GITHUB_REPO / GITHUB_TOKEN env vars");
  }

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/public/data/data.json`,
    {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3.raw",
      },
    }
  );
  if (!res.ok) throw new Error(`Failed to fetch data.json (${res.status})`);
  return res.json();
}

// Trim the JSON to fields that describe the owner; drop bulky/irrelevant ones
// (media URLs, resume metadata, template/SEO settings, etc.) so the prompt stays focused.
function buildOwnerProfile(data) {
  const user = data?.user || {};
  const settings = data?.settings || {};
  const socials = data?.socials || {};

  return {
    profile: {
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      headline: user.headline || "",
      subheading: user.subheading || "",
      email: user.email || "",
      aboutMe: settings.aboutMe || "",
    },
    socials: Object.fromEntries(Object.entries(socials).filter(([, v]) => v)),
    skills: data?.skills || [],
    workExperience: data?.workExperience || [],
    education: data?.education || [],
    publications: data?.publications || [],
    projects: data?.projects || [],
    blogs: (data?.blogs || []).map((b) => ({
      title: b.title,
      description: b.description,
      category: b.category,
      tags: b.tags,
      dateUploaded: b.dateUploaded,
    })),
  };
}

async function buildSystemPrompt() {
  const now = Date.now();
  if (cached && now - cached.fetchedAt < SYSTEM_PROMPT_TTL_MS) return cached.prompt;

  const data = await fetchData();
  const owner = buildOwnerProfile(data);

  const settings = data?.settings || {};
  const fullName =
    `${owner.profile.firstName} ${owner.profile.lastName}`.trim() || "the owner";
  const botName = settings.botName || "Bot";
  const email = owner.profile.email;

  const prompt = `You are ${botName}, a smart and friendly AI assistant on ${fullName}'s personal portfolio website. Your job is to help visitors learn about ${fullName} — their skills, experience, projects, achievements, and background.

PORTFOLIO DATA (this is your sole source of truth; treat it as everything you know about ${fullName}):
\`\`\`json
${JSON.stringify(owner, null, 2)}
\`\`\`

BEHAVIOR:
- Be friendly, concise, and professional. Respond like a smart assistant representing ${fullName}.
- Only answer questions about ${fullName} — their skills, experience, projects, achievements, background, or blog posts above.
- If asked something completely unrelated (general knowledge, coding help, opinions on third parties, etc.), politely decline and redirect the visitor to ask about ${fullName}.
- Never fabricate information. If something isn't covered above, say you don't have that detail and suggest contacting ${fullName} directly${email ? ` at ${email}` : ""}.
- Speak positively and confidently about ${fullName}'s work and accomplishments.
- Keep replies under 4 short paragraphs unless the visitor explicitly asks for more detail.`;

  cached = { prompt, fetchedAt: now };
  return prompt;
}

export const handler = async (event) => {
  // GET = lightweight status probe. The template hits this on boot to know
  // whether the chatbot UI should render. No body, no LLM call, no cost.
  if (event.httpMethod === "GET") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ configured: !!process.env.GEMINI_API_KEY }),
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let message;
  let history = [];
  try {
    ({ message, history = [] } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  if (!message) return { statusCode: 400, body: JSON.stringify({ error: "Message is required" }) };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: "API key not configured" }) };

  let systemPrompt;
  try {
    systemPrompt = await buildSystemPrompt();
  } catch (err) {
    console.error("[llm] Failed to build system prompt:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: "Portfolio data unavailable" }) };
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [
            ...history.map((m) => ({
              role: m.role,
              parts: [{ text: m.text }],
            })),
            { role: "user", parts: [{ text: message }] },
          ],
        }),
      }
    );

    const data = await response.json();
    if (data.error) return { statusCode: 500, body: JSON.stringify({ error: data.error.message }) };

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!reply) throw new Error("Empty response from Gemini");

    return { statusCode: 200, body: JSON.stringify({ reply }) };
  } catch (err) {
    console.error("[llm] Gemini call failed:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Something went wrong." }) };
  }
};
