import { describe, expect, it } from "vitest";
import { legalPages, productPages, transactionalEmails, useCases } from "./index";

describe("v0.6 public content", () => {
  it("uses unique public routes", () => {
    const routes = [
      ...productPages.map((value) => `product/${value.slug}`),
      ...useCases.map((value) => `solutions/${value.slug}`),
      ...legalPages.map((value) => `legal/${value}`),
    ];
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("avoids prohibited vague positioning", () => {
    const copy = JSON.stringify({ productPages, useCases }).toLowerCase();
    for (const phrase of [
      "reimagine your productivity",
      "unlock limitless possibilities",
      "revolutionise your workflow",
      "future of automation is here",
      "supercharge your business with ai",
      "work smarter, not harder",
    ]) expect(copy).not.toContain(phrase);
  });

  it("includes plain-text and html transactional variants", () => {
    expect(transactionalEmails).toHaveLength(13);
    for (const template of transactionalEmails) {
      expect(template.html({})).toContain("<!doctype html>");
      expect(template.text({})).toContain("SANDBOX");
    }
  });
});
