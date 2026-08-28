"use client";

import { Fragment, useEffect, useState } from "react";
import {
  Check,
  Clock3,
  Download,
  FileCheck2,
  Globe2,
  Play,
  RefreshCw,
  Send,
} from "lucide-react";
import styles from "./WorkflowDemo.module.css";

const steps = [
  { eyebrow: "Trigger", label: "08:00", detail: "Weekdays", icon: Clock3 },
  { eyebrow: "Browser", label: "Open portal", detail: "Signed-in profile", icon: Globe2 },
  { eyebrow: "File", label: "Report.csv", detail: "Approved folder", icon: Download },
  { eyebrow: "Check", label: "12 rows", detail: "No empty report", icon: FileCheck2 },
  { eyebrow: "Notify", label: "Tell the team", detail: "Desktop message", icon: Send },
];

const eventCopy = [
  "Waiting for the weekday trigger",
  "Opened the reporting portal",
  "Downloaded report.csv",
  "Validated 12 rows",
  "Sent a desktop notification",
  "Run complete - 4.8 seconds",
];

export function WorkflowDemo() {
  const [run, setRun] = useState(0);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setActive(steps.length);
      return;
    }

    setActive(-1);
    const timers = steps.map((_, index) =>
      window.setTimeout(() => setActive(index), 650 + index * 850),
    );
    timers.push(
      window.setTimeout(() => setActive(steps.length), 650 + steps.length * 850),
    );

    return () => timers.forEach(window.clearTimeout);
  }, [run]);

  const completed = active >= steps.length;
  const statusText = active < 0
    ? eventCopy[0]
    : eventCopy[completed ? eventCopy.length - 1 : active];

  return (
    <figure className={`${styles.stage} ${completed ? styles.complete : ""}`}>
      <figcaption className={styles.toolbar}>
        <div className={styles.windowControls} aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <span className={styles.fileName}>Morning report.sb</span>
        <div className={styles.toolbarActions}>
          <span className={styles.runnerStatus}><i /> This computer</span>
          <button onClick={() => setRun((value) => value + 1)} aria-label="Replay the example workflow">
            <RefreshCw size={13} />
            Replay
          </button>
        </div>
      </figcaption>

      <div className={styles.canvas}>
        <div className={styles.grid} aria-hidden="true" />
        <div className={styles.boundaryLabel}><span /> LOCAL MACHINE BOUNDARY</div>
        <div className={styles.canvasHeading}>
          <div>
            <span>LIVE WORKFLOW</span>
            <strong>Collect the morning report</strong>
          </div>
          <p className={completed ? styles.success : ""}>
            <i /> {completed ? "Completed" : active >= 0 ? "Running" : "Ready"}
          </p>
        </div>

        <ol className={styles.graph} aria-label="Workflow steps">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const done = active > index;
            const current = active === index;
            return (
              <Fragment key={step.label}>
                {index > 0 && (
                  <li className={`${styles.connector} ${active >= index ? styles.connectorOn : ""}`} aria-hidden="true">
                    <span />
                  </li>
                )}
                <li className={`${styles.node} ${done ? styles.done : current ? styles.active : ""}`}>
                  <div className={styles.nodeTop}>
                    <span className={styles.nodeIcon}><Icon size={15} /></span>
                    <span className={styles.nodeState}>
                      {done ? <Check size={11} /> : current ? <Play size={9} fill="currentColor" /> : index + 1}
                    </span>
                  </div>
                  <small>{step.eyebrow}</small>
                  <strong>{step.label}</strong>
                  <p>{step.detail}</p>
                </li>
              </Fragment>
            );
          })}
        </ol>

        <div className={styles.telemetry}>
          <div className={styles.eventLog} aria-live="polite">
            <span><i /> EVENT LOG</span>
            <div>
              <strong>{statusText}</strong>
              <small>{completed ? "Every input and output is available to inspect." : "No external action is performed in this demonstration."}</small>
            </div>
          </div>
          <div className={styles.boundaryCard}>
            <span>RUNS HERE</span>
            <strong>This computer</strong>
            <small>Files stay inside the approved folder</small>
          </div>
        </div>

        <div className={`${styles.fileReceipt} ${active >= 2 ? styles.fileReceiptVisible : ""}`} aria-hidden="true">
          <span><Download size={12} /></span>
          <div><strong>report.csv</strong><small>42 KB - local</small></div>
          <Check size={12} />
        </div>
      </div>
    </figure>
  );
}
