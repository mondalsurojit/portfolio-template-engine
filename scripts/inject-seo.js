import fs from "fs";
import path from "path";

const templatePath = path.resolve("index.template.html");
const outputPath = path.resolve("index.html");

async function getData() {
    const githubToken = process.env.GITHUB_TOKEN;
    const githubOwner = process.env.GITHUB_OWNER;
    const githubRepo = process.env.GITHUB_REPO;

    // Local template dev (no GitHub env vars) — return empty so placeholders
    // resolve to "" and the template engine still boots. The deployed Netlify
    // build always has these injected by the CMS before the build runs.
    if (!githubToken || !githubOwner || !githubRepo) {
        console.warn("[inject-seo] GitHub env vars missing — skipping data fetch (local dev mode).");
        return {};
    }

    const response = await fetch(
        `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/public/data/data.json`,
        {
            headers: {
                Authorization: `token ${githubToken}`,
                Accept: "application/vnd.github.v3.raw",
            },
        }
    );

    if (!response.ok) {
        throw new Error(`Failed to fetch data.json (${response.status})`);
    }

    return await response.json();
}

async function injectSEO() {
    const data = await getData();

    const user = data?.user || {};
    const settings = data?.settings || {};

    const fullName = `${user.firstName || ""} ${user.lastName || ""}`.trim();
    const siteTitle = settings.siteTitle || '';
    const siteDescription = settings.siteDescription || '';
    const siteUrl = settings.siteUrl || '';
    const siteImage = settings.siteImage || '';

    let html = fs.readFileSync(templatePath, "utf-8");

    html = html
        .replaceAll("%VITE_SITE_TITLE%", siteTitle)
        .replaceAll("%VITE_SITE_DESCRIPTION%", siteDescription)
        .replaceAll("%VITE_SITE_URL%", siteUrl)
        .replaceAll("%VITE_SITE_IMAGE%", siteImage);

    fs.writeFileSync(outputPath, html);

    console.log("SEO injected successfully");
}

injectSEO().catch((err) => {
    // Don't break local dev or the CI build on transient fetch errors — leave
    // index.html as-is (or with empty SEO) and log loudly.
    console.error("[inject-seo] Failed:", err.message);
    process.exit(0);
});