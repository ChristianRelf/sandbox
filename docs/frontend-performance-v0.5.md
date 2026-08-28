# v0.5.0 desktop startup bundle review

The production desktop frontend was measured with `npm.cmd run build` on 2026-08-28. The baseline eagerly imported every navigation view and React Flow before showing the workflow dashboard. The revised application keeps the default dashboard synchronous and loads history, settings, approvals, plugins, marketplace, approval prompts and the workflow editor at their interaction boundaries.

## Production output

| Startup asset | Eager baseline | Split build | Change |
| --- | ---: | ---: | ---: |
| Initial JavaScript | 640.82 kB / 199.35 kB gzip | 343.90 kB / 110.60 kB gzip | 46.3% raw and 44.5% gzip reduction |
| Initial CSS | 66.20 kB / 11.88 kB gzip | 48.05 kB / 9.21 kB gzip | 27.4% raw and 22.5% gzip reduction |

The largest deferred route is the workflow editor at 238.91 kB JavaScript (74.72 kB gzip) plus 15.87 kB React Flow CSS (2.67 kB gzip). Remaining deferred views range from 1.42 kB to 24.10 kB JavaScript. No generated JavaScript chunk exceeds Vite's 500 kB warning threshold.

These are artifact sizes, not claims about universal wall-clock startup time. Desktop startup also depends on disk, WebView2 initialization and Tauri/backend initialization. The meaningful result is that dashboard startup no longer parses or evaluates the graph editor and its React Flow dependency.

## Runtime verification

T3 collaborative Chromium at 1280×800 loaded the workflow dashboard with no request containing `WorkflowEditor` or `xyflow`. Opening **Website Change Monitor** then fetched `WorkflowEditor.tsx`, the React Flow module and stylesheet, and `AccessibleWorkflowEditor.tsx`; the editor rendered with the expected workflow name and no console error.

The route fallback is a named polite status message. This prevents a blank main region on slow storage while preserving the accessibility work in GA-018.

## Regression budget

The Vite production build now fails when:

- the initial JavaScript entry exceeds 400,000 bytes; or
- any deferred JavaScript chunk exceeds 300,000 bytes.

`src/code_splitting.test.ts` locks the navigation boundaries, keeps React Flow CSS out of the initial entry and requires those production budgets. Raise a budget only with a new measured artifact comparison and an explanation in this document.
