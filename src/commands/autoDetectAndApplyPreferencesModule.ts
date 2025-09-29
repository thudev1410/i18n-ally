import { commands } from 'vscode'
import { Commands } from './commands'
import { autoDetectAndApplyPreferences } from './autoDetectAndApplyPreferences'
import { ExtensionModule } from '~/modules'

const m: ExtensionModule = () => {
  return [
    commands.registerCommand(Commands.auto_detect_and_apply_preferences, autoDetectAndApplyPreferences),
  ]
}

export default m
