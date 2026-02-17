import { useEffect, useMemo, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

async function fetchJson(path) {
  const response = await fetch(`${API_BASE_URL}${path}`);
  const raw = await response.text();
  let data = null;

  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    raw,
  };
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detailBody, setDetailBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  async function loadStatus() {
    const result = await fetchJson("/auth/status");
    if (!result.ok || !result.data) {
      throw new Error("Failed to load auth status.");
    }
    setStatus(result.data);
    return result.data;
  }

  async function loadTriage(limit = 20) {
    setLoading(true);
    setError("");

    try {
      const result = await fetchJson(`/triage?limit=${limit}`);
      if (result.status === 401) {
        setItems([]);
        setSelected(null);
        setDetailBody("");
        setError("Not authenticated. Connect Google to load triage.");
        return;
      }
      if (!result.ok || !Array.isArray(result.data?.items)) {
        throw new Error("Failed to load triage list.");
      }

      setItems(result.data.items);
      const first = result.data.items[0] ?? null;
      setSelected(first);
      setDetailBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(messageId) {
    setDetailBody("");
    const result = await fetchJson(`/gmail/messages/${messageId}`);
    if (!result.ok || !result.data?.item) {
      setDetailBody("Could not load message body.");
      return;
    }

    setDetailBody(result.data.item.plainText || "(No plain text body available)");
  }

  async function handleRefresh() {
    try {
      const nextStatus = await loadStatus();
      if (nextStatus.authenticated) {
        await loadTriage(20);
      } else {
        setItems([]);
        setSelected(null);
        setDetailBody("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
    }
  }

  useEffect(() => {
    handleRefresh();
  }, []);

  const categories = useMemo(() => {
    const unique = new Set(items.map((it) => it.triage?.category).filter(Boolean));
    return ["all", ...Array.from(unique).sort()];
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const priorityOk = priorityFilter === "all" || item.triage?.priority === priorityFilter;
      const categoryOk = categoryFilter === "all" || item.triage?.category === categoryFilter;
      return priorityOk && categoryOk;
    });
  }, [items, priorityFilter, categoryFilter]);

  return (
    <div className="page">
      <header className="hero">
        <h1>Support Triage Workbench</h1>
        <p>Connect Google, inspect inbox triage, and open message details.</p>
        <div className="actions">
          <a className="button" href={`${API_BASE_URL}/auth/google`}>
            Connect Google
          </a>
          <button className="button button-secondary" onClick={handleRefresh} type="button">
            Refresh
          </button>
        </div>
      </header>

      <section className="panel">
        <h2>Status</h2>
        {!status ? (
          <p>Loading status...</p>
        ) : (
          <p>
            Connection: <strong>{status.authenticated ? "Connected" : "Disconnected"}</strong> | Refresh token: {" "}
            <strong>{status.hasRefreshToken ? "Yes" : "No"}</strong>
          </p>
        )}
      </section>

      <section className="panel">
        <div className="toolbar">
          <h2>Triage List</h2>
          <div className="filters">
            <label>
              Priority
              <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
                <option value="all">All</option>
                <option value="P0">P0</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
              </select>
            </label>
            <label>
              Category
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {loading ? <p>Loading triage...</p> : null}
        {error ? <p className="error">{error}</p> : null}

        <div className="grid">
          <table>
            <thead>
              <tr>
                <th>Priority</th>
                <th>From</th>
                <th>Subject</th>
                <th>Date</th>
                <th>Category</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr
                  key={item.email.id}
                  onClick={() => {
                    setSelected(item);
                    loadDetail(item.email.id);
                  }}
                  className={selected?.email.id === item.email.id ? "active" : ""}
                >
                  <td>{item.triage.priority}</td>
                  <td>{item.email.from}</td>
                  <td>{item.email.subject}</td>
                  <td>{item.email.date}</td>
                  <td>{item.triage.category}</td>
                </tr>
              ))}
              {!loading && filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={5}>No triage items for selected filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <aside className="detail">
            <h3>Detail</h3>
            {!selected ? (
              <p>Select an email to view detail.</p>
            ) : (
              <>
                <p><strong>Subject:</strong> {selected.email.subject}</p>
                <p><strong>From:</strong> {selected.email.from}</p>
                <p><strong>Summary:</strong> {selected.triage.summary}</p>
                <p><strong>Action:</strong> {selected.triage.action}</p>
                <p><strong>Confidence:</strong> {selected.triage.confidence}</p>
                <p><strong>Body:</strong></p>
                <pre>{detailBody || selected.email.snippet || "(No body loaded yet)"}</pre>
              </>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
