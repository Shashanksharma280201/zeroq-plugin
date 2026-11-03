import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

const surface = document.documentElement.dataset.surface === "sidepanel" ? "sidepanel" : "app";
createRoot(document.getElementById("root")!).render(<App surface={surface} />);
