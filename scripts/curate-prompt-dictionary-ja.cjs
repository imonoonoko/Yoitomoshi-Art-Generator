const fs = require('node:fs')
const path = require('node:path')
const { curatePromptDictionaryJapanese } = require('./prompt-dictionary-ja-curation.cjs')

const projectRoot = path.resolve(__dirname, '..')
const defaultFiles = [
  path.join(projectRoot, 'resources', 'prompt-dictionary', 'promoted-candidates.civitai.json'),
  path.join(projectRoot, 'userdata', 'prompt-dictionary', 'promoted-candidates.local.json')
]

main()

function main() {
  const options = parseArgs(process.argv.slice(2))
  const files = options.files.length > 0 ? options.files : defaultFiles
  const stats = {
    dryRun: options.dryRun,
    scannedFiles: 0,
    scannedEntries: 0,
    changedEntries: 0,
    filledLabels: 0,
    updatedMeanings: 0,
    missingLabelsAfter: 0,
    missingMeaningsAfter: 0,
    files: []
  }

  for (const file of files) {
    const snapshotPath = path.resolve(projectRoot, file)
    if (!fs.existsSync(snapshotPath)) {
      stats.files.push({ file: path.relative(projectRoot, snapshotPath), exists: false })
      continue
    }
    const result = curateSnapshotFile(snapshotPath, options)
    stats.scannedFiles += 1
    stats.scannedEntries += result.scannedEntries
    stats.changedEntries += result.changedEntries
    stats.filledLabels += result.filledLabels
    stats.updatedMeanings += result.updatedMeanings
    stats.missingLabelsAfter += result.missingLabelsAfter
    stats.missingMeaningsAfter += result.missingMeaningsAfter
    stats.files.push(result)
  }

  console.log(JSON.stringify(stats, null, 2))
}

function curateSnapshotFile(snapshotPath, options) {
  const parsed = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
  const entries = Array.isArray(parsed.entries) ? parsed.entries : []
  const result = {
    file: path.relative(projectRoot, snapshotPath).replace(/\\/g, '/'),
    exists: true,
    scannedEntries: entries.length,
    changedEntries: 0,
    filledLabels: 0,
    updatedMeanings: 0,
    missingLabelsAfter: 0,
    missingMeaningsAfter: 0,
    wrote: false
  }

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const tag = cleanString(entry.canonicalTag || entry.tag)
    if (!tag) continue
    const beforeJa = cleanString(entry.ja)
    const beforeMeaning = cleanString(entry.meaning)
    const polarity = inferEntryPolarity(entry)
    const curated = curatePromptDictionaryJapanese(tag, {
      ja: beforeJa,
      meaning: beforeMeaning,
      category: entry.category,
      group: entry.group,
      polarity,
      status: entry.curationStatus,
      sourceLabel: parsed.sourceLabel
    })

    if (curated.ja !== beforeJa) {
      entry.ja = curated.ja
      result.filledLabels += beforeJa ? 0 : 1
    }
    if (curated.meaning !== beforeMeaning) {
      entry.meaning = curated.meaning
      result.updatedMeanings += 1
    }
    if (curated.changed) {
      entry.curationStatus = curated.status || 'machine-draft'
      entry.translationProvider = curated.provider || 'yoitomoshi-codex-ja-curation-v1'
      result.changedEntries += 1
    }
    if (!cleanString(entry.ja)) result.missingLabelsAfter += 1
    if (!cleanString(entry.meaning)) result.missingMeaningsAfter += 1
  }

  if (!options.dryRun && result.changedEntries > 0) {
    fs.writeFileSync(snapshotPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
    result.wrote = true
  }

  return result
}

function inferEntryPolarity(entry) {
  if (entry.tokenKind === 'negative') return 'negative'
  if (Number(entry.negativeCount ?? 0) > Number(entry.positiveCount ?? 0)) return 'negative'
  const text = `${entry.category ?? ''} ${entry.group ?? ''} ${entry.tag ?? ''}`.toLowerCase()
  return /(negative|bad_|worst_|low_quality|deformed|extra_|missing_|watermark|signature|text)/.test(text) ? 'negative' : 'positive'
}

function parseArgs(args) {
  const options = { dryRun: false, files: [] }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--file') {
      const value = args[i + 1]
      if (!value) throw new Error('--file requires a path')
      options.files.push(value)
      i += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}
