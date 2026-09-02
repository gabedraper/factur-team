/*
 * Match a PandaDoc document to a client by the account, not the opportunity.
 *
 * The first version trusted Opportunity.Client__c and was wrong in a way that
 * looked right: it resolved 971 of 1,275 documents, every one of them to
 * "Factur Outsourced Prospecting" or "Factur Contract Renewals". Client__c on
 * an Opportunity is not the customer -- it is the Factur service line that
 * generated the deal. The T5 Innovation agreement resolved to Factur's own
 * prospecting record, confidently and silently. A sample check that only asked
 * "did it resolve" rather than "did it resolve to the right client" passed it.
 *
 * The account is the customer. The document usually carries it; where it does
 * not, the opportunity's own AccountId does.
 *
 * An account can hold several client records, because a client that has left
 * and come back has one per run. The signing date picks between them: the run
 * that was live when the contract was signed owns it. Where no run covers the
 * date -- a contract signed before the record existed, which is normal for a
 * kick-off -- the earliest run after it is the right answer, and the most
 * recent is the fallback.
 *
 * Also: client_id on client_agreements was not-null, which would have rejected
 * every document the matcher could not place, and those are precisely the ones
 * somebody needs to see and link.
 *
 * The applied statements are recorded in the migrations
 * resolve_pandadoc_client_by_account and agreements_may_be_unlinked.
 */
alter table public.client_agreements alter column client_id drop not null;
