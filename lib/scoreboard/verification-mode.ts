// Whether a board hides other reps' names and detail from ordinary viewers.
// Managers always see everything regardless.
//
// All three boards are open: the team compares effort, wins and retention in
// the open. Retention was held back at first -- seeing who lost which client is
// a heavier thing than seeing who made the most calls -- and was opened
// deliberately afterwards.
export const BOARD_MASKING = {
  hustlePoints: false,
  deals: false,
  retention: false,
} as const;

export type MaskedBoard = keyof typeof BOARD_MASKING;
