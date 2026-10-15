import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Shell from "./components/Shell";
import Login from "./pages/Login";
import Console from "./pages/Console";
import Planner from "./pages/Planner";
import Oversight from "./pages/Oversight";
import Dashboard from "./pages/Dashboard";
import Board from "./pages/Board";
import Verify from "./pages/Verify";
import Docs from "./pages/Docs";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Shell requireAuth={false} />}>
        <Route path="/verify" element={<Verify />} />
        <Route path="/verify/:id" element={<Verify />} />
        <Route path="/docs" element={<Docs />} />
      </Route>
      <Route element={<Shell />}>
        <Route path="/" element={<Console />} />
        <Route path="/planner" element={<Planner />} />
        <Route path="/oversight" element={<Oversight />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/board" element={<Board />} />
      </Route>
      <Route path="*" element={<RedirectHome />} />
    </Routes>
  );
}

function RedirectHome() {
  const loc = useLocation();
  // API-style 401s send the SPA to login; unknown paths go home
  return <Navigate to={loc.pathname.startsWith("/login") ? "/login" : "/"} replace />;
}
