/*
 * No views ship with the screen.
 *
 * Two shared ones were seeded so the dropdown would not be empty on a first
 * visit. That was the wrong instinct: a view somebody else wrote is a view
 * nobody has thought about, and "Open pipeline" in particular describes a
 * sequential scan of 779,763 rows that a person would never have asked for
 * deliberately. Handing that to everyone as the obvious first click is how the
 * screen ends up being blamed for being slow.
 *
 * So everyone builds their own, which is also the habit worth transferring:
 * the people being moved off Salesforce keep views that match how they work,
 * and they arrive knowing that is what the dropdown is for.
 *
 * Sharing stays -- an admin can still publish a view for everyone, and that is
 * a deliberate act by somebody who knows what it costs.
 */

delete from public.opportunity_list_views
where shared and name in ('Open pipeline', 'Needs action');
