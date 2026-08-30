"use client";

import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  Check,
  Clock3,
  Code2,
  Database,
  FileCheck2,
  FileInput,
  FolderArchive,
  Globe2,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import styles from "./HeroExperience.module.css";

const routes = [
  {
    id: "browser",
    tab: "Browser",
    title: "Collect the morning report",
    summary: "Use a signed-in browser, verify the download and notify the team.",
    target: "This computer",
    receipt: "report.csv / 42 KB",
    steps: [
      { type: "Trigger", label: "Weekday / 08:00", icon: Clock3 },
      { type: "Browser", label: "Open portal", icon: Globe2 },
      { type: "Check", label: "Validate 12 rows", icon: FileCheck2 },
      { type: "Notify", label: "Tell the team", icon: Send },
    ],
  },
  {
    id: "files",
    tab: "Files",
    title: "Clear the incoming folder",
    summary: "Watch one approved folder, validate each file and keep the contents local.",
    target: "Approved folder",
    receipt: "18 files / organised",
    steps: [
      { type: "Watch", label: "New file arrives", icon: FileInput },
      { type: "Check", label: "Match the rules", icon: ShieldCheck },
      { type: "Transform", label: "Apply clean name", icon: Code2 },
      { type: "Archive", label: "Move locally", icon: FolderArchive },
    ],
  },
  {
    id: "private-api",
    tab: "Private API",
    title: "Check a service on your network",
    summary: "Call a private endpoint from inside its boundary and record the result.",
    target: "Self-hosted runner",
    receipt: "200 OK / evidence saved",
    steps: [
      { type: "Event", label: "Health window", icon: Webhook },
      { type: "Request", label: "Call private API", icon: Database },
      { type: "Condition", label: "Evaluate result", icon: ShieldCheck },
      { type: "History", label: "Store evidence", icon: Check },
    ],
  },
] as const;

export function HeroExperience() {
  const [routeIndex, setRouteIndex] = useState(0);
  const [run, setRun] = useState(0);
  const [activeStep, setActiveStep] = useState(-1);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const route = routes[routeIndex];
  const complete = activeStep >= route.steps.length;

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setActiveStep(route.steps.length);
      return;
    }

    setActiveStep(-1);
    const timers = route.steps.map((_, index) =>
      window.setTimeout(() => setActiveStep(index), 430 + index * 620),
    );
    timers.push(window.setTimeout(() => setActiveStep(route.steps.length), 430 + route.steps.length * 620));
    return () => timers.forEach(window.clearTimeout);
  }, [routeIndex, run, route.steps.length]);

  const selectRoute = (index: number, moveFocus = false) => {
    setRouteIndex(index);
    setRun((value) => value + 1);
    if (moveFocus) window.requestAnimationFrame(() => tabRefs.current[index]?.focus());
  };

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % routes.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + routes.length) % routes.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = routes.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectRoute(nextIndex, true);
  };

  const status = activeStep < 0
    ? "Preparing route"
    : complete
      ? "Run complete"
      : "Running " + route.steps[activeStep].label.toLowerCase();

  return (
    <section className={styles.experience} aria-label="Interactive workflow demonstration">
      <span className={styles.texture} aria-hidden="true" />
      <span className={styles.materialLabel} aria-hidden="true">ROUTING SURFACE / 01</span>
      <button className={styles.discover} type="button" onClick={() => tabRefs.current[0]?.focus()}>
        <span>DISCOVER</span>
        <small>Switch the live job</small>
        <ArrowDown aria-hidden="true" size={13} />
      </button>

      <div className={styles.panel}>
        <header className={styles.toolbar}>
          <div><i data-complete={complete ? "true" : undefined} /><span>{complete ? "COMPLETE" : activeStep >= 0 ? "RUNNING" : "READY"}</span></div>
          <strong>ROUTE / 01842</strong>
          <span>{route.target}</span>
        </header>

        <div className={styles.routeIntro}>
          <div>
            <small>ACTIVE JOB / {route.id.toUpperCase()}</small>
            <h2>{route.title}</h2>
          </div>
          <p>{route.summary}</p>
        </div>

        <div id="route-options" className={styles.tabs} role="tablist" aria-label="Example workflow">
          {routes.map((item, index) => (
            <button
              ref={(element) => { tabRefs.current[index] = element; }}
              id={"route-tab-" + item.id}
              type="button"
              role="tab"
              aria-selected={routeIndex === index}
              aria-controls="route-workflow"
              tabIndex={routeIndex === index ? 0 : -1}
              onClick={() => selectRoute(index)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              key={item.id}
            >
              <span>0{index + 1}</span>{item.tab}
            </button>
          ))}
        </div>

        <ol
          id="route-workflow"
          className={styles.nodes}
          role="tabpanel"
          aria-labelledby={"route-tab-" + route.id}
          aria-label={route.title + " steps"}
        >
          {route.steps.map((step, index) => {
            const Icon = step.icon;
            const done = activeStep > index || complete;
            const current = activeStep === index && !complete;
            return (
              <li className={done ? styles.done : current ? styles.current : ""} key={step.type + step.label}>
                <div>
                  <span><Icon aria-hidden="true" size={14} /></span>
                  <b>{done ? <Check aria-hidden="true" size={10} /> : current ? <Play aria-hidden="true" size={8} fill="currentColor" /> : "0" + (index + 1)}</b>
                </div>
                <small>{step.type}</small>
                <strong>{step.label}</strong>
              </li>
            );
          })}
        </ol>

        <footer className={styles.receipt}>
          <div aria-live="polite">
            <span><i /> {status}</span>
            <small>{complete ? route.receipt : "Every step stays available to inspect."}</small>
          </div>
          <button type="button" onClick={() => setRun((value) => value + 1)}>
            <RefreshCw aria-hidden="true" size={12} /> Replay
          </button>
        </footer>
      </div>
    </section>
  );
}
