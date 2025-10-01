import { window, ProgressLocation } from 'vscode'
import { Global, CurrentFile } from '../core'
import { Analyst } from '../core/Analyst'
import { Log } from '../utils'
import { DeleteRecords } from './manipulations/deleteKey'
import { AutoSaveToFileManager } from './autoSaveToFileAdvanced'
import path from 'path'
import _ from 'lodash'

interface UnusedKeyInfo {
  keypath: string
  locales: string[]
  files: string[]
}

interface CleanupOptions {
  dryRun: boolean
  confirmEach: boolean
  excludePatterns: string[]
}

/**
 * Command to detect and remove unused translation keys
 * This analyzes the codebase to find keys that exist in locale files but are not used in code
 */
export async function cleanupUnusedKeys() {
  try {
    const loader = CurrentFile.loader
    if (!loader) {
      window.showErrorMessage('No i18n loader found. Please configure locales first.')
      return
    }

    // Show options dialog
    const options = await showCleanupOptions()
    if (!options) {
      return
    }

    // Analyze usage and find unused keys
    const unusedKeys = await window.withProgress({
      location: ProgressLocation.Notification,
      title: 'Analyzing unused keys...',
      cancellable: false
    }, async () => {
      return await analyzeUnusedKeys()
    })

    if (unusedKeys.length === 0) {
      const autoSavePreferences = AutoSaveToFileManager.getStoredPreferences()
      const hasAutoSavePreferences = Object.keys(autoSavePreferences).length > 0
      
      if (hasAutoSavePreferences) {
        window.showInformationMessage('🎉 No unused keys found in your preferred files! Your translation files are clean.')
      } else {
        window.showInformationMessage('🎉 No unused keys found! Your translation files are clean.')
      }
      return
    }

    // Show results and get user confirmation
    const result = await showUnusedKeysDialog(unusedKeys, options)
    if (!result) {
      return
    }

    // Perform the cleanup
    await performCleanup(unusedKeys, result.selectedKeys, options)

  } catch (error) {
    Log.error(`Failed to cleanup unused keys: ${error}`)
    const errorMessage = error instanceof Error ? error.message : String(error)
    window.showErrorMessage(`Failed to cleanup unused keys: ${errorMessage}`)
  }
}

/**
 * Analyze the codebase to find unused keys
 * This uses the same logic as writeMissingKeysToFile.ts but in reverse
 */
async function analyzeUnusedKeys(): Promise<UnusedKeyInfo[]> {
  const loader = CurrentFile.loader!
  const usageReport = await Analyst.analyzeUsage()
  
  // Get auto save preferences to filter relevant files
  const autoSavePreferences = AutoSaveToFileManager.getStoredPreferences()
  Log.info(`🔍 Auto save preferences: ${JSON.stringify(autoSavePreferences)}`)

  // Use the idle keys from Analyst - these are already calculated as unused
  const idleKeys = usageReport.idle || []
  Log.info(`🔍 Analysis: Found ${idleKeys.length} idle keys from Analyst`)

  const unusedKeys: UnusedKeyInfo[] = []

  for (const idleKey of idleKeys) {
    const keypath = idleKey.keypath
    
    // Find which locales contain this key and filter by auto save preferences
    const locales: string[] = []
    const files: string[] = []

    for (const locale of Global.visibleLocales) {
      // Check if this key exists in this locale
      const node = loader.getNodeByKey(keypath, false, locale)
      if (!node || node.type !== 'node') {
        continue
      }

      // If auto save preferences are set for this locale, check if key is in preferred file
      if (autoSavePreferences[locale]) {
        const preferredFileType = autoSavePreferences[locale]
        const filepath = loader.getFilepathByKey(keypath, locale)
        
        if (filepath) {
          const fileName = path.basename(filepath, '.json')
          if (fileName === preferredFileType) {
            locales.push(locale)
            files.push(filepath)
            Log.info(`🔍 ${keypath} in ${locale}/${preferredFileType}.json (matches preference)`)
          } else {
            Log.info(`🔍 ${keypath} in ${locale}/${fileName}.json (skipped - not preferred file)`)
          }
        }
      } else {
        // No auto save preference for this locale, include the key
        const filepath = loader.getFilepathByKey(keypath, locale)
        if (filepath) {
          locales.push(locale)
          files.push(filepath)
          Log.info(`🔍 ${keypath} in ${locale}/${path.basename(filepath)} (no preference)`)
        }
      }
    }

    if (locales.length > 0) {
      unusedKeys.push({
        keypath,
        locales,
        files: _.uniq(files)
      })
    }
  }

  Log.info(`🔍 Analysis: Found ${unusedKeys.length} unused keys that can be removed`)
  return unusedKeys
}

/**
 * Show cleanup options dialog
 */
async function showCleanupOptions(): Promise<CleanupOptions | null> {
  const confirmEach = await window.showQuickPick([
    {
      label: '$(check) Remove all unused keys',
      description: 'Remove all unused keys without individual confirmation',
      value: false
    },
    {
      label: '$(question) Confirm each key',
      description: 'Ask for confirmation before removing each key',
      value: true
    }
  ], {
    placeHolder: 'Choose confirmation mode',
    title: 'Cleanup Confirmation'
  })

  if (!confirmEach) {
    return null
  }

  return {
    dryRun: false,
    confirmEach: confirmEach.value,
    excludePatterns: []
  }
}

/**
 * Show dialog with unused keys and let user select which ones to remove
 */
async function showUnusedKeysDialog(unusedKeys: UnusedKeyInfo[], options: CleanupOptions) {
  const items = unusedKeys.map((key, index) => ({
    label: `$(key) ${key.keypath}`,
    description: `Used in ${key.locales.length} locale(s): ${key.locales.join(', ')}`,
    detail: `Files: ${key.files.map(f => path.basename(f)).join(', ')}`,
    keypath: key.keypath,
    locales: key.locales,
    files: key.files,
    picked: true // Select all by default
  }))

  const selected = await window.showQuickPick(items, {
    placeHolder: `Found ${unusedKeys.length} unused keys. Select which ones to ${options.dryRun ? 'preview removal for' : 'remove'}:`,
    title: `Unused Keys (${options.dryRun ? 'Preview' : 'Remove'})`,
    canPickMany: true
  })

  if (!selected || selected.length === 0) {
    return null
  }

  return {
    selectedKeys: selected.map(s => ({
      keypath: s.keypath,
      locales: s.locales,
      files: s.files
    }))
  }
}


/**
 * Perform the actual cleanup using the existing delete logic
 */
async function performCleanup(unusedKeys: UnusedKeyInfo[], selectedKeys: any[], options: CleanupOptions) {
  const loader = CurrentFile.loader!
  let removedCount = 0
  const recordsToDelete: any[] = []

  for (const keyInfo of selectedKeys) {
    if (options.confirmEach) {
      const confirm = await window.showWarningMessage(
        `Remove key "${keyInfo.keypath}" from ${keyInfo.locales.length} locale(s)?`,
        'Remove',
        'Skip',
        'Cancel All'
      )

      if (confirm === 'Cancel All') {
        break
      }
      if (confirm !== 'Remove') {
        continue
      }
    }

    // Get the node for this key and collect all its records
    const node = loader.getNodeByKey(keyInfo.keypath)
    if (node && node.type === 'node') {
      // Get all locale records for this key
      const records = Object.values(node.locales)
      recordsToDelete.push(...records)
      removedCount++
      Log.info(`✅ Queued key "${keyInfo.keypath}" for removal from ${records.length} locale(s)`)
    }
  }

  if (recordsToDelete.length > 0) {
    try {
      // Use the existing DeleteRecords function
      await DeleteRecords(recordsToDelete)
      
      // Refresh the usage analysis
      if (Analyst.hasCache()) {
        setTimeout(() => {
          Analyst.analyzeUsage(false)
        }, 500)
      }

      window.showInformationMessage(
        `✅ Cleanup completed! Removed ${removedCount} unused keys (${recordsToDelete.length} total records).`,
        'OK'
      )
    } catch (error) {
      Log.error(`Failed to delete records: ${error}`)
      const errorMessage = error instanceof Error ? error.message : String(error)
      window.showErrorMessage(`Failed to delete records: ${errorMessage}`)
    }
  }
}

