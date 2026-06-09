import { createSign } from 'node:crypto'

export async function fetchPublishedSheetCsv(url: string): Promise<string> {
  const parsed = toPublishedCsvUrl(new URL(url))
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'docs.google.com') {
    throw new Error('Use a Google Sheets HTTPS URL from docs.google.com')
  }
  const response = await fetch(parsed, { cache: 'no-store' })
  if (!response.ok) {
    const detail = await response.text()
    console.error('[google-sheets] published sheet fetch failed', {
      status: response.status,
      url: parsed.toString(),
      detail,
    })
    throw new Error(`Published sheet returned ${response.status}`)
  }
  const text = await response.text()
  if (looksLikeHtml(text)) {
    throw new Error(
      'Google returned a web page instead of CSV. Publish the sheet as CSV or set sharing to "Anyone with the link can view".',
    )
  }
  return text
}

export async function fetchPrivateSheetCsv(
  spreadsheetId: string,
  range: string,
): Promise<string> {
  const token = await getServiceAccountToken()
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}?majorDimension=ROWS`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!response.ok) {
    const detail = await response.text()
    console.error('[google-sheets] private sheet fetch failed', {
      status: response.status,
      spreadsheetId,
      range,
      detail,
    })
    throw new Error(`Google Sheets API failed (${response.status}): ${detail}`)
  }
  const payload = (await response.json()) as { values?: unknown[][] }
  return (payload.values ?? []).map((row) => row.map(csvCell).join(',')).join('\n')
}

async function getServiceAccountToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(
    /\\n/g,
    '\n',
  )
  if (!email || !privateKey) {
    throw new Error('Google service account is not configured')
  }

  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = base64Url(
    JSON.stringify({
      iss: email,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  )
  const unsigned = `${header}.${claim}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  const assertion = `${unsigned}.${signer.sign(privateKey, 'base64url')}`

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    cache: 'no-store',
  })
  if (!response.ok) {
    const detail = await response.text()
    console.error('[google-sheets] service-account auth failed', {
      status: response.status,
      email,
      detail,
    })
    throw new Error('Google service-account authentication failed')
  }
  const payload = (await response.json()) as { access_token?: string }
  if (!payload.access_token) {
    console.error('[google-sheets] service-account auth returned no token', {
      email,
      payload,
    })
    throw new Error('Google did not return an access token')
  }
  return payload.access_token
}

function base64Url(value: string) {
  return Buffer.from(value).toString('base64url')
}

function toPublishedCsvUrl(url: URL): URL {
  if (
    url.pathname.includes('/pub') ||
    url.searchParams.get('output') === 'csv' ||
    url.searchParams.get('format') === 'csv'
  ) {
    return url
  }

  const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/)
  if (!match) return url

  const csvUrl = new URL(
    `https://docs.google.com/spreadsheets/d/${match[1]}/export`,
  )
  csvUrl.searchParams.set('format', 'csv')
  const gid = url.searchParams.get('gid')
  if (gid) csvUrl.searchParams.set('gid', gid)
  return csvUrl
}

function looksLikeHtml(text: string) {
  return /^\s*<!doctype html/i.test(text) || /^\s*<html[\s>]/i.test(text)
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
