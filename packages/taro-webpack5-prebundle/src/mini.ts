// Inspired by [vite](https://github.com/vitejs/vite)
/** @license
 * MIT License
 *
 * Copyright (c) 2019-present, Yuxi (Evan) You and Vite contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import fs from 'fs-extra'
import path from 'path'
import { performance } from 'perf_hooks'
import webpack from 'webpack'

import BasePrebundle, { IPrebundleConfig } from './prebundle'
import { bundle } from './prebundle/bundle'
import {
  createResolve,
  flattenId,
  getBundleHash,
  getMfHash
} from './utils'
import { MF_NAME } from './utils/constant'
import TaroModuleFederationPlugin from './webpack/TaroModuleFederationPlugin'

export interface IMiniPrebundleConfig extends IPrebundleConfig {
  runtimePath?: string | string[]
}

export class MiniPrebundle extends BasePrebundle<IMiniPrebundleConfig> {
  async run () {
    const { appPath, cacheDir, customEsbuildConfig, prebundleCacheDir, remoteCacheDir, metadata, preMetadata } = this
    this.isUseCache = true

    const resolveOptions = this.chain.toConfig().resolve
    createResolve(appPath, resolveOptions)

    const { entryFileName = 'app', entry = {} } = this.config
    const { include = [], exclude = [] } = this.option

    /** 1. 扫描出所有的 node_modules 依赖 */
    /**
     * 找出所有 webpack entry
     * TODO:
     *   - 目前只处理了 Page entry，例如原生小程序组件 js entry 等并没有处理
     */
    const entries: string[] = this.getEntries(entry[entryFileName][0])
    // plugin-platform 等插件的 runtime 文件入口
    const runtimePath = typeof this.config.runtimePath === 'string' ? [this.config.runtimePath] : this.config.runtimePath || []
    const deps = await this.getDeps(entries,
      ['@tarojs/taro', '@tarojs/runtime'].concat(
        ...runtimePath.map(item => item.replace(/^post:/, '')),
        include
      ),
      [
        '@tarojs/components' // 小程序编译 Host 时需要扫描 @tarojs/components 的 useExports，因此不能被 external
      ].concat(exclude)
    )

    /** 2. 使用 esbuild 对 node_modules 依赖进行 bundle */
    const PREBUNDLE_START = performance.now()

    metadata.bundleHash = await getBundleHash(appPath, deps, this.chain, cacheDir)

    if (preMetadata.bundleHash !== metadata.bundleHash) {
      this.isUseCache = false

      const { metafile } = await bundle(appPath, deps, this.chain, prebundleCacheDir, customEsbuildConfig)

      // 找出 @tarojs/runtime 被 split 切分的 chunk，作为后续 ProvidePlugin 的提供者。
      // 原因是 @tarojs/runtime 里使用了一些如 raf、caf 等全局变量，又因为 esbuild 把
      // @tarojs/runtime split 成 entry 和依赖 chunk 两部分。如果我们把 entry 作为
      // ProvidePlugin 的提供者，依赖 chunk 会被注入 raf、caf，导致循环依赖的问题。所以
      // 这种情况下只能把依赖 chunk 作为 ProvidePlugin 的提供者。
      Object.keys(metafile.outputs).some(key => {
        const output = metafile.outputs[key]
        if (output.entryPoint === 'entry:@tarojs_runtime') {
          const dep = output.imports.find(dep => {
            const depPath = dep.path
            const depOutput = metafile.outputs[depPath]
            return depOutput.exports.includes('TaroRootElement')
          })
          if (dep) {
            metadata.taroRuntimeBundlePath = path.join(appPath, dep.path)
          }
          return true
        }
      })
    } else {
      metadata.taroRuntimeBundlePath = path.join(appPath, preMetadata.taroRuntimeBundlePath!)
    }

    this.measure('Prebundle duration', PREBUNDLE_START)

    /** 3. 把依赖的 bundle 产物打包成 Webpack Module Federation 格式 */
    const BUILD_LIB_START = performance.now()

    const exposes: Record<string, string> = {}
    const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development'
    const devtool = this.config.enableSourceMap && 'hidden-source-map'
    const mainBuildOutput = this.chain.output.entries()
    const taroRuntimeBundlePath: string = metadata.taroRuntimeBundlePath || exposes['./@tarojs/runtime']
    const output = {
      path: remoteCacheDir,
      chunkLoadingGlobal: mainBuildOutput.chunkLoadingGlobal,
      globalObject: mainBuildOutput.globalObject
    }
    const provideObject = {
      window: [taroRuntimeBundlePath, 'window$1'],
      document: [taroRuntimeBundlePath, 'document$1'],
      navigator: [taroRuntimeBundlePath, 'navigator'],
      requestAnimationFrame: [taroRuntimeBundlePath, 'raf'],
      cancelAnimationFrame: [taroRuntimeBundlePath, 'caf'],
      Element: [taroRuntimeBundlePath, 'TaroElement'],
      SVGElement: [taroRuntimeBundlePath, 'SVGElement'],
      MutationObserver: [taroRuntimeBundlePath, 'MutationObserver']
    }
    const customWebpackConfig = this.option.webpack
    if (customWebpackConfig?.provide?.length) {
      customWebpackConfig.provide.forEach(cb => {
        cb(provideObject, taroRuntimeBundlePath)
      })
    }

    metadata.mfHash = getMfHash({
      bundleHash: metadata.bundleHash,
      mode,
      devtool,
      output,
      taroRuntimeBundlePath
    })

    if (preMetadata.mfHash !== metadata.mfHash) {
      this.isUseCache = false

      fs.existsSync(remoteCacheDir) && fs.emptyDirSync(remoteCacheDir)

      for (const id of deps.keys()) {
        const flatId = flattenId(id)
        exposes[`./${id}`] = path.join(prebundleCacheDir, `${flatId}.js`)
      }
      metadata.runtimeRequirements = new Set<string>()

      const compiler = webpack({
        devtool,
        entry: path.resolve(__dirname, './webpack/index.js'),
        mode,
        output,
        plugins: [
          new TaroModuleFederationPlugin(
            {
              name: MF_NAME,
              filename: 'remoteEntry.js',
              runtime: 'runtime',
              exposes
            },
            {
              deps,
              env: this.env,
              remoteAssets: metadata.remoteAssets,
              runtimeRequirements: metadata.runtimeRequirements
            }
          ),
          new webpack.ProvidePlugin(provideObject)
        ],
        cache: {
          type: 'filesystem',
          cacheDirectory: path.join(cacheDir, 'webpack-cache'),
          buildDependencies: {
            config: Object.values(exposes)
          }
        }
      })
      metadata.remoteAssets = await new Promise((resolve, reject) => {
        compiler.run((error: Error, stats: webpack.Stats) => {
          compiler.close(err => {
            if (error || err) return reject(error || err)
            const { assets = [], errors = [] } = stats.toJson()
            if (errors[0]) return reject(errors[0])
            const remoteAssets =
              assets
                ?.filter(item => item.name !== 'runtime.js')
                ?.map(item => ({
                  name: path.join('prebundle', item.name)
                })) || []
            resolve(remoteAssets)
          })
        })
      })
    } else {
      metadata.runtimeRequirements = new Set(preMetadata.runtimeRequirements)
      metadata.remoteAssets = preMetadata.remoteAssets
    }

    fs.copy(remoteCacheDir, path.join(mainBuildOutput.path, 'prebundle'))

    this.measure(`Build remote ${MF_NAME} duration`, BUILD_LIB_START)

    /** 4. 项目 Host 配置 Module Federation */
    const MfOpt = {
      name: 'taro-app',
      remotes: {
        [MF_NAME]: `${MF_NAME}@remoteEntry.js`
      }
    }
    this.chain
      .plugin('TaroModuleFederationPlugin')
      .use(TaroModuleFederationPlugin, [MfOpt,
        {
          deps,
          env: this.env,
          remoteAssets: metadata.remoteAssets,
          runtimeRequirements: metadata.runtimeRequirements
        }])

    await super.run()
  }
}