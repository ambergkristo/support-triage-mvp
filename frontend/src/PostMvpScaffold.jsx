import { useEffect, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export default function PostMvpScaffold() {
  const [flags, setFlags] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/feature-flags`)
      .then((response) => response.json())
      .then((payload) => setFlags(payload.flags || null))
      .catch(() => setFlags(null));
  }, []);

  return (
    <section className="panel">
      <h2>Post-MVP Scaffold</h2>
      <p>Planned features: multi-user workspaces, team inbox assignments, and rules admin tooling.</p>
      <p>
        AI toggle (safe fallback always rules): {" "}
        <strong>{flags ? (flags.aiTriageEnabled ? "enabled (shadow)" : "disabled") : "unknown"}</strong>
      </p>
      <p>See <code>docs/M9_ARCHITECTURE.md</code> and <code>BACKLOG.md</code>.</p>
    </section>
  );
}
