import { Link, Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { InboxPage } from "./pages/InboxPage";
import { EmailDetailPage } from "./pages/EmailDetailPage";

export default function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Support Triage MVP</h1>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/inbox">Inbox</Link>
        </nav>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/inbox/:id" element={<EmailDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
