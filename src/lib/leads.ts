import type { Contact, LeadCategory, LeadStage } from '@/types'

export const LEAD_CATEGORIES = ['Ace', 'King', 'Queen', 'Joker'] as const

export const LEAD_STAGES = [
  'DNP',
  'Followup',
  'Meeting Scheduled',
  'Send Proposal',
  'Onboarded',
  'Rejected',
] as const

export const LEAD_STAGE_COLORS: Record<LeadStage, string> = {
  DNP: '#64748b',
  Followup: '#3b82f6',
  'Meeting Scheduled': '#8b5cf6',
  'Send Proposal': '#b45309',
  Onboarded: '#22c55e',
  Rejected: '#ef4444',
}

export const LEAD_CATEGORY_COLORS: Record<LeadCategory, string> = {
  Ace: '#22c55e',
  King: '#3b82f6',
  Queen: '#a855f7',
  Joker: '#f59e0b',
}

export const DEFAULT_CATEGORY_BY_STAGE: Record<LeadStage, LeadCategory> = {
  DNP: 'Joker',
  Followup: 'Queen',
  'Meeting Scheduled': 'King',
  'Send Proposal': 'Ace',
  Onboarded: 'Ace',
  Rejected: 'Joker',
}

export function defaultCategoryForStage(stage: LeadStage): LeadCategory {
  return DEFAULT_CATEGORY_BY_STAGE[stage]
}

export function stepCategoryForStage(stage: LeadStage): LeadCategory {
  return defaultCategoryForStage(stage)
}

export function normalizeLeadStageCategory<T extends Pick<Contact, 'stage' | 'category'>>(
  lead: T,
): T {
  return {
    ...lead,
    category: stepCategoryForStage(lead.stage),
  }
}

export interface FollowupGroups {
  overdue: Contact[]
  dueToday: Contact[]
  upcoming: Contact[]
}

export interface LeadSummary {
  totalLeads: number
  dueFollowups: number
  byStage: Record<LeadStage, number>
  byCategory: Record<LeadCategory, number>
}

type LeadSummaryContact = Pick<
  Contact,
  'stage' | 'category' | 'next_followup'
>

export function toDateTimeLocal(iso?: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

export function fromDateTimeLocal(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function groupFollowups(
  contacts: Contact[],
  now: Date = new Date(),
): FollowupGroups {
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)

  const groups: FollowupGroups = {
    overdue: [],
    dueToday: [],
    upcoming: [],
  }

  for (const contact of contacts) {
    if (!contact.next_followup) continue
    const timestamp = new Date(contact.next_followup).getTime()
    if (Number.isNaN(timestamp)) continue

    if (timestamp < now.getTime()) groups.overdue.push(contact)
    else if (timestamp <= endOfToday.getTime()) groups.dueToday.push(contact)
    else groups.upcoming.push(contact)
  }

  const byFollowup = (a: Contact, b: Contact) =>
    new Date(a.next_followup!).getTime() -
    new Date(b.next_followup!).getTime()

  groups.overdue.sort(byFollowup)
  groups.dueToday.sort(byFollowup)
  groups.upcoming.sort(byFollowup)
  return groups
}

export function filterLeads(
  contacts: Contact[],
  search: string,
  stage: LeadStage | 'all',
  category: LeadCategory | 'all',
): Contact[] {
  const term = search.trim().toLowerCase()

  return contacts.filter((contact) => {
    const matchesSearch =
      !term ||
      [contact.name, contact.email, contact.phone]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term))

    return (
      matchesSearch &&
      (stage === 'all' || contact.stage === stage) &&
      (category === 'all' || contact.category === category)
    )
  })
}

export function summarizeLeads(
  contacts: LeadSummaryContact[],
  now: Date = new Date(),
): LeadSummary {
  const byStage = Object.fromEntries(
    LEAD_STAGES.map((stage) => [stage, 0]),
  ) as Record<LeadStage, number>
  const byCategory = Object.fromEntries(
    LEAD_CATEGORIES.map((category) => [category, 0]),
  ) as Record<LeadCategory, number>

  for (const contact of contacts) {
    byStage[contact.stage] += 1
    byCategory[contact.category] += 1
  }

  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)
  const dueFollowups = contacts.filter((contact) => {
    if (!contact.next_followup) return false
    const timestamp = new Date(contact.next_followup).getTime()
    return !Number.isNaN(timestamp) && timestamp <= endOfToday.getTime()
  }).length

  return {
    totalLeads: contacts.length,
    dueFollowups,
    byStage,
    byCategory,
  }
}
