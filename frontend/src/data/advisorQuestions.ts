/**
 * Multiple-choice questions for the renovation advisor flow.
 * Shown after the user uploads floor plan images; answers are sent to the AI to build the plan.
 */

export type AdvisorQuestion = {
  id: string
  label: string
  description?: string
  options: { value: string; label: string }[]
}

export const ADVISOR_QUESTIONS: AdvisorQuestion[] = [
  {
    id: 'propertyType',
    label: 'Property type',
    description: 'What best describes your property?',
    options: [
      { value: 'House', label: 'House' },
      { value: 'Townhouse', label: 'Townhouse' },
      { value: 'Duplex', label: 'Duplex' },
      { value: 'Semi-detached', label: 'Semi-detached' },
      { value: 'Other house-type', label: 'Other (house-type)' },
    ],
  },
  {
    id: 'currentCondition',
    label: 'Current condition',
    description: 'How would you describe the current state of the property?',
    options: [
      { value: 'Good, needs cosmetic updates', label: 'Good — needs cosmetic updates only' },
      { value: 'Needs renovation', label: 'Needs renovation (kitchen, baths, systems)' },
      { value: 'Major fix-up or structural', label: 'Major fix-up or structural work needed' },
      { value: 'Not sure', label: 'Not sure' },
    ],
  },
  {
    id: 'primaryGoal',
    label: "What you're looking to build",
    description: 'What’s your primary goal for this project?',
    options: [
      { value: 'Rental income (long-term)', label: 'Rental income (long-term tenant)' },
      { value: 'Short-term / Airbnb', label: 'Short-term / Airbnb' },
      { value: 'Add a suite or in-law unit', label: 'Add a suite or in-law unit' },
      { value: 'Sell after reno', label: 'Sell after renovation' },
      { value: 'Live in after reno', label: 'Live in after renovation' },
      { value: 'Multiple', label: 'Multiple (e.g. rent + live later)' },
    ],
  },
  {
    id: 'timeline',
    label: 'Timeline',
    description: 'When do you want to start or finish?',
    options: [
      { value: '3–6 months', label: '3–6 months' },
      { value: '6–12 months', label: '6–12 months' },
      { value: '1+ year', label: '1+ year' },
      { value: 'Not sure', label: 'Not sure yet' },
    ],
  },
  {
    id: 'budgetRange',
    label: 'Budget range (ballpark)',
    description: 'Rough budget for renovation (construction + permits)?',
    options: [
      { value: 'Under $50k', label: 'Under $50k' },
      { value: '$50k–$150k', label: '$50k–$150k' },
      { value: '$150k–$300k', label: '$150k–$300k' },
      { value: '$300k+', label: '$300k+' },
      { value: 'Prefer not to say', label: 'Prefer not to say' },
    ],
  },
  {
    id: 'bestUse',
    label: 'Best use / fit',
    description: 'How do you plan to use the property?',
    options: [
      { value: 'Primary residence', label: 'Primary residence' },
      { value: 'Investment rental', label: 'Investment rental' },
      { value: 'Vacation / short-term rental', label: 'Vacation / short-term rental' },
      { value: 'Multi-generational', label: 'Multi-generational' },
      { value: 'Not sure', label: 'Not sure' },
    ],
  },
]

export type AdvisorAnswers = Record<string, string>

/** Build a single summary string from answers for the AI prompt. */
export function buildGoalFromAnswers(answers: AdvisorAnswers, location: string): string {
  const parts: string[] = []
  if (answers.propertyType) parts.push(`Property type: ${answers.propertyType}.`)
  if (answers.currentCondition) parts.push(`Current condition: ${answers.currentCondition}.`)
  if (answers.primaryGoal) parts.push(`Primary goal: ${answers.primaryGoal}.`)
  if (answers.timeline) parts.push(`Timeline: ${answers.timeline}.`)
  if (answers.budgetRange) parts.push(`Budget range: ${answers.budgetRange}.`)
  if (answers.bestUse) parts.push(`Best use: ${answers.bestUse}.`)
  if (location.trim()) parts.push(`Location: ${location.trim()}.`)
  return parts.length ? parts.join(' ') : 'Estimate renovation cost and rental potential.'
}
