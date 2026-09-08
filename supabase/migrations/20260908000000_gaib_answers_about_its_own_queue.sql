/*
 * Let Gaib answer "where does this stand".
 *
 * The tickets, what happened to them, the questions asked about them and the
 * conversations they came out of were all closed to it -- not because reading
 * them is dangerous, but because I blocked every gaib_ table on principle when
 * the first one was written.
 *
 * The principle was aimed at the wrong thing. What must not be reachable is the
 * agent's own rails: the paths it may write to, and the secret that lets a job
 * call an endpoint. Reading the queue is not that. And every one of these
 * tables already carries a policy that scopes it properly -- a person sees their
 * own tickets and their own conversations, whoever may read transcripts sees
 * everyone's -- so opening them adds no access to anybody. It only lets Gaib
 * answer from data the person asking could already open a screen to read.
 *
 * Still shut: gaib_secrets, which has no policy and belongs to nobody, and
 * gaib_coding_settings, which is the ceiling on what an automated thing may push
 * to production and has no business being read out by one.
 */
