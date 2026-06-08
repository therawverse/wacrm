import type { LeadDashboardData } from '@/lib/dashboard/types'
import {
  LEAD_CATEGORIES,
  LEAD_CATEGORY_COLORS,
  LEAD_STAGES,
  LEAD_STAGE_COLORS,
} from '@/lib/leads'
import { Skeleton } from './skeleton'

export function LeadBreakdown({
  data,
  loading,
}: {
  data: LeadDashboardData | null
  loading: boolean
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <BreakdownCard
        title="Sales Funnel"
        subtitle="Lead count at each stage"
        loading={loading}
        rows={
          data
            ? LEAD_STAGES.map((stage) => ({
                label: stage,
                count: data.byStage[stage],
                color: LEAD_STAGE_COLORS[stage],
              }))
            : []
        }
      />
      <BreakdownCard
        title="Leads by Category"
        subtitle="Lead priority distribution"
        loading={loading}
        rows={
          data
            ? LEAD_CATEGORIES.map((category) => ({
                label: category,
                count: data.byCategory[category],
                color: LEAD_CATEGORY_COLORS[category],
              }))
            : []
        }
      />
      <BreakdownCard
        title="Campaign Breakdown"
        subtitle="Top lead-generating campaigns"
        loading={loading}
        rows={
          data
            ? data.byCampaign.slice(0, 8).map((campaign, index) => ({
                label: campaign.name,
                count: campaign.count,
                color: CAMPAIGN_COLORS[index % CAMPAIGN_COLORS.length],
              }))
            : []
        }
      />
    </div>
  )
}

const CAMPAIGN_COLORS = [
  '#3b82f6',
  '#8b5cf6',
  '#22c55e',
  '#b45309',
  '#ec4899',
  '#06b6d4',
  '#a16207',
  '#64748b',
]

function BreakdownCard({
  title,
  subtitle,
  rows,
  loading,
}: {
  title: string
  subtitle: string
  rows: { label: string; count: number; color: string }[]
  loading: boolean
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0)

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900">
      <header className="border-b border-slate-800 px-5 py-4">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
      </header>
      <div className="p-5">
        {loading ? (
          <Skeleton className="h-36 w-full" />
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => {
              const percentage = total === 0 ? 0 : (row.count / total) * 100
              return (
                <li key={row.label}>
                  <div className="mb-1.5 flex items-center gap-2 text-xs">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: row.color }}
                    />
                    <span className="flex-1 text-slate-300">{row.label}</span>
                    <span className="tabular-nums text-slate-400">
                      {row.count}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor: row.color,
                      }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
