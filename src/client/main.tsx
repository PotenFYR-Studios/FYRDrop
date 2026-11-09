import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

/** Shows a recovery card instead of a blank screen if rendering throws. */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("FYRDrop crashed while rendering:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const msg = String(this.state.error?.message ?? this.state.error);
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ maxWidth: 460, border: "1px solid #2a3247", borderRadius: 16, background: "#0d1119", padding: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#fff", marginBottom: 8 }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 16 }}>
            The interface hit an error. Reloading usually fixes it; if not, clear the cache.
          </div>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11, color: "#64748b", margin: "0 0 16px" }}>{msg}</pre>
          <button
            onClick={() => location.replace(location.pathname + "?reload=" + Date.now())}
            style={{ background: "#4f46e5", color: "#fff", border: 0, borderRadius: 10, padding: "10px 16px", fontSize: 13, cursor: "pointer" }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
);

(window as unknown as { __fyrdropBooted?: () => void }).__fyrdropBooted?.();
