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
 * Get the target file path for a locale based on stored preference
 */
function getTargetFilePath(locale: string, basePath: string): string | null {
  const preference = getFilePreference(locale)
  if (!preference) {
    return null
  }
  
  return path.join(basePath, locale, `${preference}.json`)
}

/**
 * Enhanced auto save functionality that integrates with the extraction process
 * This automatically determines the target file based on locale folder and stored preferences
 */
export class AutoSaveToFileManager {
  
  /**
   * Get the target file path for extraction based on current context
   */
  static getTargetFileForExtraction(locale: string, basePath: string): string | null {
    // First, try to get stored preference
    const preference = getFilePreference(locale)
    if (preference) {
      return getTargetFilePath(locale, basePath)
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
        return path.join(basePath, locale, `${fileName}.json`)
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
