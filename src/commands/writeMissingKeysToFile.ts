import path from 'path'
import fs from 'fs'
import { Uri, workspace, window, commands } from 'vscode'
import { Commands } from './commands'
import { ExtensionModule } from '~/modules'
import { Global, CurrentFile } from '~/core'
import { Analyst } from '~/core/Analyst'
import { Log } from '~/utils'

export class WriteMissingKeysToFile {
  static async writeMissingKeys() {
    try {
      const loader = CurrentFile.loader
      if (!loader) {
        window.showWarningMessage('No i18n loader found. Please configure locales first.')
        return
      }

      // Get all missing and empty keys across all locales
      const allMissingKeys = new Set<string>()
      const allEmptyKeys = new Set<string>()
      const missingKeysByLocale: Record<string, string[]> = {}
      const emptyKeysByLocale: Record<string, string[]> = {}
      const codeDetectedMissingKeys = new Set<string>()

      // Get keys detected in code but not in locale files
      try {
        const usageReport = await Analyst.analyzeUsage()
        if (usageReport.missing) {
          usageReport.missing.forEach(item => {
            codeDetectedMissingKeys.add(item.keypath)
            allMissingKeys.add(item.keypath)
          })
        }
      } catch (error) {
        Log.warn(`Failed to analyze code usage for missing keys: ${String(error)}`)
      }

      for (const locale of Global.visibleLocales) {
        const keys = loader.keys
        const cov = loader.getCoverage(locale, keys)
        
        if (cov) {
          if (cov.missingKeys.length > 0) {
            missingKeysByLocale[locale] = cov.missingKeys
            cov.missingKeys.forEach(key => allMissingKeys.add(key))
          }
          if (cov.emptyKeys.length > 0) {
            emptyKeysByLocale[locale] = cov.emptyKeys
            cov.emptyKeys.forEach(key => allEmptyKeys.add(key))
          }
        }
      }

      if (allMissingKeys.size === 0 && allEmptyKeys.size === 0) {
        window.showInformationMessage('No missing or empty keys found! 🎉')
        return
      }

      // Ask user where to save the file
      const saveUri = await window.showSaveDialog({
        defaultUri: Uri.file(path.join(workspace.workspaceFolders?.[0]?.uri.fsPath || '', 'missing_keys.txt')),
        filters: {
          'Text files': ['txt'],
          'JSON files': ['json'],
          'All files': ['*']
        }
      })

      if (!saveUri) {
        return
      }

      const filePath = saveUri.fsPath
      const fileExtension = path.extname(filePath).toLowerCase()

      let content = ''
      
      if (fileExtension === '.json') {
        // Create JSON format
        content = JSON.stringify({
          summary: {
            totalMissingKeys: allMissingKeys.size,
            totalEmptyKeys: allEmptyKeys.size,
            codeDetectedMissingKeys: codeDetectedMissingKeys.size,
            locales: Object.keys(missingKeysByLocale).length,
            generatedAt: new Date().toISOString()
          },
          missingKeysByLocale,
          emptyKeysByLocale,
          codeDetectedMissingKeys: Array.from(codeDetectedMissingKeys).sort(),
          allMissingKeys: Array.from(allMissingKeys).sort(),
          allEmptyKeys: Array.from(allEmptyKeys).sort()
        }, null, 2)
      } else {
        // Create text format
        content = `# Translation Keys Report
        Generated: ${new Date().toISOString()}
        Total Missing Keys: ${allMissingKeys.size}
        Total Empty Keys: ${allEmptyKeys.size}
        Code-Detected Missing Keys: ${codeDetectedMissingKeys.size}
        Locales: ${Object.keys(missingKeysByLocale).length}

        ## Code-Detected Missing Keys (Used in code but not in any locale)
        ${Array.from(codeDetectedMissingKeys).sort().map(key => `- ${key}`).join('\n')}

        ## Missing Keys by Locale
        ${Object.entries(missingKeysByLocale).map(([locale, keys]) => 
        `\n### ${locale} (${keys.length} missing)\n${keys.map(key => `- ${key}`).join('\n')}`
        ).join('\n')}

        ## Empty Keys by Locale
        ${Object.entries(emptyKeysByLocale).map(([locale, keys]) => 
        `\n### ${locale} (${keys.length} empty)\n${keys.map(key => `- ${key}`).join('\n')}`
        ).join('\n')}

        ## All Missing Keys (Alphabetical)
        ${Array.from(allMissingKeys).sort().map(key => `- ${key}`).join('\n')}

        ## All Empty Keys (Alphabetical)
        ${Array.from(allEmptyKeys).sort().map(key => `- ${key}`).join('\n')}
        `
      }

      // Write the file
      fs.writeFileSync(filePath, content, 'utf8')

      // Show success message with option to open file
      const openFile = 'Open File'
      const totalIssues = allMissingKeys.size + allEmptyKeys.size
      const result = await window.showInformationMessage(
        `✅ Translation keys report saved to: ${path.basename(filePath)}\n\nFound ${allMissingKeys.size} missing keys (${codeDetectedMissingKeys.size} from code) and ${allEmptyKeys.size} empty keys (${totalIssues} total issues).`,
        openFile
      )

      if (result === openFile) {
        const document = await workspace.openTextDocument(filePath)
        await window.showTextDocument(document)
      }

      Log.info(`Missing keys report saved to: ${filePath}`)

    } catch (error) {
      Log.error(error)
      window.showErrorMessage(`Failed to write missing keys file: ${String(error)}`)
    }
  }

  static async writeMissingKeysToWorkspace() {
    try {
      const workspaceRoot = workspace.workspaceFolders?.[0]?.uri.fsPath
      if (!workspaceRoot) {
        window.showWarningMessage('No workspace found.')
        return
      }

      const loader = CurrentFile.loader
      if (!loader) {
        window.showWarningMessage('No i18n loader found. Please configure locales first.')
        return
      }

      // Get all missing and empty keys
      const allMissingKeys = new Set<string>()
      const allEmptyKeys = new Set<string>()
      const missingKeysByLocale: Record<string, string[]> = {}
      const emptyKeysByLocale: Record<string, string[]> = {}
      const codeDetectedMissingKeys = new Set<string>()

      // Get keys detected in code but not in locale files
      try {
        const usageReport = await Analyst.analyzeUsage()
        if (usageReport.missing) {
          usageReport.missing.forEach(item => {
            codeDetectedMissingKeys.add(item.keypath)
            allMissingKeys.add(item.keypath)
          })
        }
      } catch (error) {
        Log.warn(`Failed to analyze code usage for missing keys: ${String(error)}`)
      }

      for (const locale of Global.visibleLocales) {
        const keys = loader.keys
        const cov = loader.getCoverage(locale, keys)
        
        if (cov) {
          if (cov.missingKeys.length > 0) {
            missingKeysByLocale[locale] = cov.missingKeys
            cov.missingKeys.forEach(key => allMissingKeys.add(key))
          }
          if (cov.emptyKeys.length > 0) {
            emptyKeysByLocale[locale] = cov.emptyKeys
            cov.emptyKeys.forEach(key => allEmptyKeys.add(key))
          }
        }
      }

      if (allMissingKeys.size === 0 && allEmptyKeys.size === 0) {
        window.showInformationMessage('No missing or empty keys found! 🎉')
        return
      }

      // Write to workspace root
      const filePath = path.join(workspaceRoot, 'translation_keys_report.txt')
      const content = `# Translation Keys Report
        Generated: ${new Date().toISOString()}
        Total Missing Keys: ${allMissingKeys.size}
        Total Empty Keys: ${allEmptyKeys.size}
        Code-Detected Missing Keys: ${codeDetectedMissingKeys.size}
        Locales: ${Object.keys(missingKeysByLocale).length}

        ## Code-Detected Missing Keys (Used in code but not in any locale)
        ${Array.from(codeDetectedMissingKeys).sort().map(key => `- ${key}`).join('\n')}

        ## Missing Keys by Locale
        ${Object.entries(missingKeysByLocale).map(([locale, keys]) => 
        `\n### ${locale} (${keys.length} missing)\n${keys.map(key => `- ${key}`).join('\n')}`
        ).join('\n')}

        ## Empty Keys by Locale
        ${Object.entries(emptyKeysByLocale).map(([locale, keys]) => 
        `\n### ${locale} (${keys.length} empty)\n${keys.map(key => `- ${key}`).join('\n')}`
        ).join('\n')}

        ## All Missing Keys (Alphabetical)
        ${Array.from(allMissingKeys).sort().map(key => `- ${key}`).join('\n')}

        ## All Empty Keys (Alphabetical)
        ${Array.from(allEmptyKeys).sort().map(key => `- ${key}`).join('\n')}
        `

      fs.writeFileSync(filePath, content, 'utf8')

      const totalIssues = allMissingKeys.size + allEmptyKeys.size
      window.showInformationMessage(
        `✅ Translation keys report saved to workspace root: translation_keys_report.txt\n\nFound ${allMissingKeys.size} missing keys (${codeDetectedMissingKeys.size} from code) and ${allEmptyKeys.size} empty keys (${totalIssues} total issues).`
      )

      Log.info(`Missing keys report saved to: ${filePath}`)

    } catch (error) {
      Log.error(error)
      window.showErrorMessage(`Failed to write missing keys file: ${String(error)}`)
    }
  }
}

export default <ExtensionModule> function() {
  return [
    commands.registerCommand(Commands.write_missing_keys,
      () => WriteMissingKeysToFile.writeMissingKeys()),
  ]
}
