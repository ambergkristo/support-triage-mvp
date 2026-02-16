import { getGoogleAuthUrl } from "../api";

export function HomePage() {
  const connectGmail = () => {
    window.location.href = getGoogleAuthUrl();
  };

  return (
    <section className="card">
      <h2>Connect your inbox</h2>
      <p>Authorize Gmail to load recent messages into Support Triage MVP.</p>
      <button type="button" onClick={connectGmail}>
        Connect Gmail
      </button>
    </section>
  );
}
