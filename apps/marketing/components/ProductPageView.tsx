import type { ProductPage } from "@sandbox/content";
import { ProductExperience } from "./ProductExperiences";

export function ProductPageView({ page }: { page: ProductPage }) {
  return <ProductExperience page={page} />;
}
