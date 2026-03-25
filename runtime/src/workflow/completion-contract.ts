export type ImplementationCompletionTaskClass =
  | "artifact_only"
  | "build_required"
  | "behavior_required"
  | "review_required"
  | "scaffold_allowed";

export type PlaceholderTaxonomy =
  | "scaffold"
  | "implementation"
  | "repair";

export interface ImplementationCompletionContract {
  readonly taskClass: ImplementationCompletionTaskClass;
  readonly placeholdersAllowed: boolean;
  readonly partialCompletionAllowed: boolean;
  readonly placeholderTaxonomy?: PlaceholderTaxonomy;
}
