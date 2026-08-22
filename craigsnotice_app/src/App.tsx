import { Navigate, Route, Routes, Link, useLocation } from "react-router-dom";
import { useRegisterFcmToken } from "@craigsnotice/client";
import { useAuth } from "./context/AuthContext";
import { useClientContext } from "./hooks/useClientContext";
import { usePushRegistration } from "./hooks/usePushRegistration";
import Login from "./pages/Login";
import Watches from "./pages/Watches";
import WatchDetail from "./pages/WatchDetail";
import Alerts from "./pages/Alerts";

const TopBar = () => {
  const { user, token, signOutUser } = useAuth();
  const ctx = useClientContext();
  const registerToken = useRegisterFcmToken(ctx);
  const push = usePushRegistration(token, (t) => registerToken.mutateAsync(t));
  const { pathname } = useLocation();

  const linkClass = (to: string): string =>
    pathname.startsWith(to)
      ? "eyebrow text-accent no-underline"
      : "eyebrow text-ink-faint no-underline hover:text-ink";

  return (
    <header className="rule-double bg-paper-deep">
      <div className="mx-auto flex max-w-6xl items-baseline gap-8 px-6 py-4">
        <Link
          to="/watches"
          className="text-xl font-bold tracking-title no-underline"
        >
          CraigsNotice
        </Link>

        <nav className="flex gap-5">
          <Link to="/watches" className={linkClass("/watches")}>
            Watches
          </Link>
          <Link to="/alerts" className={linkClass("/alerts")}>
            Alerts
          </Link>
        </nav>

        <div className="ml-auto flex items-baseline gap-5">
          {push.status !== "granted" && (
            <button
              type="button"
              onClick={() => void push.enable()}
              className="eyebrow text-ink-faint hover:text-accent"
            >
              {push.status === "idle"
                ? "Enable notifications"
                : "Alerts show in-app"}
            </button>
          )}
          <span className="eyebrow text-ink-faint">{user?.email}</span>
          <button
            type="button"
            onClick={() => void signOutUser()}
            className="eyebrow text-ink hover:text-accent"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
};

export const App = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <span className="eyebrow text-ink-faint">Loading</span>
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <div className="min-h-screen bg-paper">
      <TopBar />
      <Routes>
        <Route path="/" element={<Navigate to="/watches" replace />} />
        <Route path="/watches" element={<Watches />} />
        <Route path="/watches/:id" element={<WatchDetail />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="*" element={<Navigate to="/watches" replace />} />
      </Routes>
    </div>
  );
};

export default App;
