export class ResearchModelUnavailableError extends Error {
  readonly code = "RESEARCH_MODEL_UNAVAILABLE";

  constructor() {
    super("The original research request model is unavailable.");
    this.name = "ResearchModelUnavailableError";
  }
}

export class ResearchWorkspaceUnavailableError extends Error {
  readonly code = "RESEARCH_WORKSPACE_UNAVAILABLE";

  constructor(message = "The research workspace could not be read.") {
    super(message);
    this.name = "ResearchWorkspaceUnavailableError";
  }
}

export class ResearchCheckpointUnavailableError extends Error {
  readonly code = "RESEARCH_CHECKPOINT_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "ResearchCheckpointUnavailableError";
  }
}
