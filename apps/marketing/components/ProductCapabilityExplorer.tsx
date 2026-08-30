"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, Check, GitBranch, MousePointer2, ScanLine } from "lucide-react";
import styles from "./ProductCapabilityExplorer.module.css";

type ExplorerItem = { title: string; body: string };
type ExplorerDetail = { label: string; value: string };

export function ProductCapabilityExplorer({
  product,
  items,
  details,
  proof,
}: {
  product: string;
  items: ExplorerItem[];
  details: ExplorerDetail[];
  proof: string;
}) {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedItem = items[selected];
  const selectedDetail = details[selected % details.length];
  const resultDetail = details[(selected + 1) % details.length];
  const icons = [MousePointer2, GitBranch, ScanLine] as const;

  const selectTab = (index: number) => {
    const next = (index + items.length) % items.length;
    setSelected(next);
    tabs.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      selectTab(index + 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      selectTab(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectTab(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectTab(items.length - 1);
    }
  };

  return (
    <div className={styles.explorer} data-product={product}>
      <div className={styles.tabs} role="tablist" aria-label="Product capabilities" aria-orientation="vertical">
        <header><span>CAPABILITY INDEX</span><small>SELECT TO INSPECT</small></header>
        {items.map((item, index) => {
          const Icon = icons[index];
          return (
            <button
              ref={(element) => { tabs.current[index] = element; }}
              id={`capability-tab-${product}-${index}`}
              type="button"
              role="tab"
              aria-selected={selected === index}
              aria-controls={`capability-panel-${product}`}
              tabIndex={selected === index ? 0 : -1}
              onClick={() => setSelected(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              key={item.title}
            >
              <span>0{index + 1}</span>
              <Icon aria-hidden="true" size={15} />
              <strong>{item.title}</strong>
              <ArrowRight aria-hidden="true" size={13} />
            </button>
          );
        })}
      </div>

      <section
        id={`capability-panel-${product}`}
        className={styles.panel}
        role="tabpanel"
        aria-labelledby={`capability-tab-${product}-${selected}`}
        tabIndex={0}
      >
        <header>
          <span>INSPECTION / 0{selected + 1}</span>
          <small><i /> ROUTE VALID</small>
        </header>
        <div className={styles.panelCopy}>
          <p>{selectedItem.body}</p>
          <span>ACTIVE DECISION</span>
        </div>
        <ol className={styles.route} aria-label={`${selectedItem.title} route`}>
          <li>
            <span>01</span><small>INPUT</small><strong>{selectedDetail.label}</strong><code>{selectedDetail.value}</code>
          </li>
          <li aria-hidden="true"><i /></li>
          <li data-active="true">
            <span>02</span><small>CAPABILITY</small><strong>{selectedItem.title}</strong><code>explicit_configuration</code>
          </li>
          <li aria-hidden="true"><i /></li>
          <li>
            <span>03</span><small>EVIDENCE</small><strong>{resultDetail.label}</strong><code>{resultDetail.value}</code>
          </li>
        </ol>
        <footer aria-live="polite">
          <span><Check aria-hidden="true" size={12} /> INSPECTION COMPLETE</span>
          <small>{selected + 1} / {items.length}</small>
        </footer>
      </section>

      <aside className={styles.proof}>
        <span>PRODUCT PROOF</span>
        <p>{proof}</p>
        <small>Grounded in the implemented product boundary.</small>
      </aside>
    </div>
  );
}
