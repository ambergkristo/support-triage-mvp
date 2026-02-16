import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchMessages, triageMessage } from "../api";
import type { EmailMessage } from "../types";

export function EmailDetailPage() {
  const { id } = useParams();
  const [message, setMessage] = useState<EmailMessage | null>(null);
  const [loadingMessage, setLoadingMessage] = useState(true);
  const [messageError, setMessageError] = useState<string | null>(null);

  const [triageLoading, setTriageLoading] = useState(false);
  const [triageError, setTriageError] = useState<string | null>(null);
  const [triageOutput, setTriageOutput] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoadingMessage(true);
        setMessageError(null);
        const messages = await fetchMessages();
        const selected = messages.find((m) => m.id === id) ?? null;
        if (active) {
          setMessage(selected);
          if (!selected) setMessageError("Message not found.");
        }
      } catch (err) {
        if (active) {
          setMessageError(err instanceof Error ? err.message : "Failed to load message.");
        }
      } finally {
        if (active) setLoadingMessage(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [id]);

  const handleTriage = async () => {
    if (!message) return;
    try {
      setTriageLoading(true);
      setTriageError(null);
      const result = await triageMessage(message);
      setTriageOutput(JSON.stringify(result, null, 2));
    } catch (err) {
      setTriageError(err instanceof Error ? err.message : "Triage failed.");
    } finally {
      setTriageLoading(false);
    }
  };

  if (loadingMessage) return <p>Loading email...</p>;
  if (messageError) return <p className="error">Error: {messageError}</p>;
  if (!message) return <p className="error">Message not found.</p>;

  return (
    <section className="card">
      <p>
        <Link to="/inbox">Back to inbox</Link>
      </p>
      <h2>{message.subject || "(No subject)"}</h2>
      <p>
        <strong>From:</strong> {message.from || "Unknown sender"}
      </p>
      <p>{message.snippet || "No snippet available."}</p>
      <button type="button" onClick={handleTriage} disabled={triageLoading}>
        {triageLoading ? "Triaging..." : "Triage"}
      </button>
      {triageError && <p className="error">Error: {triageError}</p>}
      {triageOutput && (
        <>
          <h3>Triage Result</h3>
          <pre>{triageOutput}</pre>
        </>
      )}
    </section>
  );
}
