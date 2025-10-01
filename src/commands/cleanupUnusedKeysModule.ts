import { commands } from 'vscode'
import { Commands } from './commands'
import { cleanupUnusedKeys } from './cleanupUnusedKeys'
import { ExtensionModule } from '~/modules'

const m: ExtensionModule = () => {
  return [
    commands.registerCommand(Commands.cleanup_unused_keys, cleanupUnusedKeys),
  ]
}

export default m
