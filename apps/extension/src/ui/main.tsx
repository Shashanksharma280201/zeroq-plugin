import "../lib/platform.ts";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { backfill } from "../lib/events.ts";

// Normally done by the background worker; harmless to repeat, it runs once.
backfill().catch(() => {});
import "./styles.css";

const surface = document.documentElement.dataset.surface === "sidepanel" ? "sidepanel" : "app";
createRoot(document.getElementById("root")!).render(<App surface={surface} />);
