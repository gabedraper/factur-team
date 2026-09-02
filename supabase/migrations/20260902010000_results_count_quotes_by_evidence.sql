/*
 * Two corrections to how results are counted. No schema change -- this records
 * the rules, because they live in the loader and nowhere else.
 *
 * 1. A QUOTE IS A QUOTE WHEREVER THE RECORD ENDED UP.
 *
 * Quotes were counted from the stage alone, which missed 3,904 opportunities
 * carrying a real quote amount: 1,839 at Closed Lost, 1,417 at Pipeline: LT
 * Follow Up, and the rest scattered across Warm, Hot, DQ and Lead Generated.
 * Work that was quoted and then lost is still work that was quoted. An
 * appointment is not a prerequisite either -- quotes happen without one.
 *
 * Total_Quote_Amount__c > 0 is now evidence of a quote in its own right, and
 * PO_Amount__c / PO_Date__c evidence of a PO, whatever stage the record rests
 * at. Note the > 0: 2,526 opportunities carry a quote amount of exactly zero,
 * which is a touched field, not a quote.
 *
 * 2,021 of those opportunities sat in stages the loader did not treat as
 * delivered at all, so they were not even counted as leads. They are now: you
 * cannot quote work that was never worked.
 *
 * 2. CLIENT_SINCE__C IS NOT RELIABLE, SO NOTHING IS DROPPED FOR MISSING IT.
 *
 * The old loader discarded 852 opportunities dated before the client's recorded
 * start and 610 belonging to clients with no start date. Month 1 is now the
 * earlier of the recorded start and the client's first actual result, and a
 * client with no recorded date is placed by their results alone. 29 clients now
 * start earlier than their recorded date; 20 more are included that had none.
 *
 * Effect, against the previous load:
 *   leads   71,699 -> 75,182
 *   appts    2,391 ->  2,540
 *   quotes   8,127 -> 12,454
 *   POs      4,530 ->  5,044
 *   clients    839 ->    860
 *
 * QUOTE VALUE. Total_Quote_Amount__c totals $2.3bn, of which $1.95bn sits in
 * 169 opportunities above $1m -- the largest a single $723,900,000 row. Those
 * were queried and confirmed as real by Gabe on 2026-09-02, so the figure is
 * reported in full and nothing is filtered. It is the value quoted, not the
 * value won: quotes later lost or still on follow-up are included, which is
 * why it is an order of magnitude above PO value.
 *
 * PO value is unaffected and remains a floor, since Salesforce leaves the
 * amount blank on most POs.
 *
 * Rebuilt by scripts/rebuild-client-results.py.
 */
select 1;
