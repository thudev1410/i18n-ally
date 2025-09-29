import { commands } from 'vscode'
import { Commands } from './commands'
import { manageAutoSavePreferences } from './manageAutoSavePreferences'
import { ExtensionModule } from '~/modules'

const m: ExtensionModule = () => {
  return [
    commands.registerCommand(Commands.manage_auto_save_preferences, manageAutoSavePreferences),
  ]
}

export default m
