# Exploring a codebase

Open a folder in Electron, or select a folder in the workspace Explorer. A folder
keeps its own galaxy, analysis and chats, even when it belongs to a multi-folder
workspace. Other layouts are available from the view selector.

## The galaxy

Constellation lays a folder's code out on one plane around the agent's cannon.
Each black hole is a group of files that import each other (or a top-level
folder, under **View options**). Folders form the arms around the cannon, named
at their tips, and each folder's groups share a colour family. Along an arm, the
groups the rest of the code imports sit nearest the cannon; groups that mostly
import others sit toward the tip. A folder that holds most of the groups is split
into its subfolders.

The galaxy keeps its shape as the code changes, and across restarts. A file stays
in its black hole and a system stays where it is; new files join the black hole
they import from most, and a group of new files that import each other forms a new
one beside the rest. Bodies ease into new orbits, new ones grow and removed ones
shrink away. A system that outgrows its space moves straight outward. **View
options → Reorganize galaxy** regroups the files and lays the galaxy out afresh.

## Planets and towns

The overview labels only planets with at least 250 source lines or three incoming
imports, prioritizing frequently imported files. Labels are capped at 20% of the
files (at most 16) and hide where they overlap. Planet rings and neighboring systems
have more breathing room; the larger satellite and terminal moon sit outside the
cannon's island. The translucent icons in the scene's bottom-right corner return
to the full overview or focus the cannon, including from a planet close-up.

In Constellation, select a file and zoom toward its planet. Close detail contains
method regions, towns and a source inspector. Zoom out, press Escape, or use
**Back to the system** to leave the detail.

A planet represents one file. Declaration owners define districts; resolved calls
and selective shared-state relationships organize neighborhoods. Each executable
member retains its own town. District colors identify ownership and grouping.
Region area is a layout budget, not a measure of performance or importance.

Buildings are selected from operation evidence: local calls, external calls,
state writes, persistence, network I/O, events, UI and object construction. Roof
fixtures preserve additional return, assignment, await and throw effects.
Selecting a building explains its source and role.

The [semantic model guide](semantic-planets.md) describes supported patterns,
confidence, compiler context, syntax fallback and Java's separate analysis path.

## Source inspection

- **File map** selects method regions on either hemisphere. **Find town** searches
  methods, districts and recognized patterns.
- **Flow**, **Source** and **Calls** connect statements to source lines, local
  methods and available imported modules. Filters narrow the flow list.
- A building, flow row or source row selects the same source element. Distinct
  expressions on one line remain individually selectable through flow rows and
  buildings; a source-line click selects the smallest matching element.
- **Inspect selection** moves closer. Ordinary source/flow clicks pan at the
  current distance; **Center method** restores the method framing.
- **Dependencies** starts off and shows connections incident to the selected
  method when enabled. Related-write links are labeled text matches, not proven
  data-flow edges.

## Transport and traffic

Constellation ships illustrate static import relationships. Ship density is not
execution frequency. Type-only and re-export lanes carry no ships; unresolved or
unclassified links do not gain invented receiving methods.

Click a landing pad, spaceport or station, or open **Spaceport → Transport**.
**Preview departure** launches a local preview. **Travel to file** opens the
known destination with approach and docking. **Cancel flight**, changing methods,
or leaving the planet cancels pending travel. Direct source navigation remains
available alongside flight actions.

Road cars start automatically when you land and run in nearby camera-facing towns.
Each town's **Pause road traffic / Resume road traffic** action controls only that town;
it does not stop neighboring traffic. A shared pool limits the planet to 96 cars
across up to 24 nearby towns. Branches and loop counts are chosen structurally
because runtime values are unknown. The simulation does not
execute the program, enter arbitrary callees, or establish which path a real run
took. Declared throw/catch/finally structure guides the displayed paths. Empty
methods have no drivable trip.

Large methods prioritize roads in the current view, including independent
callback neighborhoods. Initial cars begin in transit along those roads;
subsequent arrivals enter through the port access or their neighborhood's street head.

Ship hull sizes are bounded against their host planet and landing pad. Detailed
rigs load for active travel and inspected factories; the ambient fleet uses
instanced meshes. [Asset documentation](../viewer/assets/rigged/README.md) covers
models, clips and rebuild commands.

## Chats and activity

Open **Chats** to start or continue a Codex conversation in the selected folder.
[Codex chats](codex-chat.md) describes setup and approvals. **Activity** shows
recorded operations, results and attribution.

Current operations drive the cannon; project history does not replay shots.
Projectiles leave slowly fading trails for about five seconds. Confirmed file changes update the galaxy in
place: the camera, cannon, shots in flight, file heat and creation effects carry on.
A shot at a file that is deleted before it lands hits where the file was. Manual or
ambiguous saves appear as workspace activity without an attributed agent shot.

**View options** contains secondary camera, traffic and preview controls.
**Camera follows agent shots** (off by default) controls the camera separately from activity collection. Manual
navigation temporarily takes precedence. Cannon and creation previews are labeled
local animations; they do not call a provider or write project files.
