// The views: the circuit board (the default), the 3D constellation and the flat country map.
import { board } from '../board/board.js';
import { constellation } from '../galaxy/constellation.js';
import { country } from '../country/country.js';

export const INFO = {
  board: [
    'Circuit board',
    "The codebase as a printed circuit board. Each group of files is a module outlined in silkscreen; each file is a part inside it, sized by its lines of code, with type and constant files as small passives. A file's exports are one copper net running to every file that imports it, and imports between groups travel as buses between the modules' gold edge connectors. Select a part to light its imports in gold and its importers in blue, all the way across the board. Dashed lines are imports no bus carries. When the agent reads or edits a file, a signal runs from its connector on the left edge to that part, which glows while the change is fresh. Zoom into a part (or press F) and its package opens onto its die, the file's town: each function is a block, each statement a cell coloured by what it does, ifs and loops nest their bodies, and calls run as metal between blocks or out through the pads bonded to the part's pins. Up close every cell shows its code; double-click a block or cell to open it in the editor.",
  ],
  constellation: [
    'Constellation',
    "Each group is a black hole; its files orbit it. The agent's cannon sits at the centre, and folders form the arms around it, one colour family each. Along an arm, the groups the rest of the code imports sit nearest the cannon. Hubs are planets on close orbits, small files are asteroids, and files that mostly reach into other groups are comets on long ellipses. Ships fly the imports. Scroll toward any body to zoom in: its method regions, then its towns, appear as you get closer.",
  ],
  graph: [
    'Country map',
    'One codebase on flat ground. Folders are districts and files are lots sized by lines of code. Roads run only where imports do: trunks between top-level folders, collectors between subfolders and access roads to each file. Select a file to see its imports grouped by destination, or zoom in to explore its method towns.',
  ],
};

// ---------- shell ----------
export const VIEWS = { board, constellation, graph: country };
