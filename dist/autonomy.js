/**
 * Fixed reinforcement appended to EVERY dispatched briefing. The user's
 * briefing is kept verbatim; nothing in it is rewritten or trimmed.
 */
export const AUTONOMY_REINFORCEMENT = `---
SCHEDULED, UNATTENDED RUN — AUTONOMY REQUIREMENTS (added automatically by the Jarvis Schedule plugin)

This mission was started by a schedule. Nobody is watching and nobody will answer. You (the maestro) MUST run 100% autonomously:
- NEVER call ask_user and NEVER wait for a human reply, approval or confirmation.
- Take every decision yourself, using sensible defaults whenever something is ambiguous or missing. State the assumptions you made.
- NEVER stall or block: if something is impossible or fails, work around it or record it and move on with what can be done.
- Complete the work described above, then close the mission by calling mission_finish with a COMPLETE summary of what was done and the result (deliverables, key findings or numbers, anything that failed or was skipped, and any follow-ups). That summary is stored as this run's record.`;
/** The briefing sent to the Bridge: the user's text verbatim, then the reinforcement. */
export function buildBrief(userBriefing) {
    return `${userBriefing}\n\n${AUTONOMY_REINFORCEMENT}\n`;
}
