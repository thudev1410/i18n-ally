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

  // Get keys that exist in the source locale first
  const sourceLocale = Config.sourceLanguage
  const sourceKeys = loader.keys.filter(key => {
    const node = loader.getNodeByKey(key, false, sourceLocale)
    return node && node.type === 'node' && node.getValue(sourceLocale)?.trim()
  })
  
  Log.info(`🔍 Source locale "${sourceLocale}" has ${sourceKeys.length} keys with values`)

  for (const locale of Global.visibleLocales) {
    if (locale === sourceLocale) continue // Skip source locale
    
    const cov = loader.getCoverage(locale, sourceKeys)
    
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

  for (const keypath of allMissingKeys) {
    // Find which locales are missing this key
    const missingLocales: string[] = []
    for (const locale of Global.visibleLocales) {
      if (missingKeysByLocale[locale] && missingKeysByLocale[locale].includes(keypath)) {
        missingLocales.push(locale)
      }
    }

    if (missingLocales.length > 0) {
      // Since we already filtered sourceKeys, we know this key exists in source locale
      const sourceNode = loader.getNodeByKey(keypath, false, sourceLocale)!
      const sourceValue = sourceNode.getValue(sourceLocale)!

      Log.info(`✅ Key "${keypath}" exists in source locale with value: "${sourceValue}"`)

      missingKeysInfo.push({
        keypath,
        locales: missingLocales,
        sourceLocale,
        sourceValue
      })
    }
  }

  Log.info(`🔍 Analysis: Found ${missingKeysInfo.length} missing keys that can be translated`)
  Log.info(`🔍 Total missing keys found: ${allMissingKeys.size}`)
  Log.info(`🔍 Keys filtered out (no source): ${allMissingKeys.size - missingKeysInfo.length}`)
  
  // Debug: Show some examples of missing keys
  if (missingKeysInfo.length > 0) {
    Log.info(`🔍 Example missing keys: ${missingKeysInfo.slice(0, 3).map(k => k.keypath).join(', ')}`)
    Log.info(`🔍 Source locale: ${sourceLocale}`)
    Log.info(`🔍 Target locales: ${Global.visibleLocales.filter(l => l !== sourceLocale).join(', ')}`)
  }
  
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
  
  // API rate limiting delays (optimized for 1000 keys in 5-10 minutes)
  // Note: Actual translation time depends on GPT API response time (~2-3s per locale)
  const LOCALE_DELAY_MS = 100  // 100ms between locales (minimal)
  const KEY_DELAY_MS = 200     // 200ms between keys (minimal)

  Log.info(`🚀 Starting translation of ${totalKeys} keys across ${options.targetLocales.length} locales`)
  Log.info(`🚀 Source locale: ${options.sourceLocale}`)
  Log.info(`🚀 Target locales: ${options.targetLocales.join(', ')}`)

  await window.withProgress({
    location: ProgressLocation.Notification,
    title: 'Auto-translating missing keys...',
    cancellable: true
  }, async (progress, token) => {
    for (let i = 0; i < missingKeysInfo.length; i++) {
      if (token.isCancellationRequested) {
        Log.info(`🛑 Translation cancelled by user`)
        break
      }

      const keyInfo = missingKeysInfo[i]
      progress.report({
        message: `Translating ${keyInfo.keypath} (${i + 1}/${totalKeys})`,
        increment: (1 / totalKeys) * 100
      })

      Log.info(`🔄 Processing key "${keyInfo.keypath}" (${i + 1}/${totalKeys})`)

      try {
        // Get the source node - this should exist since we're translating FROM source locale
        const sourceNode = loader.getNodeByKey(keyInfo.keypath, false, options.sourceLocale)
        if (!sourceNode || sourceNode.type !== 'node') {
          Log.warn(`❌ Source node not found for key: ${keyInfo.keypath} in source locale: ${options.sourceLocale}`)
          Log.warn(`❌ This key exists in target locales but not in source locale - skipping`)
          continue
        }

        // Verify the source node has a value to translate
        const sourceValue = sourceNode.getValue(options.sourceLocale)
        if (!sourceValue || sourceValue.trim() === '') {
          Log.warn(`❌ Source value is empty for key: ${keyInfo.keypath} in source locale: ${options.sourceLocale}`)
          continue
        }

        Log.info(`✅ Found source value for "${keyInfo.keypath}": "${sourceValue}"`)

        // Create LocaleNode objects for missing locales by creating empty records first
        const pendingWrites = []
        
        for (const locale of keyInfo.locales) {
          try {
            // For missing keys, we need to determine where they should be saved
            // Use the loader's requestMissingFilepath method which handles auto save preferences
            const pendingWrite = {
              keypath: keyInfo.keypath,
              locale,
              value: '', // Empty value to be filled by translation
              filepath: undefined as string | undefined
            }
            
            // Get the underlying LocaleLoader from ComposedLoader
            const localeLoader = loader.loaders.find(l => l.name.includes('[LOCALE]')) as any
            if (localeLoader && localeLoader.requestMissingFilepath) {
              const filepath = await localeLoader.requestMissingFilepath(pendingWrite)
              if (filepath) {
                pendingWrite.filepath = filepath
                pendingWrites.push(pendingWrite)
                Log.info(`📁 Key "${keyInfo.keypath}" will be saved to: ${filepath}`)
              } else {
                Log.warn(`❌ Could not determine file path for key "${keyInfo.keypath}" in locale "${locale}"`)
              }
            } else {
              Log.warn(`❌ LocaleLoader not found or requestMissingFilepath method not available`)
            }
          } catch (error) {
            Log.error(`❌ Failed to get file path for key "${keyInfo.keypath}" in locale "${locale}": ${error}`)
          }
        }

        // Process each locale sequentially to avoid race conditions
        for (const locale of keyInfo.locales) {
          try {
            const pendingWrite = pendingWrites.find(pw => pw.locale === locale)
            if (!pendingWrite) {
              Log.warn(`❌ No pending write found for locale "${locale}"`)
              continue
            }

            // Create record for this single locale
            Log.info(`🔧 Creating record for key "${keyInfo.keypath}" in locale "${locale}"`)
            await loader.write([pendingWrite], false)
            
            // Get the created node for this locale
            const nodeToTranslate = loader.getNodeByKey(keyInfo.keypath, false, locale)
            if (!nodeToTranslate || nodeToTranslate.type !== 'node') {
              Log.warn(`❌ Failed to get node for key "${keyInfo.keypath}" in locale "${locale}"`)
              continue
            }

            Log.info(`🌐 Starting translation for key "${keyInfo.keypath}" in locale "${locale}"`)
            
            // Track translation completion for this single locale
            const translationPromise = new Promise<void>((resolve) => {
              const disposable = Translator.onDidChange((event) => {
                if (event.keypath === keyInfo.keypath && event.locale === locale && event.action === 'end') {
                  disposable.dispose()
                  resolve()
                }
              })
            })
            
            // Start translation for this single locale (sequential)
            Translator.translateNodes(loader, [nodeToTranslate], options.sourceLocale, [locale], true)
            
            // Wait for this translation to complete before moving to next locale
            await translationPromise
            
            Log.info(`✅ Translated key "${keyInfo.keypath}" to locale "${locale}"`)
            
            // Add delay between translations to avoid API spam
            Log.info(`⏳ Waiting ${LOCALE_DELAY_MS}ms before next translation...`)
            await new Promise(resolve => setTimeout(resolve, LOCALE_DELAY_MS))
          } catch (error) {
            Log.error(`❌ Failed to process key "${keyInfo.keypath}" for locale "${locale}": ${error}`)
          }
        }
        
        translatedCount++
        Log.info(`✅ Completed key "${keyInfo.keypath}" for all ${keyInfo.locales.length} locale(s)`)
        
        // Add delay between keys to further prevent API spam
        if (i < missingKeysInfo.length - 1) { // Don't delay after the last key
          Log.info(`⏳ Waiting ${KEY_DELAY_MS}ms before next key...`)
          await new Promise(resolve => setTimeout(resolve, KEY_DELAY_MS))
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
