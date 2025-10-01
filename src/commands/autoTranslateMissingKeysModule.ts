import { commands } from 'vscode'
import { Commands } from './commands'
import { autoTranslateMissingKeys } from './autoTranslateMissingKeys'
import { ExtensionModule } from '~/modules'

export default <ExtensionModule> function() {
  return [
    commands.registerCommand(Commands.auto_translate_missing_keys,
      () => autoTranslateMissingKeys())
  ]
}
