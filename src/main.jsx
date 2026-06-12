import * as React from "react";
import * as ReactDOM from "react-dom/client";
import * as jsxRuntime from "react/jsx-runtime";
import * as ReactRouter from "react-router-dom";

import { StrictMode, createContext, useEffect, useState } from "react";
import { BrowserRouter } from "react-router-dom";
import "./index.css";

// SHARE REACT GLOBALLY
window.React = React;
window.ReactDOM = ReactDOM;
window.__JSX_RUNTIME__ = jsxRuntime;
window.__REACT_ROUTER__ = ReactRouter;

// SHARED CONTEXTS
export const DataContext = createContext();
export const BlogsContext = createContext();
export const ChatBotContext = createContext();
export const ContactContext = createContext();

window.__PORTFOLIO_CONTEXTS__ = {
  DataContext,
  BlogsContext,
  ChatBotContext,
  ContactContext,
};

// ── Boot screens ─────────────────────────────────────────────────────────────
// Inline styles only — these render BEFORE the template's CSS is loaded.

const screenStyle = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  background: "#f8fafc",
  color: "#0f172a",
};

function BootError({ title, message }) {
  return (
    <div style={screenStyle}>
      <div
        style={{
          maxWidth: 460,
          width: "100%",
          padding: 24,
          borderRadius: 16,
          background: "#fff",
          border: "1px solid #e2e8f0",
          boxShadow: "0 12px 28px rgba(15, 23, 42, 0.06)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            margin: "0 auto 12px",
            borderRadius: "50%",
            background: "#fef2f2",
            color: "#dc2626",
            fontSize: 22,
            lineHeight: "44px",
            fontWeight: 600,
          }}
        >
          !
        </div>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 8px" }}>
          {title}
        </h2>
        <p
          style={{
            fontSize: 13,
            color: "#475569",
            margin: 0,
            lineHeight: 1.55,
          }}
        >
          {message}
        </p>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function injectStylesheet(href) {
  return new Promise((resolve) => {
    if (document.querySelector("[data-template-css]")) {
      resolve();
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-template-css", "");
    link.onload = resolve;
    link.onerror = () => resolve(new Error(`Stylesheet ${href} failed to load`));
    document.head.appendChild(link);
  });
}

// Fetch + JSON parse with proper error context. Distinguishes between a transport
// failure (server returned HTML/text) and an actual JSON payload — so the user
// gets "data.json not reachable" instead of "Unexpected token <" in the console.
async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Couldn't reach ${url} — ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(`Storage request failed (HTTP ${res.status})`);
  }
  const contentType = res.headers.get("content-type") || "";
  const body = await res.text();
  if (!contentType.includes("application/json")) {
    const preview = body.slice(0, 60).replace(/\s+/g, " ");
    throw new Error(
      `Expected JSON but received "${contentType || "unknown"}" — response starts with: ${preview}`
    );
  }
  try {
    return JSON.parse(body);
  } catch (err) {
    throw new Error(`Storage returned malformed JSON — ${err.message}`);
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────

function AppProviders() {
  const [TemplateApp, setTemplateApp] = useState(null);
  const [data, setData] = useState(null);
  const [blogs, setBlogs] = useState([]);
  const [darkMode, setDarkMode] = useState(null);
  const [showChatbot, setShowChatbot] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [bootError, setBootError] = useState(null);
  // Chatbot UI is gated on this. The engine's /llm function exposes a GET
  // probe that reports whether GEMINI_API_KEY is set server-side.
  const [aiConfigured, setAiConfigured] = useState(false);

  useEffect(() => {
    async function boot() {
      // 1. LOAD DATA — NON-FATAL. If data.json can't be fetched, the template
      //    still renders with an empty data object; empty-state handling lives in
      //    the template, not here.
      let json = {};
      try {
        json = await fetchJson(
          "/.netlify/functions/github?path=public/data/data.json"
        );
      } catch (err) {
        console.warn("[engine] data.json not loaded — rendering template with empty data:", err.message);
      }
      setData(json);
      // Theme can be "auto" (default), "light", or "dark". For "auto" we
      // mirror the visitor's OS prefers-color-scheme; the live-update listener
      // is wired below so visitors who toggle their OS theme see the portfolio
      // flip in real time.
      const theme = json?.settings?.theme || "auto";
      setDarkMode(
        theme === "auto"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
          : theme === "dark"
      );

      // 1b. LOAD BLOGS — separate file (blogs.json) — also NON-FATAL. Sort once
      //     here (newest first) so every consumer sees the same order.
      let blogsJson = [];
      try {
        blogsJson = await fetchJson(
          "/.netlify/functions/github?path=public/data/blogs.json"
        );
        if (!Array.isArray(blogsJson)) blogsJson = [];
      } catch (err) {
        console.warn("[engine] blogs.json not loaded — rendering with empty blogs:", err.message);
      }
      setBlogs(
        [...blogsJson].sort(
          (a, b) => new Date(b.dateUploaded || 0) - new Date(a.dateUploaded || 0)
        )
      );

      // 1c. PROBE LLM CONFIG — NON-FATAL. The template uses this + botName to
      //     decide whether to render the chatbot UI at all.
      try {
        const probe = await fetch("/.netlify/functions/llm");
        if (probe.ok) {
          const { configured } = await probe.json();
          setAiConfigured(!!configured);
        }
      } catch (err) {
        console.warn("[engine] llm probe failed — chatbot will stay hidden:", err.message);
      }

      // 2. LOAD TEMPLATE — this IS fatal. If the template can't load, the engine
      //    has nothing to render.
      try {
        const baseUrl = json?.settings?.template;
        if (!baseUrl) throw new Error("No template URL in data.settings.template");
        const templateUrl = `${baseUrl}/template.js`;
        const cssUrl = `${baseUrl}/style.css`;

        console.log("[engine] Loading template from:", baseUrl);

        await injectStylesheet(cssUrl);
        const template = await import(/* @vite-ignore */ templateUrl);
        if (!template?.default) {
          throw new Error(`Template at ${templateUrl} has no default export`);
        }
        setTemplateApp(() => template.default);
      } catch (err) {
        console.error("[engine] Template load failed:", err.message);
        setBootError({
          title: "Template couldn't load",
          message: "Please try refreshing in a moment",
        });
      }
    }
    boot();
  }, []);

  useEffect(() => {
    if (darkMode === null) return;
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  // When theme === "auto", keep the portfolio in sync with the visitor's OS
  // theme toggle in real time. No-op for explicit light/dark.
  useEffect(() => {
    if ((data?.settings?.theme || "auto") !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e) => setDarkMode(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [data?.settings?.theme]);

  if (bootError) {
    return (
      <BootError
        title={bootError.title}
        message={bootError.message}
      />
    );
  }
  if (!data || !TemplateApp) return null;

  return (
    <DataContext.Provider value={{ ...data, darkMode, setDarkMode, aiConfigured }}>
      <BlogsContext.Provider value={blogs}>
        <ChatBotContext.Provider value={{ showChatbot, setShowChatbot }}>
          <ContactContext.Provider value={{ showContact, setShowContact }}>
            <BrowserRouter>
              <TemplateApp />
            </BrowserRouter>
          </ContactContext.Provider>
        </ChatBotContext.Provider>
      </BlogsContext.Provider>
    </DataContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AppProviders />
  </StrictMode>
);
