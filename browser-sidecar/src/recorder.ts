import type { RecordedStep } from "./types.js";

export function isSensitiveField(input: { type?: string; autocomplete?: string; name?: string; label?: string }): boolean {
  const value = `${input.type ?? ""} ${input.autocomplete ?? ""} ${input.name ?? ""} ${input.label ?? ""}`.toLowerCase();
  return input.type === "password" || /(password|passwd|passcode|credit.?card|card.?number|cc-number|cc-csc|cvv|cvc|security.?code)/.test(value);
}

export function deduplicateRecorderEvents(steps: RecordedStep[]): RecordedStep[] {
  const result: RecordedStep[] = [];
  for (const step of steps) {
    const previous = result[result.length - 1];
    const sameInput = previous?.action === "fill_field" && step.action === "fill_field" &&
      JSON.stringify(previous.configuration.locator) === JSON.stringify(step.configuration.locator);
    if (sameInput) result[result.length - 1] = step;
    else if (!(previous?.action === "navigate" && step.action === "navigate" && previous.configuration.url === step.configuration.url)) result.push(step);
  }
  return result;
}
