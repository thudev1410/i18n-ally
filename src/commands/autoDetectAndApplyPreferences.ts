import { window, workspace } from 'vscode'
import { AutoSaveToFileManager } from './autoSaveToFileAdvanced'
import { Log } from '../utils'
import path from 'path'
import fs from 'fs-extra'

/**
 * Auto-detect locales and apply preferences automatically
 * This command scans the current workspace for locale folders and automatically
 * sets up preferences based on the detected structure
 */
export async function autoDetectAndApplyPreferences() {
  try {
    // Check if we're in a valid workspace
    if (!workspace.workspaceFolders || workspace.workspaceFolders.length === 0) {
      window.showErrorMessage('No workspace folder found')
      return
    }

    const workspaceRoot = workspace.workspaceFolders[0].uri.fsPath
    const detectedLocales = await detectLocalesFromWorkspace(workspaceRoot)
    
    if (detectedLocales.length === 0) {
      window.showInformationMessage('No locale folders detected. Make sure you have a structure like: i18n/en/, i18n/de/, etc.')
      return
    }

    Log.info(`🔍 Detected ${detectedLocales.length} locales: ${detectedLocales.map(l => l.locale).join(', ')}`)

    // Show detected locales and let user choose preferences
    const result = await showLocalePreferenceDialog(detectedLocales)
    
    if (!result) {
      return
    }

    // Apply preferences
    let appliedCount = 0
    for (const locale of detectedLocales) {
      const preference = result[locale.locale]
      if (preference) {
        await AutoSaveToFileManager.setupAutoSavePreference(locale.locale, preference)
        appliedCount++
      }
    }

    window.showInformationMessage(
      `✅ Auto save preferences applied for ${appliedCount} locales!`,
      'OK'
    )

    Log.info(`✅ Auto save preferences applied for ${appliedCount} locales`)

  } catch (error) {
    Log.error(`Failed to auto-detect and apply preferences: ${error}`)
    const errorMessage = error instanceof Error ? error.message : String(error)
    window.showErrorMessage(`Failed to auto-detect preferences: ${errorMessage}`)
  }
}

/**
 * Detect locales from workspace structure
 */
async function detectLocalesFromWorkspace(workspaceRoot: string): Promise<Array<{locale: string, path: string, hasFrontend: boolean, hasBot: boolean}>> {
  const locales: Array<{locale: string, path: string, hasFrontend: boolean, hasBot: boolean}> = []
  
  // Look for common locale directory patterns
  const possiblePaths = [
    path.join(workspaceRoot, 'i18n'),
    path.join(workspaceRoot, 'locales'),
    path.join(workspaceRoot, 'lang'),
    path.join(workspaceRoot, 'languages'),
    path.join(workspaceRoot, 'translations')
  ]

  for (const basePath of possiblePaths) {
    if (await fs.pathExists(basePath)) {
      const entries = await fs.readdir(basePath, { withFileTypes: true })
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const locale = entry.name
          const localePath = path.join(basePath, locale)
          
          // Check if this looks like a locale folder (has frontend.json or bot.json)
          const hasFrontend = await fs.pathExists(path.join(localePath, 'frontend.json'))
          const hasBot = await fs.pathExists(path.join(localePath, 'bot.json'))
          
          if (hasFrontend || hasBot) {
            locales.push({
              locale,
              path: localePath,
              hasFrontend,
              hasBot
            })
          }
        }
      }
    }
  }

  return locales
}

/**
 * Show dialog to set preferences for detected locales
 */
async function showLocalePreferenceDialog(locales: Array<{locale: string, path: string, hasFrontend: boolean, hasBot: boolean}>) {
  const items = locales.map(locale => ({
    label: `${locale.locale} (${locale.hasFrontend ? 'frontend.json' : ''}${locale.hasFrontend && locale.hasBot ? ', ' : ''}${locale.hasBot ? 'bot.json' : ''})`,
    description: `Choose default file for ${locale.locale}`,
    locale: locale.locale,
    hasFrontend: locale.hasFrontend,
    hasBot: locale.hasBot
  }))

  const selectedLocales = await window.showQuickPick(items, {
    placeHolder: 'Select locales to configure (you can select multiple)',
    title: 'Auto-Detect Locales',
    canPickMany: true
  })

  if (!selectedLocales || selectedLocales.length === 0) {
    return null
  }

  // For each selected locale, ask for preference
  const preferences: Record<string, 'frontend' | 'bot'> = {}
  
  for (const selected of selectedLocales) {
    const options = []
    
    if (selected.hasFrontend) {
      options.push({
        label: 'frontend.json',
        description: `Use frontend.json for ${selected.locale}`,
        value: 'frontend' as const
      })
    }
    
    if (selected.hasBot) {
      options.push({
        label: 'bot.json',
        description: `Use bot.json for ${selected.locale}`,
        value: 'bot' as const
      })
    }

    if (options.length === 1) {
      // Only one option, auto-select
      preferences[selected.locale] = options[0].value
    } else {
      // Multiple options, ask user
      const choice = await window.showQuickPick(options, {
        placeHolder: `Choose default file for ${selected.locale}`,
        title: `Configure ${selected.locale}`
      })
      
      if (choice) {
        preferences[selected.locale] = choice.value
      }
    }
  }

  return preferences
}
