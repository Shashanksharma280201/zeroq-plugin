import { Component, type ReactNode } from "react";

/**
 * If anything in Zero Q crashes while drawing, show what happened and a way
 * back, never an empty panel. The details can be copied for a bug report.
 */
export class CrashGuard extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    remember(`render: ${error.message}\n${(error.stack ?? "").split("\n").slice(0, 6).join("\n")}`);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <CrashScreen detail={`${this.state.error.message}\n${(this.state.error.stack ?? "").split("\n").slice(0, 6).join("\n")}`} />;
  }
}

export function CrashScreen({ detail }: { detail: string }) {
  const report = `Zero Q ${chrome.runtime.getManifest().version} on ${navigator.userAgent}\n${location.pathname}${location.hash}\n\n${detail}\n\nRecent:\n${recent().join("\n")}`;
  return (
    <div className="crash" role="alert">
      <h1>Something went wrong</h1>
      <p>Zero Q hit an error drawing this screen. Your data is safe. Reload usually fixes it; if it doesn't, copy the details and send them over.</p>
      <div className="crash-actions">
        <button className="btn filled" onClick={() => location.reload()}>Reload</button>
        <button className="btn gray" onClick={() => navigator.clipboard.writeText(report).then(() => ((document.getElementById("crash-copy")!).textContent = "Copied"))}><span id="crash-copy">Copy details</span></button>
      </div>
      <details><summary>Details</summary><pre>{report}</pre></details>
    </div>
  );
}

// ---------- a short memory of errors, for the report ----------
const KEY = "zq-errors";
export function remember(line: string) {
  try {
    const list = [...recent(), `${new Date().toISOString().slice(11, 19)} ${line}`].slice(-12);
    sessionStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
}
function recent(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}
addEventListener("error", (e) => remember(`error: ${e.message} @ ${e.filename?.split("/").pop()}:${e.lineno}`));
addEventListener("unhandledrejection", (e) => remember(`promise: ${e.reason?.message ?? e.reason}`));
