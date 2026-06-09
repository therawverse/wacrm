'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { parseLeadCsv, type LeadImportRow } from '@/lib/lead-import'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface ImportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}

type ImportResult = {
  created: number
  updated: number
  failed: number
  total: number
  errors?: {
    row: number
    phone: string
    message: string
  }[]
}

type ImportSource = {
  id: string
  name: string
  source_type: 'published_csv' | 'private_sheet'
  published_url: string | null
  spreadsheet_id: string | null
  sheet_range: string | null
  is_active: boolean
  last_synced_at: string | null
  last_result: ImportResult | null
}

type SourceForm = {
  id: string | null
  name: string
  source_type: 'published_csv' | 'private_sheet'
  published_url: string
  spreadsheet_id: string
  sheet_range: string
  is_active: boolean
}

const emptySourceForm: SourceForm = {
  id: null,
  name: '',
  source_type: 'published_csv',
  published_url: '',
  spreadsheet_id: '',
  sheet_range: 'Sheet1',
  is_active: true,
}

export function ImportModal({
  open,
  onOpenChange,
  onImported,
}: ImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<LeadImportRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [sources, setSources] = useState<ImportSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [sourceSaving, setSourceSaving] = useState(false)
  const [sourceActionId, setSourceActionId] = useState<string | null>(null)
  const [sourceForm, setSourceForm] = useState<SourceForm>(emptySourceForm)

  const loadSources = useCallback(async () => {
    setSourcesLoading(true)
    try {
      const response = await fetch('/api/leads/import/sources')
      const payload = (await response.json()) as {
        sources?: ImportSource[]
        error?: string
      }
      if (!response.ok) throw new Error(payload.error || 'Failed to load saved sources')
      setSources(payload.sources ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load saved sources')
    } finally {
      setSourcesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void loadSources()
  }, [loadSources, open])

  function reset() {
    setFile(null)
    setRows([])
    setResult(null)
    setSourceForm(emptySourceForm)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    if (!selected) return

    const parsed = parseLeadCsv(await selected.text())
    setFile(selected)
    setRows(parsed)
    setResult(null)

    if (!parsed.length) {
      toast.error('No valid rows found. A phone column is required.')
    }
  }

  async function runCsvUpload() {
    setImporting(true)
    setResult(null)
    try {
      const response = await fetch('/api/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'rows', rows }),
      })
      const payload = (await response.json()) as ImportResult & { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Import failed')
      setResult(payload)
      onImported()
      toast.success(`${payload.created} created, ${payload.updated} updated`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  function editSource(source: ImportSource) {
    setSourceForm({
      id: source.id,
      name: source.name,
      source_type: source.source_type,
      published_url: source.published_url ?? '',
      spreadsheet_id: source.spreadsheet_id ?? '',
      sheet_range: source.sheet_range ?? 'Sheet1',
      is_active: source.is_active,
    })
  }

  function sourcePayload() {
    if (sourceForm.source_type === 'private_sheet') {
      return {
        name: sourceForm.name.trim() || undefined,
        source_type: 'private_sheet',
        spreadsheet_id: normalizeSpreadsheetId(sourceForm.spreadsheet_id),
        sheet_range: sourceForm.sheet_range.trim() || 'Sheet1',
        is_active: sourceForm.is_active,
      }
    }

    return {
      name: sourceForm.name.trim() || undefined,
      source_type: 'published_csv',
      published_url: sourceForm.published_url.trim(),
      is_active: sourceForm.is_active,
    }
  }

  async function saveSource(importAfterSave = false) {
    setSourceSaving(true)
    try {
      const response = await fetch(
        sourceForm.id
          ? `/api/leads/import/sources/${sourceForm.id}`
          : '/api/leads/import/sources',
        {
          method: sourceForm.id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sourcePayload()),
        },
      )
      const payload = (await response.json()) as {
        source?: ImportSource
        error?: string
      }
      if (!response.ok) throw new Error(payload.error || 'Failed to save source')
      toast.success(sourceForm.id ? 'Saved source updated' : 'Saved source created')
      setSourceForm(emptySourceForm)
      if (importAfterSave && payload.source) await syncSource(payload.source)
      await loadSources()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save source')
    } finally {
      setSourceSaving(false)
    }
  }

  async function patchSource(source: ImportSource, body: Record<string, unknown>) {
    setSourceActionId(source.id)
    try {
      const response = await fetch(`/api/leads/import/sources/${source.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = (await response.json()) as {
        source?: ImportSource
        error?: string
      }
      if (!response.ok) throw new Error(payload.error || 'Failed to update source')
      if (payload.source) {
        setSources((current) =>
          current.map((item) => (item.id === source.id ? payload.source! : item)),
        )
      }
      toast.success(body.is_active ? 'Cron enabled' : 'Cron paused')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update source')
    } finally {
      setSourceActionId(null)
    }
  }

  async function syncSource(source: ImportSource) {
    setSourceActionId(source.id)
    try {
      const response = await fetch(`/api/leads/import/sources/${source.id}/sync`, {
        method: 'POST',
      })
      const payload = (await response.json()) as ImportResult & { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Manual import failed')
      toast.success(`${payload.created} created, ${payload.updated} updated`)
      await loadSources()
      onImported()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Manual import failed')
    } finally {
      setSourceActionId(null)
    }
  }

  async function deleteSource(source: ImportSource) {
    setSourceActionId(source.id)
    try {
      const response = await fetch(`/api/leads/import/sources/${source.id}`, {
        method: 'DELETE',
      })
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      if (!response.ok) throw new Error(payload.error || 'Failed to delete source')
      setSources((current) => current.filter((item) => item.id !== source.id))
      if (sourceForm.id === source.id) setSourceForm(emptySourceForm)
      toast.success('Saved source deleted')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete source')
    } finally {
      setSourceActionId(null)
    }
  }

  const preview = rows.slice(0, 5)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[96vh] w-[min(78vw,104rem)] max-w-none overflow-y-auto overflow-x-hidden border-slate-700 bg-slate-900 p-5 text-slate-200 sm:max-w-none sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-white">Import Leads</DialogTitle>
          <DialogDescription className="text-slate-400">
            Upload a CSV manually or save a published CSV URL or private Google
            Sheet for manual import and cron.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="upload">
          <TabsList className="bg-slate-800">
            <TabsTrigger value="upload">CSV Upload</TabsTrigger>
            <TabsTrigger value="saved">Saved Sources</TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-700 p-6 transition-colors hover:border-primary/50"
            >
              {file ? (
                <>
                  <FileText className="size-8 text-primary" />
                  <span className="text-sm text-slate-300">{file.name}</span>
                  <span className="text-xs text-slate-500">
                    {rows.length} valid rows
                  </span>
                </>
              ) : (
                <>
                  <Upload className="size-8 text-slate-500" />
                  <span className="text-sm text-slate-400">
                    Choose a CSV file
                  </span>
                </>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
            />
            {preview.length > 0 && <ImportPreview rows={preview} />}
            <Button
              disabled={!rows.length || importing}
              onClick={runCsvUpload}
              className="bg-primary text-primary-foreground"
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              Import {rows.length || ''} Leads
            </Button>
          </TabsContent>

          <TabsContent value="saved" className="space-y-5 min-w-0">
            <div className="grid gap-4 rounded-lg border border-slate-700 bg-slate-800/40 p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="space-y-2 min-w-0">
                <Label htmlFor="source-name">Source name</Label>
                <Input
                  id="source-name"
                  value={sourceForm.name}
                  onChange={(event) =>
                    setSourceForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Monthly lead source"
                  className="border-slate-700 bg-slate-900 text-white"
                />
              </div>
              <div className="space-y-2 min-w-0">
                <Label htmlFor="source-type">Source type</Label>
                <Select
                  value={sourceForm.source_type}
                  onValueChange={(value) =>
                    setSourceForm((current) => ({
                      ...current,
                      source_type: value as SourceForm['source_type'],
                    }))
                  }
                >
                  <SelectTrigger
                    id="source-type"
                    className="w-full border-slate-700 bg-slate-900 text-white"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-slate-700 bg-slate-900 text-white">
                    <SelectItem value="published_csv">Published CSV</SelectItem>
                    <SelectItem value="private_sheet">Private Sheet</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 lg:col-span-2">
                <Switch
                  checked={sourceForm.is_active}
                  onCheckedChange={(value) =>
                    setSourceForm((current) => ({
                      ...current,
                      is_active: !!value,
                    }))
                  }
                />
                <Label className="pb-1 text-slate-300">Run in cron</Label>
              </div>
              {sourceForm.source_type === 'published_csv' ? (
                <div className="space-y-2 lg:col-span-2">
                  <Label htmlFor="source-published-url">Published CSV URL</Label>
                  <Input
                    id="source-published-url"
                    value={sourceForm.published_url}
                    onChange={(event) =>
                      setSourceForm((current) => ({
                        ...current,
                        published_url: event.target.value,
                      }))
                    }
                    placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?output=csv"
                    className="border-slate-700 bg-slate-900 text-white"
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-2 min-w-0">
                    <Label htmlFor="source-spreadsheet-id">Spreadsheet ID or URL</Label>
                    <Input
                      id="source-spreadsheet-id"
                      value={sourceForm.spreadsheet_id}
                      onChange={(event) =>
                        setSourceForm((current) => ({
                          ...current,
                          spreadsheet_id: event.target.value,
                        }))
                      }
                      placeholder="1AbCDefGhIjKlMnOpQrStUvWxYz"
                      className="border-slate-700 bg-slate-900 text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="source-sheet-range">Sheet range</Label>
                    <Input
                      id="source-sheet-range"
                      value={sourceForm.sheet_range}
                      onChange={(event) =>
                        setSourceForm((current) => ({
                          ...current,
                          sheet_range: event.target.value,
                        }))
                      }
                      placeholder="Sheet1"
                      className="border-slate-700 bg-slate-900 text-white"
                    />
                  </div>
                </>
              )}
              <div className="flex flex-col gap-3 border-t border-slate-700 pt-2 lg:col-span-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-2">
                  {sourceForm.id && (
                    <Button
                      variant="outline"
                      onClick={() => setSourceForm(emptySourceForm)}
                      className="border-slate-700 text-slate-300"
                    >
                      <Plus className="size-4" />
                      New
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    disabled={sourceSaving}
                    onClick={() => saveSource(false)}
                    className="bg-primary text-primary-foreground"
                  >
                    {sourceSaving ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Save className="size-4" />
                    )}
                    {sourceForm.id ? 'Update' : 'Create'}
                  </Button>
                  <Button
                    disabled={sourceSaving}
                    onClick={() => saveSource(true)}
                    className="bg-primary text-primary-foreground"
                  >
                    {sourceSaving ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    Save & Manual Import
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              {sourcesLoading ? (
                <div className="flex items-center gap-2 rounded-lg border border-slate-700 p-3 text-sm text-slate-400">
                  <Loader2 className="size-4 animate-spin" />
                  Loading saved sources...
                </div>
              ) : sources.length === 0 ? (
                <div className="rounded-lg border border-slate-700 p-3 text-sm text-slate-400">
                  No saved sources yet.
                </div>
              ) : (
                sources.map((source) => (
                  <div
                    key={source.id}
                    className="rounded-lg border border-slate-700 bg-slate-800/30 p-3"
                  >
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-white">{source.name}</p>
                          <span
                            className={
                              source.is_active
                                ? 'rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300'
                                : 'rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300'
                            }
                            >
                              {source.is_active ? 'Cron on' : 'Cron off'}
                            </span>
                          <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                            {source.source_type === 'published_csv'
                              ? 'Published CSV'
                              : 'Private Sheet'}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500" title={source.source_type === 'published_csv' ? source.published_url ?? '' : `${source.spreadsheet_id ?? ''}${source.sheet_range ? ` | ${source.sheet_range}` : ''}`}>
                          {source.source_type === 'published_csv'
                            ? source.published_url
                            : `${source.spreadsheet_id ?? ''}${source.sheet_range ? ` | ${source.sheet_range}` : ''}`}
                        </p>
                        {source.last_synced_at && (
                          <p className="mt-1 text-xs text-slate-500">
                            Last import{' '}
                            {new Date(source.last_synced_at).toLocaleString()}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                        <Switch
                          checked={source.is_active}
                          disabled={sourceActionId === source.id}
                          onCheckedChange={(value) =>
                            patchSource(source, { is_active: !!value })
                          }
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => syncSource(source)}
                          disabled={sourceActionId === source.id}
                          className="border-slate-700 text-slate-300"
                        >
                          {sourceActionId === source.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <RefreshCw className="size-4" />
                          )}
                          Manual Import
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="outline"
                          onClick={() => editSource(source)}
                          disabled={sourceActionId === source.id}
                          className="border-slate-700 text-slate-300"
                          title="Edit"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="destructive"
                          onClick={() => deleteSource(source)}
                          disabled={sourceActionId === source.id}
                          title="Delete"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>

        {result && (
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-sm">
            <span className="text-primary">{result.created} created</span>
            <span className="mx-2 text-slate-600">-</span>
            <span className="text-blue-300">{result.updated} updated</span>
            {result.failed > 0 && (
              <>
                <span className="mx-2 text-slate-600">-</span>
                <span className="text-red-400">{result.failed} failed</span>
              </>
            )}
            {result.errors && result.errors.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-red-300">
                {result.errors.map((error) => (
                  <li key={`${error.row}-${error.phone}`}>
                    Row {error.row} ({error.phone}): {error.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter className="border-slate-700 bg-slate-900">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-slate-700 text-slate-300"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function normalizeSpreadsheetId(value: string) {
  const trimmed = value.trim()
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  return match?.[1] ?? trimmed
}

function ImportPreview({ rows }: { rows: LeadImportRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-700">
      <table className="w-full text-xs">
        <thead className="bg-slate-800 text-slate-400">
          <tr>
            <th className="px-3 py-2 text-left">Phone</th>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Campaign</th>
            <th className="px-3 py-2 text-left">Platform</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.phone}-${index}`} className="border-t border-slate-700">
              <td className="px-3 py-2 text-slate-300">{row.phone}</td>
              <td className="px-3 py-2 text-slate-300">{row.name || '-'}</td>
              <td className="px-3 py-2 text-slate-300">{row.campaign || '-'}</td>
              <td className="px-3 py-2 text-slate-300">{row.platform || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
