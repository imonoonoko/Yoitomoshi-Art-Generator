const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const projectRoot = path.resolve(__dirname, '..')
const defaultDataRoot = path.join(projectRoot, 'userdata')
const scriptVersion = 'prompt-meaning-review-v1-20260526'

if (require.main === module) {
  main()
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.exportPath) {
    const review = options.fromReport
      ? exportFromReport(options.fromReport, options)
      : exportFromDatabase(options)
    fs.mkdirSync(path.dirname(options.exportPath), { recursive: true })
    fs.writeFileSync(options.exportPath, `${JSON.stringify(review, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify({
      mode: 'export',
      exportPath: options.exportPath,
      entries: review.entries.length,
      source: options.fromReport ? 'report' : 'database'
    }, null, 2))
    return
  }

  if (options.importPath) {
    const result = importReviewedFile(options.importPath, options)
    console.log(JSON.stringify(result, null, 2))
    return
  }

  throw new Error('Specify --export <path> or --import <path>.')
}

function exportFromReport(reportPath, options) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  const entries = Array.isArray(report.results)
    ? report.results.map((result) => reviewEntryFromResult(result)).filter(Boolean)
    : []
  return reviewDocument(entries, {
    sourceType: 'enrichment-report',
    sourcePath: path.relative(projectRoot, reportPath).replace(/\\/g, '/'),
    minConfidence: report.minConfidence ?? null,
    note: 'Edit review.decision to accept, reject, or defer. Accepted records import as source-derived, not curated.'
  }, options)
}

function exportFromDatabase(options) {
  const db = openDb(options)
  try {
    ensureReviewSchema(db)
    const rows = db.prepare(`
      SELECT d.*
      FROM meaning_enrichment_decisions d
      JOIN (
        SELECT canonical_tag, MAX(decision_id) AS decision_id
        FROM meaning_enrichment_decisions
        GROUP BY canonical_tag
      ) latest ON latest.decision_id = d.decision_id
      WHERE d.applied = 0
        AND (
          d.decision = 'preview-only'
          OR d.reason IN ('low-confidence', 'redirect-only', 'ambiguous-provider-result', 'usage-evidence-only')
        )
      ORDER BY d.confidence DESC, d.canonical_tag ASC
      LIMIT ?
    `).all(options.limit)
    const entries = rows.map(reviewEntryFromAuditRow)
    return reviewDocument(entries, {
      sourceType: 'meaning-enrichment-decisions',
      dbPath: dbPathForOptions(options),
      note: 'Edit review.decision to accept, reject, or defer. Accepted records import as source-derived, not curated.'
    }, options)
  } finally {
    db.close()
  }
}

function importReviewedFile(importPath, options) {
  const parsed = JSON.parse(fs.readFileSync(importPath, 'utf8'))
  const entries = Array.isArray(parsed.entries) ? parsed.entries : []
  const accepted = entries.filter((entry) => readReviewDecision(entry) === 'accept')
  const db = openDb(options)
  const stats = {
    mode: 'import',
    importPath,
    dryRun: options.dryRun,
    scannedEntries: entries.length,
    acceptedEntries: accepted.length,
    applied: 0,
    skipped: 0,
    skippedCurated: 0,
    skippedMissingCandidate: 0,
    skippedInvalidText: 0,
    status: options.status,
    provider: 'human-reviewed-meaning-enrichment',
    results: []
  }

  let inTransaction = false
  try {
    ensureReviewSchema(db)
    if (!options.dryRun) {
      db.exec('BEGIN IMMEDIATE')
      inTransaction = true
    }
    for (const entry of accepted) {
      const result = importAcceptedEntry(db, entry, options)
      stats.results.push(result)
      if (result.applied) stats.applied += 1
      else {
        stats.skipped += 1
        if (result.reason === 'curated-protected') stats.skippedCurated += 1
        if (result.reason === 'missing-candidate') stats.skippedMissingCandidate += 1
        if (result.reason === 'invalid-text') stats.skippedInvalidText += 1
      }
    }
    if (inTransaction) {
      db.exec('COMMIT')
      inTransaction = false
    }
    return stats
  } catch (error) {
    if (inTransaction) db.exec('ROLLBACK')
    throw error
  } finally {
    db.close()
  }
}

function importAcceptedEntry(db, entry, options) {
  const canonicalTag = cleanString(entry.canonicalTag || entry.tag)
  const candidate = findCandidate(db, canonicalTag, Number(entry.candidateId ?? 0))
  if (!candidate) {
    return resultForEntry(entry, false, 'missing-candidate')
  }
  const existing = bestTranslationJob(db, candidate.candidate_id)
  if (existing?.status === 'curated' && !options.force) {
    return resultForEntry(entry, false, 'curated-protected')
  }

  const proposed = entry.proposed || {}
  const review = entry.review || {}
  const jaLabel = cleanString(review.jaLabel || proposed.jaLabel || entry.jaLabel)
  const jaMeaning = cleanString(review.jaMeaning || proposed.jaMeaning || entry.jaMeaning)
  if (!jaLabel || !jaMeaning) {
    return resultForEntry(entry, false, 'invalid-text')
  }
  const providerBase = cleanString(proposed.provider || entry.selectedProvider || entry.provider || 'source')
  const provider = `human-reviewed-meaning-enrichment:${providerBase}`.slice(0, 180)
  const now = new Date().toISOString()

  if (!options.dryRun) {
    if (!existing) {
      db.prepare(`
        INSERT INTO translation_jobs(candidate_id, source_text, ja_label, ja_meaning, status, provider, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(candidate.candidate_id, candidate.display_tag, jaLabel, jaMeaning, options.status, provider, now, now)
    } else {
      db.prepare(`
        UPDATE translation_jobs
        SET ja_label = ?, ja_meaning = ?, status = ?, provider = ?, updated_at = ?
        WHERE job_id = ?
      `).run(jaLabel, jaMeaning, options.status, provider, now, existing.job_id)
    }
    db.prepare(`
      INSERT INTO meaning_enrichment_decisions(
        candidate_id, canonical_tag, decision, reason, confidence, selected_provider,
        selected_evidence_kind, source_url, ja_label, ja_meaning, applied,
        evidence_json, script_version, generated_at
      ) VALUES (?, ?, 'apply', 'human-review-accepted', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      candidate.candidate_id,
      candidate.canonical_tag,
      Number(entry.confidence ?? entry.decision?.confidence ?? 0),
      cleanString(entry.selectedProvider || entry.decision?.selectedProvider || ''),
      cleanString(entry.selectedEvidenceKind || entry.decision?.selectedEvidenceKind || ''),
      cleanString(entry.sourceUrl || entry.decision?.sourceUrl || ''),
      jaLabel,
      jaMeaning,
      JSON.stringify(entry.evidence || []),
      scriptVersion,
      now
    )
  }

  return {
    canonicalTag: candidate.canonical_tag,
    applied: !options.dryRun,
    reason: options.dryRun ? 'dry-run' : 'applied',
    status: options.status,
    provider
  }
}

function reviewEntryFromResult(result) {
  const decision = result.decision || {}
  if (!isReviewableDecision(decision)) return null
  const proposed = {
    jaLabel: cleanString(decision.jaLabel || result.suggestion?.ja),
    jaMeaning: cleanString(decision.jaMeaning || result.suggestion?.meaning),
    status: 'source-derived',
    provider: cleanString(result.suggestion?.provider || decision.selectedProvider),
    sourceUrl: cleanString(decision.sourceUrl)
  }
  return {
    canonicalTag: cleanString(result.tag),
    candidateId: result.candidateId ?? null,
    decision: decision.decision,
    reason: decision.reason,
    confidence: Number(decision.confidence ?? 0),
    selectedProvider: cleanString(decision.selectedProvider),
    selectedEvidenceKind: cleanString(decision.selectedEvidenceKind),
    sourceUrl: cleanString(decision.sourceUrl),
    evidence: summarizeEvidence(result.evidence),
    proposed,
    review: {
      decision: 'defer',
      jaLabel: proposed.jaLabel,
      jaMeaning: proposed.jaMeaning,
      notes: ''
    }
  }
}

function reviewEntryFromAuditRow(row) {
  const evidence = parseJson(row.evidence_json)
  return {
    canonicalTag: cleanString(row.canonical_tag),
    candidateId: row.candidate_id == null ? null : Number(row.candidate_id),
    decisionId: Number(row.decision_id),
    decision: cleanString(row.decision),
    reason: cleanString(row.reason),
    confidence: Number(row.confidence ?? 0),
    selectedProvider: cleanString(row.selected_provider),
    selectedEvidenceKind: cleanString(row.selected_evidence_kind),
    sourceUrl: cleanString(row.source_url),
    evidence: summarizeEvidence(evidence),
    proposed: {
      jaLabel: cleanString(row.ja_label),
      jaMeaning: cleanString(row.ja_meaning),
      status: 'source-derived',
      provider: cleanString(row.selected_provider),
      sourceUrl: cleanString(row.source_url)
    },
    review: {
      decision: 'defer',
      jaLabel: cleanString(row.ja_label),
      jaMeaning: cleanString(row.ja_meaning),
      notes: ''
    }
  }
}

function reviewDocument(entries, source, options) {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    generator: 'scripts/review-prompt-dictionary-meanings.cjs',
    defaultImportStatus: options.status,
    source,
    entries: entries.slice(0, options.limit)
  }
}

function isReviewableDecision(decision) {
  if (decision.decision === 'preview-only') return true
  return ['low-confidence', 'redirect-only', 'ambiguous-provider-result', 'usage-evidence-only'].includes(decision.reason)
}

function summarizeEvidence(evidence) {
  return Array.isArray(evidence)
    ? evidence.map((item) => ({
        provider: cleanString(item.provider),
        evidenceKind: cleanString(item.evidenceKind),
        confidence: Number(item.confidence ?? 0),
        title: cleanString(item.title),
        summary: cleanString(item.summary),
        sourceUrl: cleanString(item.sourceUrl),
        warnings: Array.isArray(item.warnings) ? item.warnings.map(cleanString).filter(Boolean) : []
      }))
    : []
}

function readReviewDecision(entry) {
  return cleanString(entry.review?.decision || entry.reviewDecision).toLowerCase()
}

function openDb(options) {
  return new DatabaseSync(dbPathForOptions(options))
}

function dbPathForOptions(options) {
  return path.join(path.resolve(projectRoot, options.dataRoot), 'prompt-dictionary', 'ingest.sqlite')
}

function findCandidate(db, canonicalTag, candidateId) {
  if (candidateId > 0) {
    const row = db.prepare('SELECT candidate_id, canonical_tag, display_tag FROM candidate_tags WHERE candidate_id = ?').get(candidateId)
    if (row) return row
  }
  if (!canonicalTag) return null
  return db.prepare('SELECT candidate_id, canonical_tag, display_tag FROM candidate_tags WHERE canonical_tag = ?').get(canonicalTag)
}

function bestTranslationJob(db, candidateId) {
  return db.prepare(`
    SELECT job_id, status
    FROM translation_jobs
    WHERE candidate_id = ?
    ORDER BY
      CASE status
        WHEN 'curated' THEN 1
        WHEN 'source-derived' THEN 2
        WHEN 'machine-draft' THEN 3
        WHEN 'needs-review' THEN 4
        ELSE 5
      END,
      updated_at DESC
    LIMIT 1
  `).get(candidateId)
}

function ensureReviewSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meaning_enrichment_decisions (
      decision_id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER,
      canonical_tag TEXT NOT NULL,
      decision TEXT NOT NULL CHECK(decision IN ('apply', 'skip', 'preview-only', 'provider-error')),
      reason TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      selected_provider TEXT NOT NULL DEFAULT '',
      selected_evidence_kind TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      ja_label TEXT NOT NULL DEFAULT '',
      ja_meaning TEXT NOT NULL DEFAULT '',
      applied INTEGER NOT NULL DEFAULT 0,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      script_version TEXT NOT NULL DEFAULT '',
      generated_at TEXT NOT NULL,
      FOREIGN KEY(candidate_id) REFERENCES candidate_tags(candidate_id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_meaning_enrichment_decisions_tag ON meaning_enrichment_decisions(canonical_tag, generated_at);
  `)
}

function resultForEntry(entry, applied, reason) {
  return {
    canonicalTag: cleanString(entry.canonicalTag || entry.tag),
    applied,
    reason
  }
}

function parseArgs(argv) {
  const options = {
    dataRoot: path.relative(projectRoot, defaultDataRoot),
    dryRun: false,
    exportPath: '',
    force: false,
    fromReport: '',
    importPath: '',
    limit: 100,
    status: 'source-derived'
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--export') options.exportPath = path.resolve(projectRoot, readValue(argv, ++i, arg))
    else if (arg === '--import') options.importPath = path.resolve(projectRoot, readValue(argv, ++i, arg))
    else if (arg === '--from-report') options.fromReport = path.resolve(projectRoot, readValue(argv, ++i, arg))
    else if (arg === '--data-root') options.dataRoot = readValue(argv, ++i, arg)
    else if (arg === '--limit') options.limit = Math.max(1, Number(readValue(argv, ++i, arg)) || 100)
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--force') options.force = true
    else if (arg === '--status') options.status = readStatus(readValue(argv, ++i, arg))
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (options.exportPath && options.importPath) throw new Error('Use only one of --export or --import.')
  return options
}

function readStatus(value) {
  const status = cleanString(value)
  if (!['source-derived', 'machine-draft', 'needs-review'].includes(status)) {
    throw new Error('--status must be source-derived, machine-draft, or needs-review. The review importer never writes curated.')
  }
  return status
}

function readValue(argv, index, flag) {
  const value = argv[index]
  if (!value) throw new Error(`${flag} requires a value`)
  return value
}

function parseJson(value) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value
  } catch {
    return {}
  }
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}
