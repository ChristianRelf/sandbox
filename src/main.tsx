import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./attribution.css";
import "./preferences.css";
import "./qol.css";
import App from "./App";
import { ToastProvider } from "./components/ui/Toast";
import { TooltipProvider } from "./components/ui/Tooltip";

createRoot(document.getElementById("root")!).render(<StrictMode><TooltipProvider><ToastProvider><App/></ToastProvider></TooltipProvider></StrictMode>);
