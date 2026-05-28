const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')

const projectRoot = path.resolve(__dirname, '..')
const scriptPath = path.join(projectRoot, 'scripts', 'enrich-prompt-dictionary-meanings.cjs')
const reviewScriptPath = path.join(projectRoot, 'scripts', 'review-prompt-dictionary-meanings.cjs')
const schemaPath = path.join(projectRoot, 'resources', 'prompt-dictionary', 'ingest-schema.sql')
const fixtureDir = path.join(projectRoot, 'scripts', 'fixtures', 'prompt-dictionary-meanings')
const { providerFamily, retryDelayMs } = require(scriptPath)
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yoitomoshi-meaning-fixtures-'))
const dataRoot = path.join(tempRoot, 'userdata')
const dbDir = path.join(dataRoot, 'prompt-dictionary')
const dbPath = path.join(dbDir, 'ingest.sqlite')
const reportDir = path.join(tempRoot, 'reports')

try {
  setupDb()

  const cases = [
    {
      tag: 'bad_hands',
      provider: 'danbooru',
      expectDecision: 'apply',
      expectReason: 'high-confidence-danbooru-wiki'
    },
    {
      tag: 'kimono',
      provider: 'danbooru',
      expectDecision: 'apply',
      expectReason: 'high-confidence-danbooru-wiki'
    },
    {
      tag: 'newest',
      provider: 'wikidata',
      expectNotDecision: 'apply'
    },
    {
      tag: '1girl',
      provider: 'civitai',
      expectDecision: 'skip',
      expectReason: 'usage-evidence-only'
    }
  ]

  for (const testCase of cases) {
    const output = runEnrich(testCase)
    assert.equal(output.scanned, 1, `${testCase.tag}: scanned count`)
    const result = output.results[0]
    if (testCase.expectDecision) {
      assert.equal(result.decision.decision, testCase.expectDecision, `${testCase.tag}: decision`)
    }
    if (testCase.expectNotDecision) {
      assert.notEqual(result.decision.decision, testCase.expectNotDecision, `${testCase.tag}: decision`)
    }
    if (testCase.expectReason) {
      assert.equal(result.decision.reason, testCase.expectReason, `${testCase.tag}: reason`)
    }
    assert.ok(fs.existsSync(output.reportPath || path.join(reportDir, `${testCase.tag}.json`)), `${testCase.tag}: json report exists`)
  }

  const kimonoApply = runEnrich({ tag: 'kimono', provider: 'danbooru', apply: true, reportName: 'kimono-apply' })
  assert.equal(kimonoApply.applied, 1, 'kimono apply count')
  assert.equal(readTranslation('kimono').status, 'source-derived', 'kimono source-derived status')

  insertCurated('bad_hands', '手の崩れ', '手指の崩れを避けるための手動確認済み説明。')
  const curatedApply = runEnrich({ tag: 'bad_hands', provider: 'danbooru', apply: true, reportName: 'bad-hands-curated-guard' })
  assert.equal(curatedApply.applied, 0, 'curated guard apply count')
  assert.equal(curatedApply.results[0].decision.reason, 'curated-protected', 'curated guard reason')
  assert.equal(readTranslation('bad_hands').ja_meaning, '手指の崩れを避けるための手動確認済み説明。', 'curated meaning unchanged')

  assert.equal(providerFamily('wikidata-search'), 'wikidata', 'wikidata provider family')
  assert.equal(providerFamily('en-wiktionary-definition'), 'wiktionary', 'wiktionary provider family')
  assert.equal(retryDelayMs(mockRetryAfterResponse('2'), 0, 'wikidata'), 2000, 'Retry-After seconds respected')
  const wikimediaFallbackDelay = retryDelayMs(null, 0, 'wikidata')
  assert.ok(wikimediaFallbackDelay >= 5000 && wikimediaFallbackDelay < 5300, 'Wikimedia fallback retry delay uses 5s base')

  const breaker = runEnrich({
    tags: ['style', 'hands'],
    provider: 'wikidata',
    maxErrorsPerProvider: 1,
    reportName: 'wikidata-provider-breaker'
  })
  assert.equal(breaker.counters.providerErrors, 1, 'provider breaker error count')
  assert.equal(breaker.counters.providerDisabled, 1, 'provider breaker disabled count')
  assert.equal(breaker.providerErrorCounts.wikidata, 1, 'provider family error count')
  assert.equal(breaker.results[0].evidence[0].evidenceKind, 'provider-error', 'first missing wikidata fixture is provider error')
  assert.equal(breaker.results[1].evidence[0].evidenceKind, 'provider-disabled', 'second wikidata lookup is disabled')

  const handsPreview = runEnrich({ tag: 'hands', provider: 'wikidata', reportName: 'hands-wikidata-preview' })
  assert.equal(handsPreview.results[0].decision.decision, 'preview-only', 'hands review preview decision')
  assert.equal(handsPreview.results[0].decision.reason, 'low-confidence', 'hands review preview reason')
  const reviewPath = exportReviewFromReport(handsPreview.reportPath, 'hands-review.json')
  acceptFirstReviewEntry(reviewPath, {
    jaLabel: '手',
    jaMeaning: '手。画像生成では手や指の見た目・ポーズを指定するタグ候補。'
  })
  const reviewImport = importReview(reviewPath)
  assert.equal(reviewImport.applied, 1, 'review import apply count')
  const handsTranslation = readTranslation('hands')
  assert.equal(handsTranslation.status, 'source-derived', 'review import status is source-derived')
  assert.notEqual(handsTranslation.status, 'curated', 'review import never writes curated')
  assert.match(handsTranslation.provider, /^human-reviewed-meaning-enrichment:/, 'review import provider marker')

  console.log(`prompt dictionary meaning fixture tests passed: ${cases.length} dry-run cases, 2 apply smoke checks, provider policy checks, review round-trip`)
} finally {
  cleanupTempRoot()
}

function setupDb() {
  fs.mkdirSync(dbDir, { recursive: true })
  fs.mkdirSync(reportDir, { recursive: true })
  const db = new DatabaseSync(dbPath)
  try {
    db.exec(fs.readFileSync(schemaPath, 'utf8'))
    insertCandidate(db, 'bad_hands', 'bad_hands', 'negative', 0, 12)
    insertCandidate(db, 'kimono', 'kimono', 'tag', 12, 0)
    insertCandidate(db, 'newest', 'newest', 'quality', 8, 0)
    insertCandidate(db, '1girl', '1girl', 'tag', 25, 0)
    insertCandidate(db, 'style', 'style', 'tag', 10, 0)
    insertCandidate(db, 'hands', 'hands', 'tag', 14, 0)
  } finally {
    db.close()
  }
}

function insertCandidate(db, canonicalTag, displayTag, tokenKind, positiveCount, negativeCount) {
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO candidate_tags(
      canonical_tag, display_tag, token_kind, positive_count, negative_count,
      source_count, evidence_count, confidence, adult_level, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, 0.9, 0, 'new', ?, ?)
  `).run(canonicalTag, displayTag, tokenKind, positiveCount, negativeCount, positiveCount + negativeCount, now, now)
}

function runEnrich(testCase) {
  const reportPath = path.join(reportDir, `${testCase.reportName || testCase.tag || 'multi-tag'}.json`)
  const args = [
    '--no-warnings',
    scriptPath,
    '--data-root', dataRoot,
    '--fixture-dir', fixtureDir,
    '--no-network',
    '--provider', testCase.provider,
    testCase.apply ? '--apply' : '--dry-run',
    '--json-out', reportPath
  ]
  for (const tag of testCase.tags || [testCase.tag]) {
    args.push('--tag', tag)
  }
  if (testCase.maxErrorsPerProvider) {
    args.push('--max-errors-per-provider', String(testCase.maxErrorsPerProvider))
  }
  const stdout = execFileSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1'
    }
  })
  const parsed = JSON.parse(stdout)
  parsed.reportPath = reportPath
  return parsed
}

function exportReviewFromReport(reportPath, fileName) {
  const exportPath = path.join(reportDir, fileName)
  const stdout = execFileSync(process.execPath, [
    '--no-warnings',
    reviewScriptPath,
    '--data-root', dataRoot,
    '--from-report', reportPath,
    '--export', exportPath
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1'
    }
  })
  const parsed = JSON.parse(stdout)
  assert.equal(parsed.entries, 1, 'review export entries')
  assert.ok(fs.existsSync(exportPath), 'review export file exists')
  return exportPath
}

function acceptFirstReviewEntry(reviewPath, override) {
  const parsed = JSON.parse(fs.readFileSync(reviewPath, 'utf8'))
  assert.equal(parsed.entries.length, 1, 'review file entry count')
  parsed.entries[0].review.decision = 'accept'
  parsed.entries[0].review.jaLabel = override.jaLabel
  parsed.entries[0].review.jaMeaning = override.jaMeaning
  fs.writeFileSync(reviewPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
}

function importReview(reviewPath) {
  const stdout = execFileSync(process.execPath, [
    '--no-warnings',
    reviewScriptPath,
    '--data-root', dataRoot,
    '--import', reviewPath
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1'
    }
  })
  return JSON.parse(stdout)
}

function mockRetryAfterResponse(value) {
  return {
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'retry-after' ? value : null
      }
    }
  }
}

function insertCurated(canonicalTag, jaLabel, jaMeaning) {
  const now = new Date().toISOString()
  const db = new DatabaseSync(dbPath)
  try {
    const row = db.prepare('SELECT candidate_id FROM candidate_tags WHERE canonical_tag = ?').get(canonicalTag)
    assert.ok(row?.candidate_id, `${canonicalTag}: candidate exists`)
    db.prepare(`
      INSERT INTO translation_jobs(candidate_id, source_text, ja_label, ja_meaning, status, provider, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'curated', 'fixture-curator', ?, ?)
    `).run(row.candidate_id, canonicalTag, jaLabel, jaMeaning, now, now)
  } finally {
    db.close()
  }
}

function readTranslation(canonicalTag) {
  const db = new DatabaseSync(dbPath)
  try {
    return db.prepare(`
      SELECT t.ja_label, t.ja_meaning, t.status, t.provider
      FROM translation_jobs t
      JOIN candidate_tags c ON c.candidate_id = t.candidate_id
      WHERE c.canonical_tag = ?
      ORDER BY
        CASE t.status
          WHEN 'curated' THEN 1
          WHEN 'source-derived' THEN 2
          WHEN 'machine-draft' THEN 3
          WHEN 'needs-review' THEN 4
          ELSE 5
        END,
        t.updated_at DESC
      LIMIT 1
    `).get(canonicalTag)
  } finally {
    db.close()
  }
}

function cleanupTempRoot() {
  const resolvedTempRoot = path.resolve(tempRoot)
  const resolvedOsTemp = path.resolve(os.tmpdir())
  if (resolvedTempRoot.startsWith(resolvedOsTemp) && path.basename(resolvedTempRoot).startsWith('yoitomoshi-meaning-fixtures-')) {
    fs.rmSync(resolvedTempRoot, { recursive: true, force: true })
  }
}
