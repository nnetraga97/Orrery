# Visual style: light on glass

This is how every window, label, marker and surface in Orrery looks, and how much room
each may take. It applies to every task in both plans that draws something. Where a plan
gives a colour, a size or a layout that differs from this page, this page wins.

The reference sheet is `docs/style/hologram-reference.png`, and the code that drew it is
`docs/style/mock.html`. Its drawing functions (`glowStroke`, `glassPanel`, `windowPanel`,
`microLabel`, `button`, `tabStrip`) are written to be copied into panel drawing code.

![Reference sheet](style/hologram-reference.png)

## The room stays empty

The model on the table is the subject. Everything else is small and leaves when it is
not needed.

- **One standing window: the chat.** It is narrow and sits to the left of the table.
- **Code is not a standing window.** A small code card appears only while a function is
  picked or the agent points at code, and goes away afterwards.
- **No menus in the room.** Navigation is a slim strip on the chat window's edge.
- **No project picker.** The app opens on the demo project.
- **No charts, graphs, timelines or gauges** anywhere.
- **No leader lines.** A card that belongs to something floats beside it.
- At most three windows are ever visible at once: the chat, one code card, one small
  card for the fault or for something the agent is showing.

## Where the look comes from, and where it must stop

The owner's reference is the ship interfaces in the film *Passengers* (2016), made by
the team at MPC London. All 34 frames in the gallery listed under Sources were studied.
What we take is a **design language**: a see-through model floating over a table, fine
lines of cool light on dark glass, red for a fault, small capital labels, and thin white
text on glass. Window behaviour follows the conventions of spatial computers such as
visionOS: a window floats where you put it, is moved by a short bar beneath it, and
carries its navigation as a strip on its edge.

What we do **not** take: any frame, screen layout, logo, icon, wording or asset from the
film or from another product. The competition requires original work and forbids
commercial artwork. Every shape here is drawn by our own code from the tokens below.

## The five rules

1. **Light, not paint.** Lines and shapes glow against darkness. Draw a line twice: a
   wide faint pass, then a thin bright one, with additive blending. No drop shadows, no
   gradients on buttons.
2. **Glass you can read on.** Text always sits on a dark backing that is at least 85%
   opaque. See-through decoration never carries text the user must read.
3. **Cool is information, red is a fault.** Blues and white for everything normal. Red
   only for the bug and for failures. Teal green for success and for approving. Amber
   only for a label that needs attention. More than three warm things in view is too many.
4. **Thin and exact.** Lines are 1 to 2 pixels on a panel canvas. Windows are framed by a
   hairline and four corner brackets.
5. **Small capitals for names, sentences for sentences.** Titles, labels and buttons are
   uppercase with wide spacing. Anything longer than five words is ordinary sentence case.

## Tokens

Put these in `src/core/theme.ts` as constants and use them everywhere. Do not write a
colour or a font anywhere else.

| Token | Value | Used for |
| --- | --- | --- |
| `ink` | `#06101f` at 88% opacity | The backing of every window |
| `grid` | `#1b3b5c` | Faint rules, the table's ring guides, dividers |
| `lineDim` | `#2f6f9f` | Resting outlines, line numbers, orbits, placeholder text |
| `line` | `#7fd4ff` | Active outlines, labels, keywords in code, secondary text |
| `glow` | `#2aa7ff` | The fill of a hovered or pressed control, selection bands |
| `white` | `#eaf6ff` | Body text, identifiers in code |
| `amber` | `#ffb21a` | A label that needs attention |
| `alert` | `#ff4760` | The bug: its card, its line's band and edge, its dot on the model; failures; removed lines |
| `ok` | `#3fe0c5` | Success, the approve button, added lines, literals in code |
| `work` | `#d97757` | The rotating working glyph only |

| Font token | Value | Used for |
| --- | --- | --- |
| `label` | Barlow Condensed 600, uppercase, letter spacing 2 px | Titles, labels, buttons |
| `body` | Barlow 400 | Sentences |
| `mono` | JetBrains Mono 400 | Code |

All three fonts have open licences and install from npm (`@fontsource/barlow-condensed`,
`@fontsource/barlow`, `@fontsource/jetbrains-mono`). Load them with `FontFace` before the
first window is drawn. Sizes scale with the `textScale` setting.

## Windows and how they are anchored

| Thing | Behaviour |
| --- | --- |
| **Window** | A glass panel with a title in small capitals, a close mark at the top right, and a short **grab bar** centred beneath it. Pinch the bar and move your hand to move the window; it keeps facing you. |
| **Attached card** | A small window that belongs to something on the model. It floats just above and beside that thing, follows it as the model turns, and always faces you. **No line joins them.** Pulling it by its grab bar detaches it and leaves it where you put it. |
| **Tab strip** | A slim rounded column of icons attached to the left edge of the chat window, moving with it. The current tab is lit. Four tabs: Home, Chat, Replay, Settings. Each icon's target is at least 4 cm across in the room. |

## Sizes in the room

| Window | Size | When it is visible |
| --- | --- | --- |
| Chat | 0.40 m wide, 0.72 m tall | Always, unless closed from its close mark; the Chat tab or a spoken "open chat" brings it back |
| Code card | 0.46 m wide, 0.34 m tall, about 12 lines | Only while a function is picked, the agent points at code, or a replay is running |
| Fault card and "show me" card | 0.24 m wide, 0.09 m tall | While the fault is unfixed; while the agent's pointer is active |
| Tutorial card | 0.30 m wide, 0.10 m tall | During the tutorial only |

## Components

| Component | How it looks |
| --- | --- |
| **Glass panel** | `ink` backing, hairline frame in `lineDim` at 60%, four glowing corner brackets, title as a micro label |
| **Micro label** | The `label` font in `line` |
| **Button** | Outline in `lineDim` at rest; on hover the outline brightens and the inside fills at 20%; pressed fills to 42%. "Approve once" uses `ok` |
| **Chip** | A rounded outline with sentence-case text, for suggested prompts |
| **Band** | A full-width strip at 16–18% opacity with a 3 px solid edge on the left: selected lines (`glow`), the bug line (`alert`), added (`ok`) and removed (`alert`) lines in a diff |
| **Marker** | A micro label over a small diamond, above the selected file or function. No pointer triangle, no card |
| **Fault dot** | A red dot with a halo on the model at the bug's location |
| **The table** | A bright elliptical rim with faint ring guides inside it; the model floats a hand's width above |

### The chat window

The chat keeps the shape of the desktop chat box, in this theme. From top to bottom:

1. Title bar: "Agent · <chat title>" and the close mark.
2. The transcript, scrolling: user messages as right-aligned outlined bubbles; agent text
   as plain sentences; action groups as one collapsed line with a chevron and their
   summary; action rows with a small icon, verb, target and counts; plan cards, diffs,
   question cards and approval cards inline, each as a small glass panel inside the window.
3. The working line: the rotating `✳` in `work`, a few words, and the elapsed time.
4. Suggested prompts as a row of chips.
5. The composer: one rounded row with placeholder text and the microphone button at its
   right end. Hold the microphone and talk; the heard text replaces the placeholder with
   Send and Cancel.

Approve and Decline are ordinary buttons. Nothing in the chat is larger than a button.

### The code card

Header: file and function in small capitals, and the close mark. Body: about 12 lines
with line numbers, in `mono`, token colours (keywords `line`, identifiers `white`,
literals `ok`, comments `lineDim`), the selected lines banded. Footer: a `More` button
that lengthens the card to about 24 lines, and, only during a replay, three small
buttons `Back`, `Step`, `Play` with the position written as "3 / 7".

It appears beside the planet when a function is picked or the agent points at code. It
closes when the selection is cleared, when another function is picked (it is replaced),
or from its close mark.

## Motion

- **Things draw on.** A window appears by its corner brackets extending, then its frame,
  then its contents, in about 250 ms, and leaves the same way in reverse.
- **Things face you.** Windows and labels turn smoothly toward the head, never snapping.
- **One slow pulse.** The fault dot breathes between 70% and 100% brightness once every
  1.6 s. Nothing else pulses.
- **Reduce motion** (a setting) removes the draw-on, the pulse and the rotating glyph.

## In the room

Additive light looks right against darkness, so the room stays dark: the star field, a
dark floor, and the table's bright rim as the only "lighting". On three.js materials use
additive blending with `depthWrite: false` and `toneMapped: false` for glowing lines, and
keep window textures ordinary so their backing stays dark. Do not add a bloom
post-process: it costs too much on a headset. The two-pass stroke is the glow.

**High contrast** (a setting) turns the backing fully opaque black, text pure white,
drops additive decoration, and thickens outlines to 3 px.

## Sources

Reading about how the film's interfaces were made, for the design language only:

- A gallery of 34 frames of the film's interface work by MPC London, all studied for this page: <https://www.hudsandguis.com/home/2019/passengers>
- An interview with the studio's creative director on the film: <https://www.pushing-pixels.org/2017/06/14/the-art-and-craft-of-screen-graphics-interview-with-ryan-jefferson-hays.html>
- A feature on designing interfaces for films, with MPC London's motion designer: <https://www.techradar.com/news/spaceship-dashboards-and-future-computers-designing-ui-for-film>
- Apple's guidance on ornaments, the edge-attached strips this page's tab strip follows: <https://developer.apple.com/design/human-interface-guidelines/ornaments>
