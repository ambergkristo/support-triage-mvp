import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchMessages } from "../api";
import type { EmailMessage } from "../types";

export function InboxPage() {
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const nextMessages = await fetchMessages();
        if (active) {
          setMessages(nextMessages);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load inbox.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  if (loading) return <p>Loading inbox...</p>;
  if (error) return <p className="error">Error: {error}</p>;

  return (
    <section>
      <h2>Inbox</h2>
      {messages.length === 0 ? (
        <p>No messages found.</p>
      ) : (
        <ul className="message-list">
          {messages.map((message) => (
            <li key={message.id} className="card">
              <h3>{message.subject || "(No subject)"}</h3>
              <p>
                <strong>From:</strong> {message.from || "Unknown sender"}
              </p>
              <p>{message.snippet || "No snippet available."}</p>
              <Link to={`/inbox/${message.id}`}>View email</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
