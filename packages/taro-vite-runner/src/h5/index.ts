import multiPlatformPlugin from '../common/multi-platform-plugin'
import assetsPlugin from './assets'
import configPlugin from './config'
import entryPlugin from './entry'
import pipelinePlugin from './pipeline'

import type { PluginOption } from 'vite'
import type { TaroCompiler } from '../utils/compiler/h5'

export default function (compiler: TaroCompiler): PluginOption[] {
  return [
    pipelinePlugin(compiler),
    configPlugin(compiler),
    entryPlugin(compiler),
    multiPlatformPlugin(compiler),
    assetsPlugin(compiler),
  ]
}
