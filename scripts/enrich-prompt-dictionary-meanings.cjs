const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { curatePromptDictionaryJapanese } = require('./prompt-dictionary-ja-curation.cjs')

const projectRoot = path.resolve(__dirname, '..')
const defaultDataRoot = path.join(projectRoot, 'userdata')
const defaultFixtureDir = path.join(projectRoot, 'scripts', 'fixtures', 'prompt-dictionary-meanings')
const defaultProviders = ['danbooru', 'wikidata', 'wiktionary', 'civitai']
const providerOrder = new Map(defaultProviders.map((provider, index) => [provider, index]))
const userAgent = 'Yoitomoshi-Art-Generator/0.1 prompt-dictionary-enrichment contact:local'
const scriptVersion = 'prompt-meaning-enrichment-v2-20260526'
const previewConfidence = 0.7

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

module.exports = {
  buildDecision,
  buildSuggestion,
  chooseWikidataMatch,
  normalizeTag,
  parseArgs,
  providerFamily,
  retryDelayMs,
  scoreWikidataMatch
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const dataRoot = path.resolve(projectRoot, options.dataRoot)
  const dbPath = path.join(dataRoot, 'prompt-dictionary', 'ingest.sqlite')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  const db = new DatabaseSync(dbPath)
  let inTransaction = false
  try {
    ensureMeaningLookupSchema(db)
    const candidates = options.tags.length > 0
      ? options.tags.map((tag) => candidateForTag(db, tag)).filter(Boolean)
      : selectCandidates(db, options.limit)
    const results = []

    if (options.apply) {
      db.exec('BEGIN IMMEDIATE')
      inTransaction = true
    }

    for (const candidate of candidates) {
      const result = await enrichCandidate(db, candidate, options)
      if (options.apply && result.decision.decision === 'apply' && result.suggestion && candidate.candidateId) {
        result.applied = applySuggestion(db, candidate, result.suggestion, options)
      } else {
        result.applied = false
      }
      if (options.apply || options.writeCache) {
        writeDecisionAudit(db, candidate, result, result.applied)
      }
      results.push(result)
    }

    if (inTransaction) {
      db.exec('COMMIT')
      inTransaction = false
    }

    const output = buildRunOutput(dbPath, candidates, results, options)
    if (options.jsonOut) {
      fs.mkdirSync(path.dirname(options.jsonOut), { recursive: true })
      fs.writeFileSync(options.jsonOut, `${JSON.stringify(output, null, 2)}\n`)
    }
    console.log(JSON.stringify(output, null, 2))
  } catch (error) {
    if (inTransaction) {
      try {
        db.exec('ROLLBACK')
      } catch (rollbackError) {
        error.message = `${error.message}; rollback failed: ${rollbackError.message}`
      }
    }
    throw error
  } finally {
    db.close()
  }
}

async function enrichCandidate(db, candidate, options) {
  const evidence = []
  for (const provider of options.providers) {
    const lookup = await lookupProvider(db, provider, candidate, options)
    if (lookup) evidence.push(lookup)
    if (!options.noNetwork) await sleep(options.rateLimitMs)
  }
  evidence.sort((a, b) => b.confidence - a.confidence || providerRank(a.provider) - providerRank(b.provider))
  const decision = buildDecision(candidate, evidence, options)
  const suggestion = buildSuggestion(candidate, decision)
  const publicDecision = serializeDecision(decision, suggestion)
  return {
    tag: candidate.displayTag,
    candidateId: candidate.candidateId || null,
    current: {
      ja: candidate.jaLabel,
      meaning: candidate.jaMeaning,
      status: candidate.status,
      provider: candidate.provider
    },
    evidence: evidence.map(serializeEvidence),
    decision: publicDecision,
    suggestion
  }
}

async function lookupProvider(db, provider, candidate, options) {
  if (options.disabledProviders.has(provider)) {
    options.stats.providerDisabled += 1
    return providerDisabledEvidence(provider, candidate)
  }
  try {
    if (provider === 'danbooru') return lookupDanbooru(db, candidate, options)
    if (provider === 'wikidata') return lookupWikidata(db, candidate, options)
    if (provider === 'wiktionary') return lookupWiktionary(db, candidate, options)
    if (provider === 'civitai') return lookupCivitai(db, candidate, options)
    return null
  } catch (error) {
    markProviderError(options, provider, error.message)
    return providerErrorEvidence(provider, candidate, error.message)
  }
}

async function lookupDanbooru(db, candidate, options) {
  const tag = candidate.canonicalTag
  const tagUrl = `https://danbooru.donmai.us/tags.json?search[name_normalize]=${encodeURIComponent(tag)}&limit=1`
  const tagJson = await fetchCachedJson(db, tag, 'danbooru-tags', tag, tagUrl, options)
  const tagRecord = tagJson.ok && Array.isArray(tagJson.payload)
    ? tagJson.payload.find((entry) => normalizeTag(entry.name) === tag)
    : null

  const wikiUrl = `https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(tag)}.json`
  const wikiJson = await fetchCachedJson(db, tag, 'danbooru-wiki', tag, wikiUrl, options)
  const wikiBody = wikiJson.ok && wikiJson.payload?.body ? cleanDtext(wikiJson.payload.body) : ''
  if (tagJson.error && wikiJson.error) return providerErrorEvidence('danbooru', candidate, `${tagJson.error}; ${wikiJson.error}`)
  if (!tagRecord && !wikiBody) return null

  const categoryName = danbooruCategoryName(tagRecord?.category)
  const wikiRedirect = /^see\s+/i.test(wikiBody)
  const evidenceKind = wikiBody ? (wikiRedirect ? 'redirect-wiki' : 'exact-wiki') : 'tag-only'
  const warnings = []
  if (wikiRedirect) warnings.push('redirect-only')

  return {
    provider: 'danbooru',
    providerKey: tag,
    evidenceKind,
    sourceUrl: wikiBody ? wikiUrl.replace(/\.json$/, '') : tagUrl,
    confidence: wikiBody ? (wikiRedirect ? 0.55 : 0.92) : 0.58,
    title: wikiJson.payload?.title || tagRecord?.name || tag,
    category: categoryName,
    postCount: Number(tagRecord?.post_count ?? 0),
    summary: wikiBody ? firstSentence(wikiBody, 280) : `${categoryName} tag with ${Number(tagRecord?.post_count ?? 0)} posts.`,
    warnings,
    payloadHash: hashPayload({
      tag: tagJson.payloadHash,
      wiki: wikiJson.payloadHash
    })
  }
}

async function lookupWikidata(db, candidate, options) {
  const term = humanizeEnglish(candidate.canonicalTag)
  if (!shouldLookupKnowledgeTerm(term)) return null
  const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(term)}&language=en&uselang=en&format=json&limit=5`
  const searchJson = await fetchCachedJson(db, candidate.canonicalTag, 'wikidata-search', term, searchUrl, options)
  if (searchJson.error) return providerErrorEvidence('wikidata', candidate, searchJson.error)
  const match = Array.isArray(searchJson.payload?.search)
    ? chooseWikidataMatch(term, searchJson.payload.search)
    : null
  if (!match?.id) return null

  const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(match.id)}&props=labels|descriptions|aliases&languages=ja|en&format=json`
  const entityJson = await fetchCachedJson(db, candidate.canonicalTag, 'wikidata-entity', match.id, entityUrl, options)
  if (entityJson.error) return providerErrorEvidence('wikidata', candidate, entityJson.error)
  const entity = entityJson.payload?.entities?.[match.id]
  const jaLabel = cleanString(entity?.labels?.ja?.value)
  const enLabel = cleanString(entity?.labels?.en?.value || match.label)
  const jaDescription = cleanString(entity?.descriptions?.ja?.value)
  const enDescription = cleanString(entity?.descriptions?.en?.value || match.description)
  if (!jaLabel && !jaDescription && !enDescription) return null

  const warnings = []
  let confidence = jaDescription ? 0.74 : 0.62
  if (isLikelyWikidataWork(`${match.description || ''} ${enDescription}`)) {
    confidence = 0.2
    warnings.push('ambiguous-provider-result')
  }

  return {
    provider: 'wikidata',
    providerKey: match.id,
    evidenceKind: 'wikidata-entity',
    sourceUrl: `https://www.wikidata.org/wiki/${match.id}`,
    confidence,
    title: jaLabel || enLabel || term,
    summary: jaDescription || enDescription,
    jaLabel,
    enLabel,
    entityId: match.id,
    warnings,
    payloadHash: hashPayload({
      search: searchJson.payloadHash,
      entity: entityJson.payloadHash
    })
  }
}

async function lookupWiktionary(db, candidate, options) {
  const term = humanizeEnglish(candidate.canonicalTag)
  if (!shouldLookupDictionaryTerm(term)) return null
  const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(term)}`
  const json = await fetchCachedJson(db, candidate.canonicalTag, 'en-wiktionary-definition', term, url, options)
  if (json.error) return providerErrorEvidence('wiktionary', candidate, json.error)
  const definitions = Array.isArray(json.payload?.en) ? json.payload.en : []
  const noun = definitions.find((entry) => /noun|adjective|verb/i.test(entry.partOfSpeech || '')) || definitions[0]
  const rawDefinition = noun?.definitions?.find((entry) => cleanHtml(entry.definition))?.definition
  const definition = cleanHtml(rawDefinition)
  if (!definition) return null
  return {
    provider: 'wiktionary',
    providerKey: term,
    evidenceKind: 'dictionary-definition',
    sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(term)}`,
    confidence: 0.48,
    title: term,
    partOfSpeech: noun?.partOfSpeech || '',
    summary: firstSentence(definition, 240),
    warnings: [],
    payloadHash: json.payloadHash
  }
}

async function lookupCivitai(db, candidate, options) {
  const term = humanizeEnglish(candidate.canonicalTag)
  if (!term || term.length < 2) return null
  const url = `https://civitai.com/api/v1/tags?query=${encodeURIComponent(term)}&limit=5`
  const json = await fetchCachedJson(db, candidate.canonicalTag, 'civitai-tags', term, url, options)
  if (json.error) return providerErrorEvidence('civitai', candidate, json.error)
  const items = Array.isArray(json.payload?.items) ? json.payload.items : []
  const match = items.find((item) => normalizeLoose(item.name) === normalizeLoose(term))
    || items.find((item) => normalizeLoose(item.name).includes(normalizeLoose(term)))
  if (!match) return null
  return {
    provider: 'civitai',
    providerKey: term,
    evidenceKind: 'usage-only',
    sourceUrl: match.link || url,
    confidence: 0.35,
    title: match.name,
    modelCount: Number(match.modelCount ?? 0),
    summary: `Civitai model tag with ${Number(match.modelCount ?? 0)} linked models.`,
    warnings: ['usage-evidence-only'],
    payloadHash: json.payloadHash
  }
}

function buildDecision(candidate, evidence, options = {}) {
  const minConfidence = Number(options.minConfidence ?? 0.8)
  const usableEvidence = evidence
    .filter((item) => item && !['provider-error', 'provider-disabled'].includes(item.evidenceKind))
    .sort((a, b) => b.confidence - a.confidence || providerRank(a.provider) - providerRank(b.provider))
  const providerFailures = evidence.filter((item) => item && item.evidenceKind === 'provider-error')
  const selected = usableEvidence[0] ?? null
  const base = {
    decision: 'skip',
    reason: 'no-candidate',
    confidence: selected?.confidence ?? 0,
    selectedProvider: selected?.provider ?? '',
    selectedEvidenceKind: selected?.evidenceKind ?? '',
    sourceUrl: selected?.sourceUrl ?? '',
    warnings: selected?.warnings ? [...selected.warnings] : [],
    selectedEvidence: selected
  }

  if (!candidate.candidateId) {
    return {
      ...base,
      decision: selected ? 'preview-only' : 'skip',
      reason: 'no-candidate'
    }
  }
  if (candidate.status === 'curated' && !options.force) {
    return {
      ...base,
      decision: 'skip',
      reason: 'curated-protected'
    }
  }
  if (!selected) {
    if (providerFailures.length > 0) {
      return {
        ...base,
        decision: 'provider-error',
        reason: 'provider-error',
        warnings: providerFailures.map((item) => item.summary).filter(Boolean)
      }
    }
    return {
      ...base,
      decision: 'skip',
      reason: 'no-candidate'
    }
  }
  if (selected.evidenceKind === 'usage-only') {
    return {
      ...base,
      decision: 'skip',
      reason: 'usage-evidence-only'
    }
  }
  if (selected.warnings?.includes('ambiguous-provider-result')) {
    return {
      ...base,
      decision: 'skip',
      reason: 'ambiguous-provider-result'
    }
  }
  if (selected.evidenceKind === 'redirect-wiki') {
    return {
      ...base,
      decision: selected.confidence >= previewConfidence ? 'preview-only' : 'skip',
      reason: 'redirect-only'
    }
  }
  if (selected.confidence >= minConfidence) {
    return {
      ...base,
      decision: 'apply',
      reason: reasonForHighConfidence(selected)
    }
  }
  if (selected.confidence >= previewConfidence) {
    return {
      ...base,
      decision: 'preview-only',
      reason: 'low-confidence'
    }
  }
  return {
    ...base,
    decision: 'skip',
    reason: 'low-confidence'
  }
}

function buildSuggestion(candidate, decision) {
  const source = decision?.selectedEvidence
  if (!source || !['apply', 'preview-only'].includes(decision.decision)) return null
  if (source.evidenceKind === 'usage-only' || source.provider === 'civitai') return null

  const polarity = candidate.tokenKind === 'negative' || candidate.negativeCount > candidate.positiveCount ? 'negative' : 'positive'
  const curated = curatePromptDictionaryJapanese(candidate.displayTag, {
    ja: candidate.jaLabel,
    meaning: candidate.jaMeaning,
    category: '',
    group: '',
    polarity,
    status: candidate.status,
    provider: candidate.provider
  })
  let ja = curated.ja
  if (source.jaLabel && shouldReplaceLabel(ja, candidate.canonicalTag)) ja = source.jaLabel
  let meaning = curated.meaning
  let status = curated.status || 'machine-draft'
  let provider = curated.provider || 'yoitomoshi-codex-ja-curation-v1'
  if (source.provider === 'danbooru') {
    meaning = meaningFromDanbooru(candidate, ja, source)
    status = 'source-derived'
    provider = 'danbooru-metadata+yoitomoshi-codex-ja-curation-v1'
  } else if (source.provider === 'wikidata') {
    meaning = `${ja}。${source.summary}。画像生成では関連する見た目・対象を指定するタグ候補。`
    status = 'source-derived'
    provider = 'wikidata+yoitomoshi-codex-ja-curation-v1'
  } else if (source.provider === 'wiktionary') {
    meaning = `${ja}。英語辞書で確認できる一般語。画像生成では関連する見た目・状態・対象を指定するタグ候補。`
    status = 'source-derived'
    provider = 'wiktionary+yoitomoshi-codex-ja-curation-v1'
  }
  const changed = ja !== candidate.jaLabel || meaning !== candidate.jaMeaning || provider !== candidate.provider
  return changed ? {
    ja,
    meaning,
    status,
    provider,
    confidence: source.confidence ?? 0.4,
    sourceUrl: source.sourceUrl ?? '',
    reason: decision.reason
  } : null
}

function meaningFromDanbooru(candidate, ja, source) {
  const category = source.category ? `${source.category}カテゴリ` : 'Danbooru系'
  if (candidate.tokenKind === 'negative' || candidate.negativeCount > candidate.positiveCount || /^bad[_\s-]/i.test(candidate.canonicalTag)) {
    return `${ja}を避けるためのネガティブプロンプト。${category}のタグ情報をもとにした自動ドラフト。`
  }
  if (source.category === 'artist') return `${ja}に関連する作家/画風タグ。Danbooruタグ情報をもとにした自動ドラフト。`
  if (source.category === 'character') return `${ja}に関連するキャラクタータグ。Danbooruタグ情報をもとにした自動ドラフト。`
  if (source.category === 'copyright') return `${ja}に関連する作品・シリーズタグ。Danbooruタグ情報をもとにした自動ドラフト。`
  if (source.category === 'meta') return `${ja}の画面状態やメタ情報を指定するタグ。Danbooruタグ情報をもとにした自動ドラフト。`
  return `${ja}を表す生成用タグ。${category}のタグ情報をもとにした自動ドラフト。`
}

function applySuggestion(db, candidate, suggestion, options) {
  const now = new Date().toISOString()
  const existing = db.prepare(`
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
  `).get(candidate.candidateId)
  if (existing?.status === 'curated' && !options.force) return false
  if (!existing) {
    db.prepare(`
      INSERT INTO translation_jobs(candidate_id, source_text, ja_label, ja_meaning, status, provider, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(candidate.candidateId, candidate.displayTag, suggestion.ja, suggestion.meaning, suggestion.status, suggestion.provider, now, now)
    return true
  }
  db.prepare(`
    UPDATE translation_jobs
    SET ja_label = ?, ja_meaning = ?, status = ?, provider = ?, updated_at = ?
    WHERE job_id = ?
  `).run(suggestion.ja, suggestion.meaning, suggestion.status, suggestion.provider, now, existing.job_id)
  return true
}

function writeDecisionAudit(db, candidate, result, applied) {
  const decision = result.decision
  const suggestion = result.suggestion
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO meaning_enrichment_decisions(
      candidate_id, canonical_tag, decision, reason, confidence, selected_provider,
      selected_evidence_kind, source_url, ja_label, ja_meaning, applied,
      evidence_json, script_version, generated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    candidate.candidateId || null,
    candidate.canonicalTag,
    decision.decision,
    decision.reason,
    decision.confidence,
    decision.selectedProvider,
    decision.selectedEvidenceKind,
    decision.sourceUrl,
    suggestion?.ja || '',
    suggestion?.meaning || '',
    applied ? 1 : 0,
    JSON.stringify(result.evidence),
    scriptVersion,
    now
  )
}

async function fetchCachedJson(db, canonicalTag, provider, providerKey, url, options) {
  const family = providerFamily(provider)
  const fixture = loadFixtureJson(provider, providerKey, options)
  if (fixture.found) {
    options.stats.fixtureHits += 1
    return {
      ok: true,
      payload: fixture.payload,
      sourceUrl: url,
      lookupStatus: 'found',
      fixture: true,
      payloadHash: hashPayload(fixture.payload)
    }
  }
  if (options.noNetwork) {
    const message = `fixture missing for ${provider}/${sanitizeFixtureKey(providerKey)}.json`
    markProviderError(options, family, message)
    return {
      ok: false,
      payload: {},
      sourceUrl: url,
      lookupStatus: 'failed',
      error: message,
      payloadHash: ''
    }
  }

  const cached = db.prepare(`
    SELECT lookup_status, payload_json, summary_text, confidence, source_url
    FROM meaning_lookup_cache
    WHERE canonical_tag = ? AND provider = ? AND provider_key = ?
  `).get(canonicalTag, provider, providerKey)
  if (cached && !options.refresh) {
    options.stats.cacheHits += 1
    const payload = parseJson(cached.payload_json)
    return {
      ok: cached.lookup_status === 'found',
      payload,
      sourceUrl: cached.source_url,
      summary: cached.summary_text,
      confidence: Number(cached.confidence ?? 0),
      lookupStatus: cached.lookup_status,
      error: cached.lookup_status === 'failed' ? cached.summary_text : '',
      payloadHash: hashPayload(payload)
    }
  }

  const now = new Date().toISOString()
  const fetched = await fetchJsonWithPolicy(family, url, options)
  if (fetched.providerError) markProviderError(options, family, fetched.error)
  const status = fetched.ok ? 'found' : (fetched.providerError ? 'failed' : 'not-found')
  if (options.apply || options.writeCache) {
    options.stats.cacheWrites += 1
    db.prepare(`
      INSERT INTO meaning_lookup_cache(canonical_tag, provider, provider_key, source_url, lookup_status, confidence, summary_text, payload_json, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(canonical_tag, provider, provider_key) DO UPDATE SET
        source_url = excluded.source_url,
        lookup_status = excluded.lookup_status,
        confidence = excluded.confidence,
        summary_text = excluded.summary_text,
        payload_json = excluded.payload_json,
        fetched_at = excluded.fetched_at
    `).run(canonicalTag, provider, providerKey, url, status, fetched.ok ? 0.5 : 0, fetched.error || '', JSON.stringify(fetched.payload), now)
  }
  return {
    ok: fetched.ok,
    payload: fetched.payload,
    sourceUrl: url,
    lookupStatus: status,
    error: fetched.providerError ? fetched.error : '',
    statusCode: fetched.statusCode,
    payloadHash: hashPayload(fetched.payload)
  }
}

async function fetchJsonWithPolicy(provider, url, options) {
  let lastError = ''
  for (let attempt = 0; attempt <= options.retry; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': userAgent,
          'Api-User-Agent': userAgent,
          Accept: 'application/json'
        },
        signal: AbortSignal.timeout(options.timeoutMs)
      })
      const text = await response.text()
      const payload = parseJson(text)
      if (response.ok) {
        return { ok: true, payload, statusCode: response.status, error: '' }
      }
      lastError = `HTTP ${response.status} ${response.statusText}`.trim()
      if (!isTransientStatus(response.status) || attempt >= options.retry) {
        return {
          ok: false,
          payload,
          statusCode: response.status,
          error: lastError,
          providerError: isTransientStatus(response.status)
        }
      }
      await sleep(retryDelayMs(response, attempt, provider))
    } catch (error) {
      lastError = error.message
      if (attempt >= options.retry) {
        return {
          ok: false,
          payload: {},
          statusCode: 0,
          error: lastError,
          providerError: true
        }
      }
      await sleep(retryDelayMs(null, attempt, provider))
    }
  }
  return {
    ok: false,
    payload: {},
    statusCode: 0,
    error: lastError || 'fetch failed',
    providerError: true
  }
}

function selectCandidates(db, limit) {
  return db.prepare(`
    SELECT
      c.candidate_id,
      c.canonical_tag,
      c.display_tag,
      c.token_kind,
      c.positive_count,
      c.negative_count,
      c.evidence_count,
      COALESCE(t.ja_label, '') AS ja_label,
      COALESCE(t.ja_meaning, '') AS ja_meaning,
      COALESCE(t.status, 'needs-review') AS status,
      COALESCE(t.provider, '') AS provider
    FROM candidate_tags c
    LEFT JOIN translation_jobs t ON t.job_id = (
      SELECT job_id
      FROM translation_jobs
      WHERE candidate_id = c.candidate_id
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
    )
    WHERE c.adult_level = 0
      AND c.token_kind IN ('tag', 'phrase', 'quality', 'negative')
      AND c.status IN ('new', 'needs-review', 'accepted', 'promoted')
      AND (
        t.job_id IS NULL
        OR TRIM(t.ja_meaning) = ''
        OR t.status IN ('needs-review', 'machine-draft')
        OR t.provider LIKE 'yoitomoshi-%'
      )
    ORDER BY c.evidence_count DESC, c.confidence DESC, c.canonical_tag ASC
    LIMIT ?
  `).all(limit * 10)
    .map(rowToCandidate)
    .filter(isLookupEligibleCandidate)
    .slice(0, limit)
}

function candidateForTag(db, rawTag) {
  const canonical = normalizeTag(rawTag)
  if (!canonical) return null
  const row = db.prepare(`
    SELECT
      c.candidate_id,
      c.canonical_tag,
      c.display_tag,
      c.token_kind,
      c.positive_count,
      c.negative_count,
      c.evidence_count,
      COALESCE(t.ja_label, '') AS ja_label,
      COALESCE(t.ja_meaning, '') AS ja_meaning,
      COALESCE(t.status, 'needs-review') AS status,
      COALESCE(t.provider, '') AS provider
    FROM candidate_tags c
    LEFT JOIN translation_jobs t ON t.job_id = (
      SELECT job_id FROM translation_jobs WHERE candidate_id = c.candidate_id ORDER BY updated_at DESC LIMIT 1
    )
    WHERE c.canonical_tag = ? OR lower(replace(replace(c.display_tag, ' ', '_'), '-', '_')) = ?
    LIMIT 1
  `).get(canonical, canonical)
  if (row) return rowToCandidate(row)
  return {
    candidateId: 0,
    canonicalTag: canonical,
    displayTag: cleanString(rawTag),
    tokenKind: inferTokenKind(canonical),
    positiveCount: 1,
    negativeCount: 0,
    evidenceCount: 0,
    jaLabel: '',
    jaMeaning: '',
    status: 'needs-review',
    provider: ''
  }
}

function rowToCandidate(row) {
  return {
    candidateId: Number(row.candidate_id ?? 0),
    canonicalTag: String(row.canonical_tag || '').trim(),
    displayTag: String(row.display_tag || row.canonical_tag || '').trim(),
    tokenKind: String(row.token_kind || 'tag'),
    positiveCount: Number(row.positive_count ?? 0),
    negativeCount: Number(row.negative_count ?? 0),
    evidenceCount: Number(row.evidence_count ?? 0),
    jaLabel: String(row.ja_label || '').trim(),
    jaMeaning: String(row.ja_meaning || '').trim(),
    status: String(row.status || 'needs-review'),
    provider: String(row.provider || '').trim()
  }
}

function ensureMeaningLookupSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meaning_lookup_cache (
      cache_id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_tag TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_key TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      lookup_status TEXT NOT NULL DEFAULT 'found' CHECK(lookup_status IN ('found', 'not-found', 'failed')),
      confidence REAL NOT NULL DEFAULT 0,
      summary_text TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      fetched_at TEXT NOT NULL,
      UNIQUE(canonical_tag, provider, provider_key)
    );
    CREATE INDEX IF NOT EXISTS idx_meaning_lookup_cache_tag ON meaning_lookup_cache(canonical_tag, provider);

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

function parseArgs(args) {
  const options = {
    apply: false,
    dataRoot: path.relative(projectRoot, defaultDataRoot),
    disabledProviders: new Set(),
    fixtureDir: '',
    force: false,
    jsonOut: '',
    limit: 25,
    maxErrorsPerProvider: 5,
    minConfidence: 0.8,
    noNetwork: false,
    providerErrorCounts: new Map(),
    providers: [...defaultProviders],
    rateLimitMs: 1200,
    refresh: false,
    retry: 2,
    stats: {
      cacheHits: 0,
      cacheWrites: 0,
      fixtureHits: 0,
      providerDisabled: 0,
      providerErrors: 0
    },
    tags: [],
    timeoutMs: 8000,
    writeCache: false
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--apply') options.apply = true
    else if (arg === '--dry-run') options.apply = false
    else if (arg === '--force') options.force = true
    else if (arg === '--refresh') options.refresh = true
    else if (arg === '--write-cache') options.writeCache = true
    else if (arg === '--no-network') options.noNetwork = true
    else if (arg === '--tag') options.tags.push(readValue(args, ++index, '--tag'))
    else if (arg === '--limit') options.limit = Math.max(1, Number(readValue(args, ++index, '--limit')) || 25)
    else if (arg === '--rate-limit-ms') options.rateLimitMs = Math.max(0, Number(readValue(args, ++index, '--rate-limit-ms')) || 0)
    else if (arg === '--timeout-ms') options.timeoutMs = Math.max(1000, Number(readValue(args, ++index, '--timeout-ms')) || 8000)
    else if (arg === '--retry') options.retry = Math.max(0, Number(readValue(args, ++index, '--retry')) || 0)
    else if (arg === '--max-errors-per-provider') options.maxErrorsPerProvider = Math.max(1, Number(readValue(args, ++index, '--max-errors-per-provider')) || 5)
    else if (arg === '--min-confidence') options.minConfidence = clampConfidence(readValue(args, ++index, '--min-confidence'))
    else if (arg === '--json-out') options.jsonOut = path.resolve(projectRoot, readValue(args, ++index, '--json-out'))
    else if (arg === '--fixture-dir') options.fixtureDir = path.resolve(projectRoot, readValue(args, ++index, '--fixture-dir'))
    else if (arg === '--data-root') options.dataRoot = readValue(args, ++index, '--data-root')
    else if (arg === '--provider') {
      options.providers = readValue(args, ++index, '--provider')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => defaultProviders.includes(value))
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (options.providers.length === 0) options.providers = [...defaultProviders]
  if (options.noNetwork && !options.fixtureDir) options.fixtureDir = defaultFixtureDir
  return options
}

function buildRunOutput(dbPath, candidates, results, options) {
  return {
    dryRun: !options.apply,
    dbPath,
    scanned: candidates.length,
    applied: results.filter((result) => result.applied).length,
    providers: options.providers,
    minConfidence: options.minConfidence,
    noNetwork: options.noNetwork,
    fixtureDir: options.noNetwork ? options.fixtureDir : undefined,
    counters: {
      applied: results.filter((result) => result.applied).length,
      previewOnly: countDecision(results, 'preview-only'),
      skippedLowConfidence: countReason(results, 'low-confidence'),
      skippedCurated: countReason(results, 'curated-protected'),
      skippedAmbiguous: countReason(results, 'ambiguous-provider-result'),
      skippedUsageOnly: countReason(results, 'usage-evidence-only'),
      providerErrors: options.stats.providerErrors,
      providerDisabled: options.stats.providerDisabled,
      cacheHits: options.stats.cacheHits,
      cacheWrites: options.stats.cacheWrites,
      fixtureHits: options.stats.fixtureHits
    },
    providerErrorCounts: Object.fromEntries(options.providerErrorCounts),
    results
  }
}

function serializeDecision(decision, suggestion) {
  return {
    decision: decision.decision,
    reason: decision.reason,
    confidence: Number(decision.confidence ?? 0),
    selectedProvider: decision.selectedProvider,
    selectedEvidenceKind: decision.selectedEvidenceKind,
    sourceUrl: decision.sourceUrl,
    jaLabel: suggestion?.ja || '',
    jaMeaning: suggestion?.meaning || '',
    warnings: decision.warnings || []
  }
}

function serializeEvidence(evidence) {
  return {
    provider: evidence.provider,
    providerKey: evidence.providerKey || '',
    evidenceKind: evidence.evidenceKind || '',
    sourceUrl: evidence.sourceUrl || '',
    confidence: Number(evidence.confidence ?? 0),
    title: evidence.title || '',
    summary: evidence.summary || '',
    category: evidence.category || '',
    postCount: Number(evidence.postCount ?? 0),
    modelCount: Number(evidence.modelCount ?? 0),
    entityId: evidence.entityId || '',
    payloadHash: evidence.payloadHash || '',
    warnings: evidence.warnings || []
  }
}

function readValue(args, index, flag) {
  const value = args[index]
  if (!value) throw new Error(`${flag} requires a value`)
  return value
}

function chooseWikidataMatch(term, rows) {
  const normalizedTerm = normalizeLoose(term)
  const ranked = rows
    .map((row) => ({ row, score: scoreWikidataMatch(normalizedTerm, row) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
  return ranked[0]?.row ?? null
}

function scoreWikidataMatch(normalizedTerm, row) {
  const label = normalizeLoose(row.label)
  const match = normalizeLoose(row.match?.text)
  const description = normalizeLoose(row.description)
  let score = 0
  if (label === normalizedTerm) score += 30
  if (match === normalizedTerm) score += 20
  if (label.includes(normalizedTerm)) score += 4
  const helpful = /\b(body|anatom|garment|clothing|color|colour|hair|eye|photographic|film format|object|material|animal|plant|food|building|vehicle)\b/.test(description)
  const likelyWork = isLikelyWikidataWork(description)
  if (helpful) score += 10
  if (likelyWork) score -= helpful ? 18 : 60
  return score
}

function shouldLookupKnowledgeTerm(term) {
  if (!term || term.length < 3) return false
  if (/^(@|score\s*\d|\d+girls?|\d+boys?|\d+k$)/i.test(term)) return false
  if (/^(newest|oldest|best|worst|good|bad|masterpiece|high quality|low quality|best quality|worst quality)$/i.test(term)) return false
  if (/[^a-zA-Z0-9\s-]/.test(term)) return false
  return term.split(/\s+/).length <= 4
}

function shouldLookupDictionaryTerm(term) {
  if (!shouldLookupKnowledgeTerm(term)) return false
  return /^[a-zA-Z][a-zA-Z\s-]{2,40}$/.test(term) && term.split(/\s+/).length <= 2
}

function shouldReplaceLabel(ja, normalizedTag) {
  if (!ja) return true
  const normalizedJa = normalizeTag(ja)
  if (normalizedJa === normalizedTag) return true
  return !/[ぁ-んァ-ヶ一-龠]/.test(ja) && !/^(?:\d+k|score\s*\d|EasyNegativeV?\d*)$/i.test(ja)
}

function inferTokenKind(tag) {
  if (/^(bad_|worst_|low_quality|extra_|missing_|deformed|watermark|signature|text)/.test(tag)) return 'negative'
  if (/(quality|score_|masterpiece|highres|detailed|absurdres)/.test(tag)) return 'quality'
  return 'tag'
}

function isLookupEligibleCandidate(candidate) {
  const tag = candidate.canonicalTag
  if (!tag) return false
  if (/^yoitomoshi_/.test(tag)) return false
  if (/(^|_)(qa|smoke|regression|validation|preflight|fixture|dom_qa|qa_dom|test_case|test_fixture)(_|$)/.test(tag)) return false
  if (/(^|_)comfy_v2(_|$)/.test(tag)) return false
  return true
}

function reasonForHighConfidence(source) {
  if (source.provider === 'danbooru' && source.evidenceKind === 'exact-wiki') return 'high-confidence-danbooru-wiki'
  if (source.provider === 'wikidata') return 'high-confidence-wikidata-entity'
  if (source.provider === 'wiktionary') return 'high-confidence-wiktionary-support'
  return 'high-confidence'
}

function providerErrorEvidence(provider, candidate, message) {
  return {
    provider,
    providerKey: candidate.canonicalTag,
    evidenceKind: 'provider-error',
    sourceUrl: '',
    confidence: 0,
    title: candidate.displayTag,
    summary: cleanString(message) || 'provider error',
    warnings: ['provider-error'],
    payloadHash: ''
  }
}

function providerDisabledEvidence(provider, candidate) {
  return {
    provider,
    providerKey: candidate.canonicalTag,
    evidenceKind: 'provider-disabled',
    sourceUrl: '',
    confidence: 0,
    title: candidate.displayTag,
    summary: 'provider disabled after repeated errors',
    warnings: ['provider-disabled'],
    payloadHash: ''
  }
}

function markProviderError(options, provider, message) {
  const family = providerFamily(provider)
  options.stats.providerErrors += 1
  const count = (options.providerErrorCounts.get(family) || 0) + 1
  options.providerErrorCounts.set(family, count)
  if (count >= options.maxErrorsPerProvider) options.disabledProviders.add(family)
}

function loadFixtureJson(provider, providerKey, options) {
  if (!options.fixtureDir || (!options.noNetwork && !fs.existsSync(options.fixtureDir))) return { found: false }
  const fixturePath = path.join(options.fixtureDir, provider, `${sanitizeFixtureKey(providerKey)}.json`)
  if (!fs.existsSync(fixturePath)) return { found: false }
  const payload = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
  return { found: true, payload }
}

function sanitizeFixtureKey(value) {
  return normalizeTag(value).replace(/[^a-z0-9_@.-]+/gi, '_') || 'empty'
}

function clampConfidence(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) throw new Error(`invalid confidence: ${value}`)
  return Math.max(0, Math.min(1, numeric))
}

function countDecision(results, decision) {
  return results.filter((result) => result.decision.decision === decision).length
}

function countReason(results, reason) {
  return results.filter((result) => result.decision.reason === reason).length
}

function danbooruCategoryName(category) {
  const value = Number(category)
  if (value === 1) return 'artist'
  if (value === 3) return 'copyright'
  if (value === 4) return 'character'
  if (value === 5) return 'meta'
  return 'general'
}

function isLikelyWikidataWork(value) {
  return /\b(song|album|single|film|video game|television|tv series|journal|sculpture|painting|novel|book|episode|fictional character|musical group|band|organization|person|place)\b/i.test(cleanString(value))
}

function cleanDtext(value) {
  return cleanString(value)
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/h[1-6]\.\s*/g, '')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanHtml(value) {
  return cleanString(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function firstSentence(value, maxLength) {
  const clean = cleanString(value)
  const sentence = clean.match(/^(.+?[.!?。！？])(?:\s|$)/)?.[1] || clean
  return sentence.length > maxLength ? `${sentence.slice(0, maxLength - 1)}...` : sentence
}

function humanizeEnglish(value) {
  return cleanString(value)
    .replace(/^@+/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeTag(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s*\/\s*/g, '_')
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeLoose(value) {
  return cleanString(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function providerRank(provider) {
  return providerOrder.get(provider) ?? 99
}

function providerFamily(provider) {
  if (/^danbooru/.test(provider)) return 'danbooru'
  if (/^wikidata/.test(provider)) return 'wikidata'
  if (/wiktionary/.test(provider)) return 'wiktionary'
  if (/^civitai/.test(provider)) return 'civitai'
  return provider
}

function parseJson(value) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value
  } catch {
    return {}
  }
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex')
}

function isTransientStatus(status) {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(Number(status))
}

function retryDelayMs(response, attempt, provider) {
  const retryAfter = response?.headers?.get?.('retry-after')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
    const dateMs = Date.parse(retryAfter)
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now())
  }
  const base = provider === 'wikidata' || provider === 'wiktionary' ? 5000 : 1000
  return base * (2 ** attempt) + Math.floor(Math.random() * 250)
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
