import type { CourseAiPolicy } from "./generated/langs"

/** What a course's AI-use policy permits, in the words of courses.mooc.fi's own descriptions. */
const AI_POLICY_RULES: Record<Exclude<CourseAiPolicy, "not_set">, string> = {
  no_ai: "AI may not be used at any point.",
  planning_only:
    "AI may be used for planning, such as brainstorming or outlining, but not in the final work.",
  limited: "AI may be used for specific tasks only, with disclosure.",
  full_use: "AI may be used freely, with disclosure.",
  required: "AI use is expected.",
  unrecognized: "The course has an AI policy this version of TestMyCode does not know.",
}

/** The sentence stating what `policy` permits; `undefined` for a course that has none set. */
export function aiPolicyRule(policy: CourseAiPolicy): string | undefined {
  return policy === "not_set" ? undefined : AI_POLICY_RULES[policy]
}

/** What TestMyCode does to AI assistance in the workspace of a course that allows AI or not. */
export function aiAssistanceSentence(isAiAllowed: boolean): string {
  return isAiAllowed
    ? "AI assistance is on in this course."
    : "AI assistance is off in this course."
}
