import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

type ErrorBoundaryState = { error: Error | null };

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Nexora DAW render error", error, info);
  }

  render() {
    if (this.state.error) {
      const error = this.state.error;
      return (
        <div style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          background: "#0a0b10",
          color: "#e8eaf0",
          fontFamily: "Inter, system-ui, sans-serif",
          boxSizing: "border-box"
        }}>
          <div style={{ maxWidth: 760, width: "100%", border: "1px solid #252936", borderRadius: 16, padding: 24, background: "#11131a" }}>
            <div style={{ fontSize: 13, opacity: 0.65, letterSpacing: ".12em", textTransform: "uppercase" }}>Nexora DAW</div>
            <h1 style={{ margin: "10px 0 8px", fontSize: 22 }}>Application startup error</h1>
            <p style={{ margin: 0, opacity: 0.75 }}>The production shell loaded, but the React application failed during startup.</p>
            <pre style={{ marginTop: 18, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "#ffb4ab", background: "#090a0e", borderRadius: 10, padding: 14 }}>{error.stack || error.message}</pre>
            <button
              onClick={() => window.location.reload()}
              style={{ marginTop: 8, border: 0, borderRadius: 8, padding: "10px 14px", background: "#e8eaf0", color: "#0a0b10", cursor: "pointer" }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const telegram = window.Telegram?.WebApp;
try {
  telegram?.ready();
  telegram?.expand();
} catch (error) {
  console.warn("Telegram WebApp initialization failed", error);
}

window.addEventListener("error", event => {
  console.error("Nexora DAW uncaught error", event.error || event.message);
});

window.addEventListener("unhandledrejection", event => {
  console.error("Nexora DAW unhandled rejection", event.reason);
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
