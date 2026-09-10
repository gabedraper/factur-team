/*
 * Campaigns, and the pursuits that came out of them.
 *
 * Campaigns here are trade shows and events -- 2026 IMTS, Foam Expo, the NTMA
 * golf outing -- and an opportunity carrying a CampaignId is one that traces
 * back to a stand or a dinner. 359 campaigns exist, 165 have opportunities
 * against them, and 12,742 opportunities point at one. Knowing which show
 * produced which pipeline is the question this answers, and nothing in the app
 * could answer it before.
 *
 * Opportunity notes needed no work: Opportunity_Notes__c has been transformed
 * into opportunities.notes since the bulk load, and 22,375 pursuits carry one.
 * The separate classic Note object is not worth a pipeline -- of the 2,935
 * notes hanging off opportunities created in the last two years, 2,818 are
 * PandaDoc audit trail ("Document X was viewed", "was signed by") and 117 are
 * written by a person. Importing it would bury the hundred and seventeen.
 *
 * The mirror is every Campaign field as text, the same shape the bulk load left
 * the other mirrors in, so the sync route can fill it without knowing anything
 * about campaigns. Unlike the mirrors Skyvia built, this one is created with RLS
 * on and no grant to anon -- those arrived exposed and had to be sealed after
 * the fact.
 */

create table if not exists public."sky_Campaign" (
  "Id" text primary key,
  "IsDeleted" text,
  "Name" text,
  "ParentId" text,
  "Type" text,
  "Status" text,
  "StartDate" text,
  "EndDate" text,
  "ExpectedRevenue" text,
  "BudgetedCost" text,
  "ActualCost" text,
  "ExpectedResponse" text,
  "NumberSent" text,
  "IsActive" text,
  "Description" text,
  "NumberOfLeads" text,
  "NumberOfConvertedLeads" text,
  "NumberOfContacts" text,
  "NumberOfResponses" text,
  "NumberOfOpportunities" text,
  "NumberOfWonOpportunities" text,
  "AmountAllOpportunities" text,
  "AmountWonOpportunities" text,
  "HierarchyNumberOfLeads" text,
  "HierarchyNumberOfConvertedLeads" text,
  "HierarchyNumberOfContacts" text,
  "HierarchyNumberOfResponses" text,
  "HierarchyNumberOfOpportunities" text,
  "HierarchyNumberOfWonOpportunities" text,
  "HierarchyAmountAllOpportunities" text,
  "HierarchyAmountWonOpportunities" text,
  "HierarchyNumberSent" text,
  "HierarchyExpectedRevenue" text,
  "HierarchyBudgetedCost" text,
  "HierarchyActualCost" text,
  "OwnerId" text,
  "CreatedDate" text,
  "CreatedById" text,
  "LastModifiedDate" text,
  "LastModifiedById" text,
  "SystemModstamp" text,
  "LastActivityDate" text,
  "LastViewedDate" text,
  "LastReferencedDate" text,
  "CampaignMemberRecordTypeId" text,
  "Location__c" text,
  "Client__c" text,
  "Targeted_Industries__c" text,
  "Targeted_Personas__c" text,
  "pi__Pardot_Campaign_Id__c" text,
  "pi__Pardot_Has_Dependencies__c" text,
  "Salesforce_Exporter_Updated_At__c" text,
  "Mongo_Id__c" text
);

alter table public."sky_Campaign" enable row level security;
revoke all on table public."sky_Campaign" from public, anon;
