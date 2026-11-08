/** A board card as the Planner's read returns it (DESIGN.md §25.1, task 19.1): the cards assigned to the person, with where each is from. */
export interface PlannedBoardCard {
  readonly cardId: string;
  readonly boardId: string;
  readonly boardName: string;
  /** `#rrggbb`, data a person chose: drawn as a band, never as a background with text on it. */
  readonly boardColor: string;
  readonly listName: string;
  readonly title: string;
  /** `YYYY-MM-DD`. */
  readonly dueDate: string;
  /** `HH:MM`, or null for a card with a date and no time. */
  readonly dueTime: string | null;
  /** When it ends, the same day (task 19.5): `HH:MM` after `dueTime`, or null. */
  readonly dueEnd: string | null;
}

export interface Planned {
  readonly cards: readonly PlannedBoardCard[];
}
