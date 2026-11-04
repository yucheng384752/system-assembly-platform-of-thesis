import { useId, useRef, useState, type KeyboardEvent } from "react";
import { FeedbackPanel } from "../components/analyticalFour/FeedbackPanel";
import { PreparePanel } from "../components/analyticalFour/PreparePanel";
import { RunPanel } from "../components/analyticalFour/RunPanel";
import { SettingsPanel } from "../components/analyticalFour/SettingsPanel";
import { useLabels } from "../components/analyticalFour/labels";
import "../styles/analytical-four.css";

const TABS = ["prepare", "settings", "run", "feedback"] as const;
type TabId = (typeof TABS)[number];

export function AnalyticalFourPage() {
  const L = useLabels();
  const [tab, setTab] = useState<TabId>("prepare");
  const base = useId();
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});

  // Arrow keys move between the sections, as a tab list is expected to.
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(index + step + TABS.length) % TABS.length];
    setTab(next);
    buttons.current[next]?.focus();
  };

  return (
    <div className="a4-page">
      <header className="a4-header">
        <h2 className="a4-h2">{L.title}</h2>
        <p className="a4-hint">{L.intro}</p>
      </header>
      <div className="a4-tabs" role="tablist" aria-label={L.title}>
        {TABS.map((id, index) => (
          <button
            key={id}
            ref={(element) => {
              buttons.current[id] = element;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`${base}-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={`a4-tab ${tab === id ? "is-active" : ""}`}
            onClick={() => setTab(id)}
            onKeyDown={(event) => onKey(event, index)}
          >
            {L.tabs[id]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel-${tab}`} aria-labelledby={`${base}-tab-${tab}`} className="a4-body">
        {tab === "prepare" ? <PreparePanel /> : null}
        {tab === "settings" ? <SettingsPanel /> : null}
        {tab === "run" ? <RunPanel /> : null}
        {tab === "feedback" ? <FeedbackPanel /> : null}
      </div>
    </div>
  );
}
