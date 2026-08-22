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
      ? "font-medium text-slate-900"
      : "text-slate-500 hover:text-slate-900";

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
        <Link to="/watches" className="font-semibold text-slate-900">
          CraigsNotice
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link to="/watches" className={linkClass("/watches")}>
            Watches
          </Link>
          <Link to="/alerts" className={linkClass("/alerts")}>
            Alerts
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-3 text-sm">
          {push.status !== "granted" && (
            <button
              type="button"
              onClick={() => void push.enable()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
            >
              {push.status === "idle"
                ? "Enable notifications"
                : "Alerts show in-app"}
            </button>
          )}
          <span className="text-slate-500">{user?.email}</span>
          <button
            type="button"
            onClick={() => void signOutUser()}
            className="text-slate-500 hover:text-slate-900"
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
      <div className="flex min-h-[60vh] items-center justify-center text-slate-500">
        Loading…
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <div className="min-h-screen bg-slate-50">
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
