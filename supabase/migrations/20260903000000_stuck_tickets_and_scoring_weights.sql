/*
 * Two gaps, both found by people using the thing.
 *
 * A ticket handed to the agent that never ran used to sit in the queue in
 * silence. The person who reported it heard nothing and reasonably assumed
 * somebody was on it; it happened twice, both times found hours later from a
 * GitHub email rather than from Gaib. gaib_flag_stuck_tickets() notices
 * anything queued for over half an hour and writes the notice that says so --
 * once per ticket, because repeating it every ten minutes is a worse kind of
 * silence.
 *
 * And somebody asked what a hustle point is worth. Gaib could not say, not
 * because the answer is buried in code but because effort_weights was not on
 * the list an agent may read. It is four tables -- effort, deal and health
 * weights, and the app settings -- already visible on the settings screens, and
 * they are the difference between reporting a number and explaining it.
 */
