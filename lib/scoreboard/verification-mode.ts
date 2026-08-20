// Whether a board hides other reps' names and detail from ordinary viewers.
// Managers always see everything regardless.
//
// Hustle points and deals are open: the team compares effort and wins in the
// open. Retention stays masked -- a rep seeing who lost which client is a
// different thing from seeing who made the most calls.
export const BOARD_MASKING = {
  hustlePoints: false,
  deals: false,
  retention: true,
} as const;

export type MaskedBoard = keyof typeof BOARD_MASKING;
