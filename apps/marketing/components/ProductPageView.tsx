import type { ProductPage } from "@sandbox/content";
import { ProductHero } from "./ProductHeroes";
import { ProductPageBody } from "./ProductPageBodies";
import styles from "./ProductPageView.module.css";

const productOrder = [
  "visual-workflow-builder",
  "local-automation",
  "browser-automation",
  "always-on-execution",
  "plugins-marketplace",
  "teams-governance",
  "developers",
] as const;

const productChapters: Record<(typeof productOrder)[number], string> = {
  "visual-workflow-builder": "Logic you can inspect",
  "local-automation": "The machine stays in charge",
  "browser-automation": "Recorded, then editable",
  "always-on-execution": "Durable by deliberate choice",
  "plugins-marketplace": "Extension without ambient trust",
  "teams-governance": "Shared work, separated authority",
  developers: "Typed where it matters",
};

export function ProductPageView({ page }: { page: ProductPage }) {
  const productIndex = Math.max(productOrder.indexOf(page.slug as (typeof productOrder)[number]), 0);
  const chapter = productChapters[page.slug as (typeof productOrder)[number]] ?? productChapters["visual-workflow-builder"];

  return (
    <main id="content" className={`${styles.page} detail-page`} data-product={page.slug}>
      <ProductHero page={page} index={productIndex} chapter={chapter} />
      <ProductPageBody page={page} index={productIndex} />
    </main>
  );
}
