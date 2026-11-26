import { hostOf } from "./labels";
import type { JobEvent, ProgressEvent } from "./types";

export interface Step {
  icon: string;
  text: string;
}

function stepFor(event: ProgressEvent): Step | null {
  switch (event.type) {
    case "status":
      return { icon: "•", text: event.message };
    case "thinking":
      return { icon: "…", text: "Reading the material" };
    case "search":
      return { icon: "\u{1F50E}", text: `Searched: “${event.query}”` };
    case "fetch":
      return { icon: "\u{1F4C4}", text: `Reading ${hostOf(event.url)}` };
    case "zoom":
      return { icon: "\u{1F50D}", text: `Zoomed into ${event.image}: ${event.reason}` };
    case "lookup":
      return { icon: "\u{1F4DA}", text: `Checked earlier findings: “${event.query}”` };
    case "writing":
      return { icon: "✍", text: "Writing the report" };
    case "fallback":
      return { icon: "↻", text: `Continued on ${event.to}` };
    default:
      return null;
  }
}

/** The visible steps of a running check, oldest first, without back-to-back repeats. */
export function stepsFrom(events: JobEvent[]): Step[] {
  const steps: Step[] = [];
  for (const e of events) {
    if (e.type !== "progress") continue;
    const s = stepFor(e.event);
    if (!s) continue;
    const last = steps[steps.length - 1];
    if (last && last.text === s.text) continue;
    steps.push(s);
  }
  return steps;
}
