import React, { useEffect, useState } from "react";
import { Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import Landing from "./pages/Landing.jsx";
import Upload from "./pages/Upload.jsx";
import Summary from "./pages/Summary.jsx";
import Login from "./pages/login.jsx";
import api from "./api.js";

// --- session hook: asks backend if cookie session is valid
function useSession() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    api
      .get("/auth/me")
      .then((res) => mounted && setUser(res.data.user))
      .catch(() => mounted && setUser(null))
      .finally(() => mounted && setReady(true));
    return () => {
      mounted = false;
    };
  }, []);

  const logout = async () => {
    try {
      await api.post("/auth/logout");
      setUser(null);
      // hard refresh so guarded pages bounce correctly
      window.location.href = "/";
    } catch {
      // ignore
    }
  };

  return { user, ready, logout, setUser };
}

// --- route guard that waits for session check then protects page
function Protected({ children }) {
  const { user, ready } = useSession();
  const loc = useLocation();
  if (!ready) return null; // could show spinner
  if (!user) return <Navigate to="/login" replace state={{ from: loc }} />;
  return children;
}

export default function App() {
  // keep session state in one place so Nav can show Login/Logout
  const session = useSession();

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Fixed, opaque header */}
      <nav className="fixed top-0 inset-x-0 bg-white border-b shadow-sm z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="font-semibold text-lg">iShip Inspection AI</Link>
          <NavRight session={session} />
        </div>
      </nav>

      {/* Give space under fixed header */}
      <main className="pt-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<LoginPage session={session} />} />
          <Route
            path="/upload"
            element={
              <Protected>
                <Upload />
              </Protected>
            }
          />
          <Route
            path="/summary"
            element={
              <Protected>
                <Summary />
              </Protected>
            }
          />
          {/* catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function NavRight({ session }) {
  const { user, logout, ready } = session;
  if (!ready) return null;

  return (
    <div className="space-x-4 text-sm flex items-center">
      <Link to="/" className="hover:underline">Home</Link>
      {user ? (
        <>
          <Link to="/upload" className="hover:underline">Upload</Link>
          <button onClick={logout} className="rounded bg-slate-900 text-white px-3 py-1.5">
            Logout
          </button>
        </>
      ) : (
        <Link to="/login" className="rounded bg-slate-900 text-white px-3 py-1.5">
          Login
        </Link>
      )}
    </div>
  );
}

// small wrapper so Login page can update session after auto-redirect
function LoginPage({ session }) {
  const { setUser } = session;
  // the simple Login.jsx you created already calls /auth/request then /auth/verify OR the magic link hits /auth/magic and redirects back.
/*
  Optional: if your Login.jsx wants to set user after success without reload:
  - after successful verify/magic redirect, you can invoke:
      api.get('/auth/me').then(r => setUser(r.data.user))
*/
  return <Login />;
}