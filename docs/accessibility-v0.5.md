# v0.5.0 accessibility review

The v0.5 desktop interface was reviewed against the applicable WCAG 2.2 Level A and AA success criteria on 2026-08-28. The review covered the workflow dashboard, graph editor, node inspector, command palette, run history, marketplace, installed plugins, settings, connection management, browser recorder, permission review and approval request surfaces. Time-based media, audio, authentication puzzles and web reflow below the desktop application's supported 1280×720 minimum viewport are not present.

## Graph editing without dragging

Choose **Accessible editor** in the workflow toolbar. Focus moves directly to the named **Accessible graph editor** region. Its native buttons and labelled selects provide the same graph mutations as pointer gestures:

- add and inspect nodes;
- move each node up, left, right or down in 20-pixel increments;
- connect any valid source and target, including explicit true/false condition branches; and
- review and remove every existing connection.

The visual canvas remains available. Canvas nodes expose their name, type and coordinates in the accessibility tree, while successful companion-editor mutations are announced through a polite live status region. Trigger nodes are omitted from connection targets and duplicate/self connections are rejected consistently with pointer editing.

## Review results

| WCAG area | Result and evidence |
| --- | --- |
| 1.1.1 text alternatives | Pass. Icon-only actions have contextual accessible names; decorative icons do not carry workflow meaning alone. |
| 1.3.1–1.3.5 structure and relationships | Pass. Main regions, headings, ordered node lists, labelled controls, tables and form fields expose native semantics and names. |
| 1.4.1 use of colour | Pass. Enabled, run and validation states include text or accessible names in addition to colour. |
| 1.4.3 contrast | Pass. Primary text is 17.64:1 and muted text is 6.27:1 against the darkest application background. |
| 1.4.11 non-text contrast | Pass. Focus uses `#9b8df8` at 7.16:1 against the darkest background; controls also retain boundaries and state styling. |
| 2.1.1–2.1.2 keyboard and no trap | Pass. Native controls, menus and dialogs are keyboard operable; the companion editor replaces drag-only graph mutations. |
| 2.4.3 focus order | Pass. Opening the companion editor focuses its region; Tab proceeds to Add node, node selection, and directional controls in reading order. |
| 2.4.7 and 2.4.11 focus visible/not obscured | Pass. A two-pixel application-wide focus indicator is restored for controls and canvas nodes; the companion panel scrolls focused controls into its own viewport. |
| 2.5.1 pointer gestures | Pass. Dragging and double-clicking have single-pointer or keyboard/native-control equivalents. |
| 2.5.3 label in name | Pass. Visible action labels are preserved in accessible names. |
| 2.5.7 dragging movements | Pass. Node movement and edge creation/removal have non-dragging controls. |
| 3.2 predictable operation | Pass. Selection does not mutate the graph; destructive connection removal is explicitly labelled. |
| 3.3.1–3.3.2 errors and labels | Pass. Inputs have programmatic labels and invalid graph targets are prevented rather than silently accepted. |
| 4.1.2 name, role, value | Pass. Browser accessibility-tree inspection found named graph groups, controls, selects, status and complementary regions. |
| 4.1.3 status messages | Pass. Position and connection changes are announced without moving focus. |

## Verification record

- `npm.cmd test`: component tests prove directional movement, labelled controls, condition-branch connection creation and trigger-target exclusion.
- `npm.cmd run build`: TypeScript and production bundling pass.
- T3 collaborative Chromium at 1280×800: semantic snapshot confirmed named canvas groups and companion controls with no console errors. Keyboard traversal from the focused companion region reached **Add node**, the first node, then **Move Every 30 minutes up/left/right/down** in document order.
- Static contrast calculation used the WCAG relative-luminance formula for the shipped colour tokens.

Accessibility regressions in graph operations are release blockers. New pointer gestures must include a native keyboard/screen-reader operation and a semantic component test.
