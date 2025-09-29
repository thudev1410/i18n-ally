import { window, QuickPickItem } from 'vscode'
import { AutoSaveToFileManager } from './autoSaveToFileAdvanced'
import { Log } from '../utils'

interface QuickPickItemWithValue extends QuickPickItem {
  value: string
}

/**
 * Command to manage auto save preferences for different locales
 */
export async function manageAutoSavePreferences() {
  try {
    const preferences = AutoSaveToFileManager.getStoredPreferences()
    
    if (Object.keys(preferences).length === 0) {
      const setup = await window.showInformationMessage(
        'No auto save preferences configured. Would you like to set them up?',
        'Setup Preferences',
        'Cancel'
      )
      
      if (setup === 'Setup Preferences') {
        await setupAutoSavePreferences()
      }
      return
    }

    // Show current preferences
    const items: QuickPickItemWithValue[] = Object.entries(preferences).map(([locale, fileType]) => ({
      label: `${locale} → ${fileType}.json`,
      description: `Auto save to ${fileType}.json for ${locale} locale`,
      value: locale
    }))

    items.push({
      label: '$(add) Add new preference',
      description: 'Set up auto save for a new locale',
      value: 'add'
    } as QuickPickItemWithValue)

    items.push({
      label: '$(trash) Clear all preferences',
      description: 'Remove all stored auto save preferences',
      value: 'clear'
    } as QuickPickItemWithValue)

    const selected = await window.showQuickPick(items, {
      placeHolder: 'Manage auto save preferences',
      title: 'Auto Save Preferences'
    }) as QuickPickItemWithValue | undefined

    if (!selected) {
      return
    }

    if (selected.value === 'add') {
      await setupAutoSavePreferences()
    } else if (selected.value === 'clear') {
      const confirm = await window.showWarningMessage(
        'Are you sure you want to clear all auto save preferences?',
        'Yes, Clear All',
        'Cancel'
      )
      
      if (confirm === 'Yes, Clear All') {
        await AutoSaveToFileManager.clearPreferences()
        window.showInformationMessage('All auto save preferences have been cleared')
      }
    } else {
      // Edit existing preference
      await editPreference(selected.value)
    }

  } catch (error) {
    Log.error(`Failed to manage auto save preferences: ${error}`)
    const errorMessage = error instanceof Error ? error.message : String(error)
    window.showErrorMessage(`Failed to manage preferences: ${errorMessage}`)
  }
}

/**
 * Set up auto save preferences for a locale
 */
async function setupAutoSavePreferences() {
  // Get locale from user
  const locale = await window.showInputBox({
    prompt: 'Enter locale code (e.g., en, de, es)',
    placeHolder: 'en',
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Locale code is required'
      }
      if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(value.trim())) {
        return 'Invalid locale format (use: en, de, es, en-US, etc.)'
      }
      return null
    }
  })

  if (!locale) {
    return
  }

  // Get file type preference
  const fileType = await window.showQuickPick([
    {
      label: 'frontend.json',
      description: `Save keys to frontend.json for ${locale}`,
      value: 'frontend'
    },
    {
      label: 'bot.json',
      description: `Save keys to bot.json for ${locale}`,
      value: 'bot'
    }
  ], {
    placeHolder: `Select default file for ${locale} locale`,
    title: 'Auto Save File Selection'
  })

  if (!fileType) {
    return
  }

  await AutoSaveToFileManager.setupAutoSavePreference(locale.trim(), fileType.value as 'frontend' | 'bot')
  
  window.showInformationMessage(
    `Auto save preference set: ${locale} → ${fileType.value}.json`,
    'OK'
  )
}

/**
 * Edit existing preference
 */
async function editPreference(locale: string) {
  const fileType = await window.showQuickPick([
    {
      label: 'frontend.json',
      description: `Save keys to frontend.json for ${locale}`,
      value: 'frontend'
    },
    {
      label: 'bot.json',
      description: `Save keys to bot.json for ${locale}`,
      value: 'bot'
    }
  ], {
    placeHolder: `Select default file for ${locale} locale`,
    title: 'Edit Auto Save Preference'
  })

  if (!fileType) {
    return
  }

  await AutoSaveToFileManager.setupAutoSavePreference(locale, fileType.value as 'frontend' | 'bot')
  
  window.showInformationMessage(
    `Auto save preference updated: ${locale} → ${fileType.value}.json`,
    'OK'
  )
}
