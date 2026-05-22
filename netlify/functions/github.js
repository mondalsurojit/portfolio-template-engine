// Generic secure proxy for any file in the private GitHub repo.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Simple in-memory cache: path → { body, contentType, fetchedAt }
const cache = {};

// Mime type map for files we serve
const MIME = {
  json: "application/json",
  pdf:  "application/pdf",
  md:   "text/markdown",
};

const extOf = (path) => path.split(".").pop().toLowerCase();

export const handler = async (event) => {
  try {
    const owner = process.env.GITHUB_OWNER;
    const repo  = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_TOKEN;

    if (!owner || !repo || !token) {
      console.error("[github] Missing GITHUB_OWNER / GITHUB_REPO / GITHUB_TOKEN env vars.");
      return { statusCode: 500, body: "Server configuration error." };
    }

    // Require a path param
    const filePath = event.queryStringParameters?.path;
    if (!filePath) {
      return { statusCode: 400, body: "Missing 'path' query parameter." };
    }

    // Basic path sanitation — block traversal attempts
    if (filePath.includes("..") || filePath.startsWith("/")) {
      return { statusCode: 400, body: "Invalid path." };
    }

    const ext = extOf(filePath);
    const contentType = MIME[ext] || "application/octet-stream";
    const isPdf = ext === "pdf";

    // Cache check
    const now = Date.now();
    const cached = cache[filePath];
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": cached.contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
        body: cached.body,
        isBase64Encoded: cached.isBase64Encoded,
      };
    }

    // Fetch from GitHub Contents API
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3.raw", // returns raw file bytes directly
      },
    });

    if (!res.ok) {
      const status = res.status === 404 ? 404 : 502;
      console.error(`[github] GitHub API returned ${res.status} for path: ${filePath}`);
      return { statusCode: status, body: status === 404 ? "File not found." : "GitHub API error." };
    }

    let body;
    let isBase64Encoded = false;

    if (isPdf) {
      const buffer = await res.arrayBuffer();
      body = Buffer.from(buffer).toString("base64");
      isBase64Encoded = true;
    } else {
      body = await res.text();
    }

    // Store in cache
    cache[filePath] = { body, contentType, isBase64Encoded, fetchedAt: now };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
      body,
      isBase64Encoded,
    };

  } catch (error) {
    console.error("[github] Unhandled error:", error.message);
    return { statusCode: 500, body: "Server error." };
  }
};