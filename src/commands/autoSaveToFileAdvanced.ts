import { window, workspace } from 'vscode'
import { Log } from '../utils'
import path from 'path'

/**
 * Get stored file preference for a locale
 */
function getFilePreference(locale: string): string | undefined {
  const config = workspace.getConfiguration('i18n-ally')
  const prefs = config.get<Record<string, string>>('autoSavePreferences') || {}
  return prefs[locale]
}


/**
 * Enhanced auto save functionality that integrates with the extraction process
 * This automatically determines the target file based on locale folder and stored preferences
 */
export class AutoSaveToFileManager {
  
  /**
   * Get the target file path for extraction based on current context
   * This method should be called with the actual available file paths
   */
  static getTargetFileForExtraction(locale: string, availablePaths: string[]): string | null {
    // First, try to get stored preference
    const preference = getFilePreference(locale)
    if (preference) {
      // Look for the preferred file in the available paths
      const preferredFile = availablePaths.find(filePath => {
        const fileName = path.basename(filePath, '.json')
        return fileName === preference
      })
      
      if (preferredFile) {
        Log.info(`🎯 Auto save: Found preference file for ${locale}: ${path.basename(preferredFile)}`)
        return preferredFile
      }
    }

    // If no preference stored, try to determine from current file context
    const editor = window.activeTextEditor
    if (!editor) {
      return null
    }

    const currentFile = editor.document.uri.fsPath
    const localeInfo = extractLocaleFromPath(currentFile)
    
    if (localeInfo && localeInfo.locale === locale) {
      // Determine file type from current file
      const fileName = path.basename(currentFile, '.json')
      if (fileName === 'frontend' || fileName === 'bot') {
        // Look for matching file in available paths
        const matchingFile = availablePaths.find(filePath => {
          const availableFileName = path.basename(filePath, '.json')
          return availableFileName === fileName
        })
        
        if (matchingFile) {
          Log.info(`🎯 Auto save: Using current file context for ${locale}: ${path.basename(matchingFile)}`)
          return matchingFile
        }
      }
    }

    return null
  }

  /**
   * Set up auto save preference for a locale
   */
  static async setupAutoSavePreference(locale: string, fileType: 'frontend' | 'bot'): Promise<void> {
    const config = workspace.getConfiguration('i18n-ally')
    const currentPrefs = config.get<Record<string, string>>('autoSavePreferences') || {}
    
    currentPrefs[locale] = fileType
    
    await config.update('autoSavePreferences', currentPrefs, false)
    
    Log.info(`✅ Auto save preference set: ${locale} → ${fileType}.json`)
  }

  /**
   * Get all stored preferences
   */
  static getStoredPreferences(): Record<string, string> {
    const config = workspace.getConfiguration('i18n-ally')
    return config.get<Record<string, string>>('autoSavePreferences') || {}
  }

  /**
   * Clear all stored preferences
   */
  static async clearPreferences(): Promise<void> {
    const config = workspace.getConfiguration('i18n-ally')
    await config.update('autoSavePreferences', {}, false)
    Log.info('✅ Auto save preferences cleared')
  }
}

/**
 * Extract locale information from file path
 */
function extractLocaleFromPath(filepath: string): { locale: string; localePath: string } | null {
  // Look for locale pattern in path (e.g., /i18n/en/, /locales/de/, etc.)
  const localeMatch = filepath.match(/\/([a-z]{2}(?:-[A-Z]{2})?)\//)
  if (!localeMatch) {
    return null
  }

  const locale = localeMatch[1]
  const localePath = path.dirname(filepath)
  
  return { locale, localePath }
}
