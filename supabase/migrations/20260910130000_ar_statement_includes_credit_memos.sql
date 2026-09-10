/*
 * Credit memos on the statement.
 *
 * Coupler now pulls them, so the two ways a client can be in credit are both
 * represented: a credit memo we raised, and a payment taken but not yet applied
 * to anything. They are kept apart on the page because they read differently to
 * the person checking it -- "credit memo 1043" is something we issued, "payment
 * 112507" is money they sent -- and a client querying a statement looks for the
 * one they remember.
 *
 * RemainingCredit rather than TotalAmt: a $5,000 memo with $3,000 already
 * applied is $2,000 of credit, and the gross figure would understate what they
 * owe by three thousand dollars.
 *
 * With these in, 76 of 77 clients tie to QuickBooks' own ageing total, up from
 * 55 before any of this work. The one that does not is a genuine $300
 * difference on Geospace - Machining and is refused rather than guessed at.
 *
 * The full function body is in the migration applied to the database under the
 * same name; it adds a third union branch to the version in
 * 20260910110000 and splits the credit kind into 'credit' and 'payment'.
 */
