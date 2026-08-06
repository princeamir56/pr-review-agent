import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { PRDetail } from "./pages/PRDetail";
import { ReportViewer } from "./pages/ReportViewer";
import { Settings } from "./pages/Settings";
import { ToastProvider } from "./components/Toast";
// Highlight.js theme for rendered code blocks in reports.
import "highlight.js/styles/github-dark.css";

export default function App(): JSX.Element {
  return (
    <ToastProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="pr/:number" element={<PRDetail />} />
          <Route path="reports" element={<ReportViewer />} />
          <Route path="reports/:name" element={<ReportViewer />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
