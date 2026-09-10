/*
 * Breno's nine rungs, in her wording.
 *
 * Seeded inactive on purpose. Three of these overlap something that already
 * runs -- QuickBooks sends most invoices seven days early, and a Zapier flow
 * sits somewhere in that path -- so switching them all on before anybody has
 * looked would double-send to real customers. Finance turns each rung on when
 * they are satisfied it is not duplicating what QuickBooks already does.
 *
 * Two deliberate departures from the sheet, both flagged to Gabe:
 *
 *   - The interest sentence is wrapped in {{#rate}}. No rate set for a client
 *     means no claim about interest, which keeps the Day 7 email honest while
 *     "does interest start at 7 or at 30" is still open.
 *   - The Day 31 subject in the sheet still says services "will be paused on
 *     that date" while its body says "with immediate effect". By Day 31 the
 *     pause has happened, so the subject says so.
 *
 * "Covering [service period]" is dropped from the first email: we do not carry
 * a service period per invoice, and inventing one is worse than omitting it.
 */

insert into public.ar_steps
  (position, code, name, offset_days, cc_roles, skip_when_autopay, active,
   subject, body, internal_to, internal_subject, internal_body)
values
  (1, 'invoice_raised', 'Invoice raised', -7, '{}', false, false,
   '{{client}} — Invoice {{invoice_no}} from Factur, due {{due_date}}',
E'Good day {{contact}},\n\nPlease find attached Invoice {{invoice_no}} for {{amount}}. It falls due on {{due_date}}.\n\n{{#autopay}}Your account is set up on autopay, so no action is needed — the payment will be collected automatically on {{due_date}}.{{/autopay}}{{^autopay}}You can settle securely here: {{pay_link}}{{/autopay}}\n\nIf anything on the invoice needs changing — a PO reference, a different billing contact, or a query on the amount — please reply today so we can correct it before the due date.\n\nKind regards,\n{{sender}}\nAccounts Receivable | Factur',
   null, null, null),

  (2, 'pre_due', 'Courtesy pre-due reminder', -3, '{}', true, false,
   '{{client}} — Invoice {{invoice_no}} falls due on {{due_date}}',
E'Good day {{contact}},\n\nA friendly reminder that Invoice {{invoice_no}} for {{amount}} falls due on {{due_date}}. No action is needed if payment is already scheduled.\n\nIf it is easier, you can settle it now here: {{pay_link}}\n\nIf you need anything from us to release it for payment — a PO reference, a copy of the invoice, or a different billing contact — just reply and we will sort it today.\n\nKind regards,\n{{sender}}\nAccounts Receivable | Factur',
   null, null, null),

  (3, 'due_today', 'Due today', 0, '{}', false, false,
   '{{client}} — Invoice {{invoice_no}} is due today, {{amount}}',
E'Good day {{contact}},\n\nInvoice {{invoice_no}} for {{amount}} is due today, {{due_date}}. Our records show it is not yet settled.\n\nYou can pay securely here: {{pay_link}}\n\nIf payment is already on its way, please send the remittance advice so we can match it and stop any further reminders. If you pay by check, please let us know it has been posted so we can watch the lock box for it.\n\nKind regards,\n{{sender}}\nAccounts Receivable | Factur',
   null, null, null),

  (4, 'overdue_7', 'Overdue notice', 7, '{am}', false, false,
   '{{client}} — OVERDUE: Invoice {{invoice_no}}, {{amount}}, {{days}} days past due',
E'Good day {{contact}},\n\nInvoice {{invoice_no}} for {{amount}}, due on {{due_date}}, is now {{days}} days past due and remains unpaid.\n\n{{#rate}}As per our agreement, interest of {{rate}} is now accruing on the outstanding balance and will continue until the invoice is settled in full.\n\n{{/rate}}Please settle here: {{pay_link}}\n\nIf payment is already on its way, send the remittance and we will reconcile it straight away. If there is a query holding this up, reply today and we will resolve it.\n\nKind regards,\n{{sender}}\nAccounts Receivable | Factur',
   null, null, null),

  (5, 'overdue_15', 'Action needed — pause warned', 15, '{am,tl}', false, false,
   '{{client}} — Action needed: services pause on {{pause_date}} if Invoice {{invoice_no}} stays unpaid',
E'Good day {{contact}},\n\nInvoice {{invoice_no}} for {{amount}}, due {{due_date}}, is now {{days}} days past due. The total outstanding on your account is {{account_total}}.\n\nAs a courtesy before any interruption: if payment is not received by {{pause_date}}, services on your account will be paused in line with our contract terms.{{#rate}} Interest of {{rate}} continues to accrue.{{/rate}}\n\nYou can settle securely here: {{pay_link}}\n\nIf payment is already on its way, please send the remittance so we can reconcile it.\n\n{{account_manager}} will be in touch to arrange a short call within the next five days so we can understand what is holding this up and resolve anything outstanding.\n\nWe would much rather keep your account active. A payment, or a firm date by {{pause_date}}, will do that.\n\nKind regards,\n{{sender}}\nAccounts Receivable | Factur',
   '{am}',
   'ACTION — set a call with {{client}} within 5 days, {{account_total}} overdue',
E'{{client}} is {{days}} days past due on {{account_total}} and will auto-pause on {{pause_date}}.\n\nPlease set a relationship call within 5 days and log the outcome. The objective is to find out what is actually blocking payment — approval, cash, or a query — and to get a specific payment date.\n\nYou cannot stop the pause; only a payment or a Finance-approved plan can.'),

  (6, 'final_25', 'Final notice', 25, '{am,tl}', false, false,
   '{{client}} — FINAL NOTICE: services pause on {{pause_date}}, Invoice {{invoice_no}} unpaid',
E'Good day {{contact}},\n\nThis is a final notice regarding Invoice {{invoice_no}} for {{amount}}, now {{days}} days past due. The total outstanding on your account is {{account_total}}. Despite our earlier reminders it remains unpaid.\n\nUnless payment is received by {{pause_date}}, services on your account will be paused on that date in line with our agreement{{#rate}}, and the balance continues to accrue interest at {{rate}}{{/rate}}.\n\nAttached is your full statement of account. Please settle in full here: {{pay_link}}\n\nIf you need a short payment arrangement, reply today. Any arrangement must be agreed and signed before {{pause_date}} to prevent the pause.\n\nPlease treat this as urgent.\n\nKind regards,\n{{sender}}\nDirector of Finance | Factur',
   null, null, null),

  (7, 'pause_31', 'Services paused', 31, '{am,tl}', false, false,
   '{{client}} — services paused today, Invoice {{invoice_no}} unpaid',
E'Good day {{contact}},\n\nInvoice {{invoice_no}} for {{amount}} is now {{days}} days past due and the total outstanding on your account is {{account_total}}. Despite our earlier notices it remains unpaid.\n\nWith immediate effect, services on your account are paused in line with our agreement and no new work will be commenced until the balance is settled.{{#rate}} The balance continues to accrue interest at {{rate}}.{{/rate}}\n\nAttached is your full statement of account. Please settle in full here: {{pay_link}}\n\nPlease treat this as urgent.\n\nKind regards,\n{{sender}}\nDirector of Finance | Factur',
   '{am,tl}',
   'ACTION — pause all services for {{client}}',
E'{{client}} is {{days}} days past due on {{account_total}} and ALL SERVICES are to be paused with immediate effect.\n\nDo not commence new work on this account. Only a payment in cleared funds, or a Finance-approved payment plan, lifts the pause.'),

  (8, 'arrangement_32', 'Payment arrangement window', 32, '{am}', false, false,
   '{{client}} — payment arrangement options before collections, {{account_total}}',
E'Good day {{contact}},\n\nServices on your account have been paused and the outstanding balance is now {{account_total}}.\n\nI would like to resolve this before it goes further. We are willing to discuss a short, structured payment arrangement. To be approved it must:\n\n  •  be recorded in a signed Acknowledgement of Debt setting out the dates and amounts;\n  •  include a first payment in cleared funds; and\n  •  be approved by Finance before services resume.\n\nIf no payment or signed arrangement is in place by {{collections_date}}, the account will be handed to our collections partner. At that point the balance continues to accrue interest and recovery costs may be added.\n\nThe full balance can be settled here: {{pay_link}}. A current statement is attached.\n\nKind regards,\n{{sender}}\nDirector of Finance | Factur',
   '{bg}',
   'ACTION — turn off recurring invoices in QBO for {{client}}',
E'{{client}} is paused and past 32 days. Please switch off the recurring invoice template in QuickBooks so no further invoices generate against a paused account, and confirm here once done.'),

  (9, 'collections_61', 'Handed to collections', 61, '{am,tl}', false, false,
   '{{client}} — account handed to collections, {{account_total}}',
E'Good day {{contact}},\n\nDespite our earlier notices and the opportunity to agree a payment arrangement, the balance of {{account_total}} on your account remains unpaid and services have been paused.\n\nYour account has today been handed to our collections partner for recovery.\n\nAll further correspondence regarding this balance should be directed to our collections partner. We are no longer able to discuss the balance directly.\n\nYour account with Factur is closed to new business. Any future engagement would be on prepayment terms only.\n\nKind regards,\n{{sender}}\nDirector of Finance | Factur',
   '{am,tl}',
   'HANDED TO COLLECTIONS — {{client}} — {{account_total}}',
E'{{client}} has been handed to collections today with an outstanding balance of {{account_total}}.\n\nThe client is closed to new business and no one should quote or commence work. Please do not contact the client about the balance — all contact now goes through the collections partner.\n\nMark the account Collections / Handed Over in QuickBooks and Salesforce.')

on conflict (code) do nothing;
