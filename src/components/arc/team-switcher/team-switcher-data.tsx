// Arc Pro (uiarc.dev): adapted from the Team switcher component; licensed source, not covered by this repository's licence. See src/components/arc/PRO.md.
import type { ReactNode } from "react";

export interface Workspace {
  id: string;
  name: string;
  /** Plan name shown under the name, such as "Enterprise". Trak: the squad's size, such as "26 players". */
  plan?: string;
  /** Member count, shown as "214 members". */
  members?: number;
  /** Your role in this workspace, such as "Owner" or "Guest". */
  role?: string;
  /** The mark drawn inside the tile. Size it in em: the tile sets font-size to its own size. Falls back to the first letter. */
  logo?: ReactNode;
  /** Tile background and mark color. Defaults to the foreground color with a background-colored letter. */
  tile?: { background: string; color?: string };
}

/** Trak: no sample workspaces or brand marks; the app always passes its own list. */
export const sampleWorkspaces: Workspace[] = [];
export const sampleInvites: { link: string; workspace: Workspace }[] = [];
