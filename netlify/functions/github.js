// Generic secure proxy for any file in the private GitHub repo.
// Cache strategy is split by file type:
//   - JSON / Markdown (data.json, blogs.json, content.md) are the source of
//     truth the CMS publishes. They're small and change often, so we never
//     cache them — every read goes to GitHub for instant propagation.
//   - Everything else (images, PDFs) is large and rarely changes, so we cache
//     for 5 minutes. Avoids re-fetching the same image for every visitor and
//     protects the GITHUB_TOKEN rate limit (5000/hr) on bursty traffic.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (binaries only)
const NO_CACHE_EXTS = new Set(["json", "md"]);

// Simple in-memory cache: path → { body, contentType, fetchedAt }
const cache = {};

// Mime type map for files we serve
const MIME = {
  json: "application/json",
  pdf:  "application/pdf",
  md:   "text/markdown",
  txt:  "text/plain",
  html: "text/html",
  svg:  "image/svg+xml",
  webp: "image/webp",
  png:  "image/png",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  gif:  "image/gif",
  avif: "image/avif",
  ico:  "image/x-icon",
};

// Text formats can be returned via res.text(); everything else MUST be
// base64-encoded or the raw bytes get corrupted by UTF-8 decoding.
const TEXT_EXTS = new Set(["json", "md", "txt", "html", "svg"]);

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
    const isBinary = !TEXT_EXTS.has(ext);
    const skipCache = NO_CACHE_EXTS.has(ext);

    // Cache check — bypassed entirely for JSON / Markdown so CMS publishes
    // reach the engine instantly.
    const now = Date.now();
    const cached = skipCache ? null : cache[filePath];
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

    if (isBinary) {
      const buffer = await res.arrayBuffer();
      body = Buffer.from(buffer).toString("base64");
      isBase64Encoded = true;
    } else {
      body = await res.text();
    }

    // Store in cache (skipped for JSON / Markdown).
    if (!skipCache) {
      cache[filePath] = { body, contentType, isBase64Encoded, fetchedAt: now };
    }

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