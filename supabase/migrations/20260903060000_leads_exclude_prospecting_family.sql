/*
 * Leads exclude the Prospecting: family. Long-term follow up stays.
 *
 * Gabe's sanity check: "we're averaging about 300-400 per week", against a
 * total that had just become 443,000. The arithmetic found it. Counting every
 * stage put 2022 at 2,234 leads a week and 2026 at 662, a five-fold swing on
 * roughly the same number of clients -- the signature of a stage used as a
 * dumping ground rather than of the business changing that much.
 *
 * Two candidates. Prospecting: Referred, Cold Referral and Warm Referral
 * carried 42,285 in 2022 against 3,169 in 2026 -- sourcing stages, the same
 * family as Prospecting: Cold Call List which was already excluded. Keeping
 * three siblings while dropping two was an inconsistency of mine.
 *
 * Pipeline: LT Follow Up is the other, and it stays: it is what Factur reports
 * to clients, so it is a lead by the definition that matters.
 *
 * Result, leads per week:
 *
 *            all stages   without Prospecting:
 *   2022          2,234                  1,421
 *   2023          1,940                  1,560
 *   2025            651                    549
 *   2026            662                    571
 *
 * Client Results total: 443,271 -> 327,750. Applied by rebuilding the base from
 * the delivered-stage pulls and re-applying a net delta, rather than
 * subtracting in place -- adding leads had changed which service was busiest in
 * a month, so an in-place subtraction would not have landed on the same rows it
 * came from. Appointments, quotes and POs are untouched throughout.
 *
 * Client Health, the daily refresh and the leads drill-down all take the same
 * rule, so the three agree.
 */
select 1;
