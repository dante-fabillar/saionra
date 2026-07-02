const DEFAULT_MODEL = "gemini-2.5-flash";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isAllowedOrigin(req, res) {
  const allowed = parseList(process.env.SAIONRA_ALLOWED_ORIGINS);
  const origin = req.headers.origin || "";

  if (!allowed.length) {
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    return true;
  }

  if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    return true;
  }

  return !origin;
}

function cleanText(value, maxLength = 1500) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanArray(value, maxItems = 12, maxLength = 80) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function getRequestBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return {};
    }
  }

  return {};
}

function getTaskLabel(task) {
  const labels = {
    social_caption: "Create one polished social media caption.",
    social_ideas: "Create seven strong social media content ideas.",
    campaign_plan: "Create a structured social media campaign plan.",
    report_summary: "Create a concise social media performance summary."
  };

  return labels[task] || "Create useful social media content.";
}

function buildPrompt(payload) {
  const task = cleanText(payload.task, 60) || "social_caption";
  const brand = payload.brand || {};
  const request = payload.request || {};

  const brandName = cleanText(brand.name, 120) || "Saionra";
  const audience = cleanText(brand.audience, 260) || "small business owners, creators, and service teams";
  const offer = cleanText(brand.offer, 260) || "a smarter content workflow";
  const cta = cleanText(brand.cta, 160) || "Book a free consultation";
  const tone = cleanText(request.tone || brand.tone, 120) || "professional and simple";
  const voice = cleanText(brand.voice, 700);
  const pillars = cleanArray(brand.pillars).join(", ");
  const platforms = cleanArray(brand.platforms).join(", ");

  const goal = cleanText(request.goal, 120) || "get leads";
  const platform = cleanText(request.platform, 120) || "Instagram";
  const pillar = cleanText(request.pillar, 140) || "Educational";
  const angle = cleanText(request.angle, 220) || "make the next step easier";
  const length = cleanText(request.length, 60) || "Medium";
  const count = Number(request.count || 7);

  const taskInstruction = getTaskLabel(task);

  if (task === "social_ideas") {
    return `You are Saionra AI Engine, a senior social media strategist and content operations assistant.

Create ${Math.min(Math.max(count, 3), 10)} content ideas for this brand.

Brand: ${brandName}
Audience: ${audience}
Offer: ${offer}
Default CTA: ${cta}
Brand voice: ${voice || tone}
Content pillars: ${pillars || pillar}
Platforms: ${platforms || platform}
Selected platform: ${platform}
Campaign goal: ${goal}
Focus angle: ${angle}

Output format:
1. Title: ...
   Pillar: ...
   Hook angle: ...
   Why it works: ...
   CTA direction: ...

Rules:
- Make every idea specific and useful.
- Avoid generic AI wording.
- Do not mention APIs, prompts, backend, template, free tier, model, provider, or tokens.
- Do not say you are an AI.
- Use clear, simple English.`;
  }

  if (task === "report_summary") {
    return `You are Saionra AI Engine, a social media reporting assistant.

${taskInstruction}

Brand: ${brandName}
Audience: ${audience}
Offer: ${offer}
Tone: ${tone}
Raw report data: ${cleanText(JSON.stringify(request.metrics || request), 1800)}

Output a concise report with:
- What worked
- What needs improvement
- Recommended next action

Rules:
- Keep it client-ready.
- Do not mention APIs, backend, template, model, provider, or tokens.
- Use simple English.`;
  }

  return `You are Saionra AI Engine, a senior social media strategist and conversion-focused copywriter.

${taskInstruction}

Brand: ${brandName}
Audience: ${audience}
Offer: ${offer}
Default CTA: ${cta}
Brand voice: ${voice || tone}
Content pillars: ${pillars || pillar}
Platforms: ${platforms || platform}

Request:
- Goal: ${goal}
- Platform: ${platform}
- Content pillar: ${pillar}
- Tone: ${tone}
- Specific angle: ${angle}
- Length: ${length}

Write a ready-to-use caption for ${platform}.

Rules:
- Start with a strong human hook.
- Make the message clear, practical, and specific.
- Keep it natural, not robotic.
- Include a clear CTA using or adapting this CTA: ${cta}.
- Add 3 to 5 relevant hashtags only if useful for the selected platform.
- Do not mention APIs, prompts, backend, template, free tier, model, provider, or tokens.
- Do not include analysis or labels. Output only the final caption.`;
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => part?.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function getSafeModelName() {
  const model = cleanText(process.env.GEMINI_MODEL || DEFAULT_MODEL, 80);
  if (!/^[a-zA-Z0-9_.\/-]+$/.test(model)) return DEFAULT_MODEL;
  return model.startsWith("models/") ? model : `models/${model}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (!isAllowedOrigin(req, res)) {
    return sendJson(res, 403, { error: "Origin not allowed", fallback: true });
  }

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed", fallback: true });
  }

  if (process.env.SAIONRA_AI_ENABLED !== "true") {
    return sendJson(res, 503, { error: "Saionra AI Engine is not active yet", fallback: true });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return sendJson(res, 503, { error: "AI provider is not configured", fallback: true });
  }

  const payload = getRequestBody(req);
  const prompt = buildPrompt(payload);

  if (prompt.length > 8000) {
    return sendJson(res, 413, { error: "Request is too large", fallback: true });
  }

  const modelName = getSafeModelName();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const geminiResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.72,
          topP: 0.9,
          maxOutputTokens: payload.task === "social_ideas" ? 1100 : 850
        }
      })
    });

    const data = await geminiResponse.json().catch(() => ({}));

    if (!geminiResponse.ok) {
      return sendJson(res, 502, { error: "AI provider unavailable", fallback: true });
    }

    const text = extractGeminiText(data);
    if (!text) {
      return sendJson(res, 502, { error: "No AI output returned", fallback: true });
    }

    return sendJson(res, 200, {
      text,
      provider: "gemini",
      model: modelName.replace(/^models\//, "")
    });
  } catch (error) {
    return sendJson(res, 500, { error: "AI Engine request failed", fallback: true });
  }
}
