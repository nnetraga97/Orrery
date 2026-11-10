# Desktop interface direction

The interface uses an opaque dark macOS aesthetic. The chat transcript and composer retain their existing design, per the user's preference. The colorful code world remains the center of attention.

## Apple principles applied

- **Purpose and simplicity:** Keep the world visible. Use quiet, borderless toolbar actions, and retain secondary previews and camera settings in View options.
- **Familiarity:** Use the Mac system font, a folder disclosure for the workspace picker, consistent outline icons, inset sidebar selections, and a clear selected tab. Keep existing keyboard shortcuts and native file dialogs.
- **Agency:** Retain collapsible sidebars, resize handles, keyboard focus, and saved layout preferences. Context panels offer actions near the selected content.
- **Hierarchy:** Use type size, weight, spacing, and opaque surface levels to distinguish navigation, content, and inspectors. Reserve blue for focus, selection, links, and primary actions.
- **Flexibility:** Keep wrapping toolbars and compact layouts; strengthen interface contrast when the system requests it and respect reduced motion. Small planet interface text is at least 10 CSS pixels.
- **Craft and delight:** Apply consistent control radii and spacing. Let the animated world supply the personality; keep the surrounding interface calm.

Planet actions are grouped into navigation, source inspection, and connections/transport. Static-analysis status sits with the breadcrumb rather than competing with actions.

## Implementation

Shared semantic colors and fonts live in `viewer/styles/interface-tokens.css`; component styles use these roles. Surfaces are opaque, with no backdrop blur or Liquid Glass effects. The Monaco editor uses matching solid colors. These are web-rendered controls inspired by macOS, not AppKit controls or a claim of complete HIG compliance. Native SF Symbols assets are not bundled.

## Sources

Reviewed Apple's current guidance on 2026-10-14:

- [Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)
- [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos)
- [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)
- [Typography](https://developer.apple.com/design/human-interface-guidelines/typography)
- [Color](https://developer.apple.com/design/human-interface-guidelines/color)
- [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)

The user's request for opaque materials takes precedence over current Liquid Glass material guidance.

## Large method scenes

The scene starts with code annotations and auxiliary reference panels closed. The fixed breadcrumb is the single method title. Find town, Center method, Method details, and Town port remain directly available; Display holds code-label and dependency toggles, the map, building key, selection inspection, and help. Only one auxiliary reference panel can be open at a time.

Code annotations are optional and capped at six visible labels across callback names, statements, and branch arms. They yield to each other, controls, reference panels, and pinned inspectors. A selected statement retains only a short line/type label; clicking still opens full source evidence. Hover previews are compact, clear when leaving the scene or beginning a drag, and do not repeat the already-selected method. The chat UI is unchanged.

This applies the purpose, simplicity, spatial consistency, and immediate-feedback guidance in [Emil Kowalski's apple-design skill](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md). Its translucent-material examples do not apply to this project's explicit opaque-surface preference.

### Town props and road hierarchy

Branch flags become short, neutral roadside junction markers with larger invisible inspection targets. Loop roads retain their geometry and traffic paths; windmills are removed, and a small ring appears only on the selected loop. Loop junctions remain hoverable and clickable.

Monorail platforms appear only at endpoints of resolved local connections. Their deck is lowered from 2.4 to 0.85 times the shared town scale; route geometry still arrives at the actual platform and preserves clearance away from the station. Road edges and lane markings are narrower and less saturated, with surrounding towns' markings dimmed slightly when a town is selected. The physical road widths and structural traffic paths stay intact.

The towns retain their buildings, trees, port activity, radar, and rigged building motion. This pass changes visual hierarchy without adding decorative animation or changing the AI tool system.
