import type { ResearchPlanDraftV2 } from "./types";
import type {
  ResearchPlanVersion,
  ResearchSourceType,
  ResearchStrategy,
} from "../types";
import type { ResearchTranslate } from "../runtime/executionContext";

const STARTER_STEP_IDS = [
  "starter-research-background",
  "starter-research-evidence",
  "starter-research-synthesis",
] as const;

export function isStarterResearchPlan(
  plan: Pick<ResearchPlanVersion, "steps" | "adjustment"> | undefined,
): boolean {
  return (
    !!plan &&
    !plan.adjustment &&
    plan.steps.length === 3 &&
    plan.steps.every((step, index) => step.id === STARTER_STEP_IDS[index])
  );
}

export function createStarterResearchPlan({
  goal,
  strategy,
  allowedSourceTypes,
  t,
}: {
  goal: string;
  strategy: ResearchStrategy;
  allowedSourceTypes: readonly ResearchSourceType[];
  t: ResearchTranslate;
}): ResearchPlanDraftV2 {
  const sources = allowedSourceTypes.length
    ? [...allowedSourceTypes]
    : ["web" as const];
  const topic = goal.slice(0, 500);
  const steps = ["background", "evidence", "synthesis"] as const;
  return {
    title: topic,
    summary: t("runtime.starter.summary"),
    objective: goal.slice(0, 4000),
    scope: {
      audience: t("runtime.starter.audience"),
      includes: [topic],
      excludes: [],
      allowedSourceTypes: sources,
    },
    assumptions: [t("runtime.starter.assumption")],
    deliverable: {
      kind: "research_report",
      description: t("runtime.starter.deliverable"),
      requiredSections: [t("runtime.starter.section")],
    },
    strategy,
    steps: steps.map((step, index) => ({
      id: STARTER_STEP_IDS[index],
      title: t(`runtime.starter.${step}`),
      objective: t(`runtime.starter.${step}Objective`, { topic }),
      questions: [t(`runtime.starter.${step}Objective`, { topic })],
      queryTopics: [`${topic} ${t(`runtime.starter.${step}`)}`],
      sourcePriorities: sources.map((sourceType) => ({
        sourceType,
        priority: "high" as const,
      })),
      evidenceCriteria: [t("runtime.starter.evidenceCriteria")],
      priority: "high" as const,
    })),
    completionCriteria: [t("runtime.starter.completionCriteria")],
  };
}
