export type ItemKind = 'book' | 'blanket' | 'food' | 'clothes' | 'toy'
export type StoryPhase = 'ready' | 'approach' | 'lift' | 'journey' | 'handoff' | 'celebrate' | 'done'

export const ITEM_RECIPIENT: Record<ItemKind, 'child' | 'elder'> = { book: 'child', toy: 'child', clothes: 'child', blanket: 'elder', food: 'elder' }
