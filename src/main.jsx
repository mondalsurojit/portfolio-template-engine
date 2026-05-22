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
export const ChatBotContext = createContext();
export const ContactContext = createContext();

window.__PORTFOLIO_CONTEXTS__ = {
  DataContext,
  ChatBotContext,
  ContactContext,
};

// INJECT TEMPLATE STYLESHEET
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
    link.onerror = resolve; // don't block boot if CSS 404s
    document.head.appendChild(link);
  });
}

function AppProviders() {
  const [TemplateApp, setTemplateApp] = useState(null);

  const [darkMode, setDarkMode] = useState(null);
  const [data, setData] = useState(null);

  const [showChatbot, setShowChatbot] = useState(false);
  const [showContact, setShowContact] = useState(false);

  useEffect(() => {
    async function boot() {
      try {
        // LOAD DATA
        const res = await fetch(
          "/.netlify/functions/github?path=public/data/data.json"
        );
        const json = await res.json();

        setData(json);
        setDarkMode(json?.settings?.theme === "dark");

        // DERIVE TEMPLATE URLS FROM BASE
        const baseUrl = json?.settings?.template;
        const templateUrl = `${baseUrl}/template.js`;
        const cssUrl = `${baseUrl}/style.css`;

        // LOAD TEMPLATE CSS + JS
        await injectStylesheet(cssUrl);
        const template = await import(/* @vite-ignore */ templateUrl);

        setTemplateApp(() => template.default);

      } catch (err) {
        console.error("Engine boot failed:", err);
      }
    }

    boot();
  }, []);

  useEffect(() => {
    if (darkMode === null) return;

    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  if (!data || !TemplateApp) return null;

  return (
    <DataContext.Provider
      value={{
        ...data,
        darkMode,
        setDarkMode,
      }}
    >
      <ChatBotContext.Provider
        value={{
          showChatbot,
          setShowChatbot,
        }}
      >
        <ContactContext.Provider
          value={{
            showContact,
            setShowContact,
          }}
        >
          <BrowserRouter>
            <TemplateApp />
          </BrowserRouter>
        </ContactContext.Provider>
      </ChatBotContext.Provider>
    </DataContext.Provider>
  );
}

ReactDOM.createRoot(
  document.getElementById("root")
).render(
  <StrictMode>
    <AppProviders />
  </StrictMode>
);