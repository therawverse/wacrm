import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  fetchPrivateSheetCsv,
  fetchPublishedSheetCsv,
} from '@/lib/google-sheets'
import {
  summarizeSourceResults,
  syncGoogleSheetSourceAttempt,
  type GoogleSheetImportSource,
  type GoogleSheetSourceSyncResult,
} from '@/lib/google-sheet-import-sources'
import { parseLeadCsv } from '@/lib/lead-import'
import { importLeadRows, type LeadImportResult } from '@/lib/lead-import-service'

type SourceResult = LeadImportResult & {
  source: 'published_csv' | 'private_sheet'
}

export async function GET(request: Request) {
  const expected =
    process.env.CRON_SECRET ?? process.env.GOOGLE_SHEETS_IMPORT_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'Google Sheets sync is not configured' }, { status: 503 })
  }
  if (!isAuthorized(request, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = supabaseAdmin()
    const { data: savedSources, error: savedSourcesError } = await admin
      .from('google_sheet_import_sources')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: true })

    if (savedSourcesError && !hasEnvSources()) {
      return NextResponse.json(
        {
          error: `${savedSourcesError.message}. Run migration 016_google_sheet_import_sources.sql, then refresh the PostgREST schema cache.`,
        },
        { status: 500 },
      )
    }

    if (savedSources?.length) {
      const results = await Promise.all(
        savedSources.map((source) =>
          syncGoogleSheetSourceAttempt(
            admin,
            source as GoogleSheetImportSource,
          ),
        ),
      )
      return NextResponse.json({
        sources: results.map(serializeSavedSourceResult),
        ...summarizeSourceResults(results),
      })
    }

    if (!hasEnvSources()) {
      return NextResponse.json(
        { error: 'No active Google Sheets import sources are configured' },
        { status: 503 },
      )
    }

    const userId = process.env.GOOGLE_SHEETS_IMPORT_USER_ID
    if (!userId) {
      return NextResponse.json(
        { error: 'GOOGLE_SHEETS_IMPORT_USER_ID is required when using env-based imports' },
        { status: 503 },
      )
    }

    const results: SourceResult[] = []

    const publishedUrl = process.env.GOOGLE_SHEETS_AUTO_PUBLISHED_URL?.trim()
    if (publishedUrl) {
      const csv = await fetchPublishedSheetCsv(publishedUrl)
      const rows = parseLeadCsv(csv)
      results.push({
        source: 'published_csv',
        ...(await importLeadRows(admin, userId, rows)),
      })
    }

    if (results.length === 0) {
      return NextResponse.json(
        { error: 'No Google Sheets automatic import sources are configured' },
        { status: 503 },
      )
    }

    return NextResponse.json({
      sources: results.map((result) => ({
        ...result,
        errors: result.errors.slice(0, 5),
      })),
      created: sum(results, 'created'),
      updated: sum(results, 'updated'),
      failed: sum(results, 'failed'),
      total: sum(results, 'total'),
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Google Sheets sync failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

function hasEnvSources() {
  return Boolean(
    process.env.GOOGLE_SHEETS_AUTO_PUBLISHED_URL?.trim(),
  )
}

function serializeSavedSourceResult(result: GoogleSheetSourceSyncResult) {
  return {
    id: result.source.id,
    name: result.source.name,
    source_type: result.source.source_type,
    is_active: result.source.is_active,
    ok: result.ok,
    created: result.created,
    updated: result.updated,
    failed: result.failed,
    total: result.total,
    errors: result.errors.slice(0, 5),
  }
}

function isAuthorized(request: Request, expected: string) {
  const authorization = request.headers.get('authorization') ?? ''
  const bearer = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
  const supplied =
    bearer ||
    request.headers.get('x-cron-secret') ||
    new URL(request.url).searchParams.get('secret') ||
    ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  return (
    suppliedBuf.length === expectedBuf.length &&
    timingSafeEqual(suppliedBuf, expectedBuf)
  )
}

function sum(results: SourceResult[], field: keyof LeadImportResult) {
  return results.reduce((total, result) => {
    const value = result[field]
    return total + (typeof value === 'number' ? value : 0)
  }, 0)
}
