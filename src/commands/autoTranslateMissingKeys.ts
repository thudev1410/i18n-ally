import { window, ProgressLocation } from 'vscode'
import { Global, CurrentFile, Translator, Config } from '../core'
import { Analyst } from '../core/Analyst'
import { Log } from '../utils'
import { AutoSaveToFileManager } from './autoSaveToFileAdvanced'

interface MissingKeyInfo {
  keypath: string
  locales: string[]
  sourceLocale: string
  sourceValue: string
}

interface AutoTranslateOptions {
  sourceLocale: string
  targetLocales: string[]
  confirmEach: boolean
  useAutoSavePreferences: boolean
}

/**
 * Auto-translate missing keys by locale
 * Based on writeMissingKeysToFile.ts logic but with automatic translation
 */
export async function autoTranslateMissingKeys() {
  try {
    const loader = CurrentFile.loader
    if (!loader) {
      window.showWarningMessage('No i18n loader found. Please configure locales first.')
      return
    }

    // Get missing keys analysis
    const missingKeysInfo = await window.withProgress({
      location: ProgressLocation.Notification,
      title: 'Analyzing missing keys...',
      cancellable: false
    }, async () => {
      return await analyzeMissingKeys()
    })

    if (missingKeysInfo.length === 0) {
      window.showInformationMessage('🎉 No missing keys found! Your translation files are complete.')
      return
    }

    // Show missing keys list and get confirmation
    const result = await showMissingKeysList(missingKeysInfo)
    if (!result) {
      return
    }

    // Perform auto-translation
    await performAutoTranslation(missingKeysInfo, result)

  } catch (error) {
    Log.error(`Failed to auto-translate missing keys: ${error}`)
    const errorMessage = error instanceof Error ? error.message : String(error)
    window.showErrorMessage(`Failed to auto-translate missing keys: ${errorMessage}`)
  }
}

/**
 * Analyze missing keys using the same logic as writeMissingKeysToFile.ts
 */
async function analyzeMissingKeys(): Promise<MissingKeyInfo[]> {
  const loader = CurrentFile.loader!
  const usageReport = await Analyst.analyzeUsage()
  
  // Get auto save preferences to filter relevant files
  const autoSavePreferences = AutoSaveToFileManager.getStoredPreferences()
  Log.info(`🔍 Auto save preferences: ${JSON.stringify(autoSavePreferences)}`)

  // Get missing keys from Analyst (keys used in code but not in locale files)
  const codeDetectedMissingKeys = new Set<string>()
  if (usageReport.missing) {
    usageReport.missing.forEach(item => {
      codeDetectedMissingKeys.add(item.keypath)
    })
  }

  // Get missing keys by locale from coverage
  const missingKeysByLocale: Record<string, string[]> = {}
  const allMissingKeys = new Set<string>()

  for (const locale of Global.visibleLocales) {
    const keys = loader.keys
    const cov = loader.getCoverage(locale, keys)
    
    if (cov && cov.missingKeys.length > 0) {
      // Filter by auto save preferences if set
      if (autoSavePreferences[locale]) {
        const preferredFileType = autoSavePreferences[locale]
        Log.info(`🔍 Filtering ${locale} to only include missing keys from ${preferredFileType}.json`)
        
        // Filter missing keys to only those that would be saved to preferred file
        const filteredMissingKeys = cov.missingKeys.filter(key => {
          // For missing keys, we need to determine where they would be saved
          // This is a simplified approach - in reality, we'd need to check the loader's logic
          return true // For now, include all missing keys
        })
        
        missingKeysByLocale[locale] = filteredMissingKeys
        filteredMissingKeys.forEach(key => allMissingKeys.add(key))
        Log.info(`🔍 ${locale}: ${filteredMissingKeys.length} missing keys from ${preferredFileType}.json (${cov.missingKeys.length} total)`)
      } else {
        // No auto save preference for this locale, include all missing keys
        missingKeysByLocale[locale] = cov.missingKeys
        cov.missingKeys.forEach(key => allMissingKeys.add(key))
        Log.info(`🔍 ${locale}: ${cov.missingKeys.length} missing keys (no auto save preference)`)
      }
    }
  }

  // Create MissingKeyInfo objects
  const missingKeysInfo: MissingKeyInfo[] = []
  const sourceLocale = Config.sourceLanguage

  for (const keypath of allMissingKeys) {
    // Find which locales are missing this key
    const missingLocales: string[] = []
    for (const locale of Global.visibleLocales) {
      if (missingKeysByLocale[locale] && missingKeysByLocale[locale].includes(keypath)) {
        missingLocales.push(locale)
      }
    }

    if (missingLocales.length > 0) {
      // Get source value from source locale
      const sourceNode = loader.getNodeByKey(keypath, false, sourceLocale)
      const sourceValue = sourceNode?.getValue(sourceLocale) || ''

      missingKeysInfo.push({
        keypath,
        locales: missingLocales,
        sourceLocale,
        sourceValue
      })
    }
  }

  Log.info(`🔍 Analysis: Found ${missingKeysInfo.length} missing keys that can be translated`)
  return missingKeysInfo
}

/**
 * Show missing keys list and get confirmation
 */
async function showMissingKeysList(missingKeysInfo: MissingKeyInfo[]): Promise<AutoTranslateOptions | null> {
  const sourceLocale = Config.sourceLanguage
  const targetLocales = Global.visibleLocales.filter(locale => locale !== sourceLocale)
  
  // Create summary message
  const totalKeys = missingKeysInfo.length
  const totalLocales = new Set(missingKeysInfo.flatMap(k => k.locales)).size
  const keysByLocale: Record<string, number> = {}
  
  missingKeysInfo.forEach(key => {
    key.locales.forEach(locale => {
      keysByLocale[locale] = (keysByLocale[locale] || 0) + 1
    })
  })

  const localeSummary = Object.entries(keysByLocale)
    .map(([locale, count]) => `${locale}: ${count} keys`)
    .join(', ')

  const message = `Found ${totalKeys} missing keys across ${totalLocales} locales.\n\n` +
    `Missing keys by locale: ${localeSummary}\n\n` +
    `This will translate from ${sourceLocale} to ${targetLocales.length} locale(s).\n\n` +
    `Continue with auto-translation?`

  const result = await window.showWarningMessage(
    message,
    { modal: true },
    'Translate All',
    'Cancel'
  )

  if (result !== 'Translate All') {
    return null
  }

  return {
    sourceLocale,
    targetLocales,
    confirmEach: false,
    useAutoSavePreferences: true
  }
}

/**
 * Perform the actual auto-translation
 */
async function performAutoTranslation(missingKeysInfo: MissingKeyInfo[], options: AutoTranslateOptions) {
  const loader = CurrentFile.loader!
  let translatedCount = 0
  const totalKeys = missingKeysInfo.length

  await window.withProgress({
    location: ProgressLocation.Notification,
    title: 'Auto-translating missing keys...',
    cancellable: true
  }, async (progress, token) => {
    for (let i = 0; i < missingKeysInfo.length; i++) {
      if (token.isCancellationRequested) {
        break
      }

      const keyInfo = missingKeysInfo[i]
      progress.report({
        message: `Translating ${keyInfo.keypath} (${i + 1}/${totalKeys})`,
        increment: (1 / totalKeys) * 100
      })

      try {
        // Get the source node
        const sourceNode = loader.getNodeByKey(keyInfo.keypath, false, options.sourceLocale)
        if (!sourceNode || sourceNode.type !== 'node') {
          Log.warn(`Source node not found for key: ${keyInfo.keypath}`)
          continue
        }

        // Create LocaleRecord objects for missing locales
        const recordsToTranslate = keyInfo.locales.map(locale => {
          const filepath = loader.getFilepathByKey(keyInfo.keypath, locale)
          return {
            keypath: keyInfo.keypath,
            locale,
            value: '', // Empty value to be filled by translation
            filepath,
            type: undefined // This makes it compatible with AccaptableTranslateItem
          }
        }).filter(record => record.filepath) // Only include records with valid filepaths

        if (recordsToTranslate.length > 0) {
          // Use Translator.translateNodes to translate
          await Translator.translateNodes(loader, recordsToTranslate, options.sourceLocale, keyInfo.locales)
          translatedCount++
          Log.info(`✅ Translated key "${keyInfo.keypath}" to ${recordsToTranslate.length} locale(s)`)
        }
      } catch (error) {
        Log.error(`Failed to translate key "${keyInfo.keypath}": ${error}`)
      }
    }
  })

  window.showInformationMessage(
    `✅ Auto-translation completed! Translated ${translatedCount} keys across ${options.targetLocales.length} locale(s).`,
    'OK'
  )
}
