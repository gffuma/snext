import sourceMap from 'source-map-support'
import fs from 'fs/promises'
import path from 'path'
import ncpCB from 'ncp'
import util from 'util'
import { parse as parseHTML } from 'node-html-parser'
import mkdirp from 'mkdirp'
import rimraf from 'rimraf'
import chalk from 'chalk'
import PQueue from 'p-queue'
import { render } from '@pluffa/node-render'
import { CrawlSession, createCrawlSession, CrawlContext } from '@pluffa/crawl'
import { RegisterStatik } from '@pluffa/statik/runtime'

const ncp = util.promisify(ncpCB)

interface ProcessContract {
  exitOnError: boolean
  crawEnabled: boolean
  renderURL(url: string): Promise<[string, string[]]>
  saveFile(url: string, html: string): Promise<void>
}

function getPathFromUrl(url: string) {
  return url.split(/[?#]/)[0]
}

const AbsoluteURLRegex = new RegExp('^(?:[a-z]+:)?//', 'i')
function isUrlAbsolute(url: string) {
  return AbsoluteURLRegex.test(url)
}

async function processURL(url: string, config: ProcessContract) {
  console.log(chalk.bold.cyan(url))
  const { renderURL, saveFile } = config

  try {
    const [html, urls] = await renderURL(url)
    if (config.crawEnabled) {
      const document = parseHTML(html)
      document
        .getElementsByTagName('a')
        .map((l) => l.attributes.href)
        .filter((url) => !isUrlAbsolute(url))
        .forEach((url) => urls.push(getPathFromUrl(url)))
      document
        .querySelectorAll('[data-crawl-url]')
        .map((l) => l.attributes['data-crawl-url'])
        .filter((url) => !isUrlAbsolute(url))
        .forEach((url) => urls.push(getPathFromUrl(url)))
    }
    await saveFile(url, html)
    return { sourceUrl: url, success: true, urls }
  } catch (error) {
    console.log(chalk.bold.red(`⚠️  ${url}`))
    console.log(chalk.red('Error during rendering'))
    console.error(error)
    if (config.exitOnError) {
      process.exit(1)
    }
    return { sourceUrl: url, success: false, urls: [] }
  }
}

async function processURLs(
  urls: string[],
  concurrency: number,
  config: ProcessContract
) {
  const queue = new PQueue({ concurrency })
  const uniqeUrls = new Set<string>()
  let succeded = 0
  const failedUrls: string[] = []

  function enqueueUrl(url: string) {
    if (!uniqeUrls.has(url)) {
      uniqeUrls.add(url)
      queue.add(() => processURL(url, config))
    }
  }

  queue.on(
    'completed',
    ({
      urls,
      success,
      sourceUrl,
    }: {
      urls: string[]
      success: boolean
      sourceUrl: string
    }) => {
      urls.forEach((url) => enqueueUrl(url))
      if (success) {
        succeded++
      } else {
        failedUrls.push(sourceUrl)
      }
    }
  )

  urls.forEach((url) => enqueueUrl(url))
  await queue.onIdle()
  return {
    succeded,
    failedUrls,
  }
}

function informMissingBuildStep() {
  console.error(
    chalk.red(
      'Pluffa.js error you need to build your project before run staticize.\n'
    )
  )
}

function handleImportError(err: any): never {
  if (err.code === 'ERR_MODULE_NOT_FOUND') {
    informMissingBuildStep()
  }
  throw err
}

function handleFileNotFoundError(err: any): never {
  if (
    Array.isArray(err)
      ? err.some((e) => e.code === 'ENOENT')
      : err.code === 'ENOENT'
  ) {
    informMissingBuildStep()
  }
  throw err
}

export default async function staticize({
  outputDir,
  publicDir,
  compileNodeCommonJS,
  urls,
  crawlConcurrency,
  statikDataDir,
  statikEnabled = false,
  crawEnabled = true,
  exitOnError = false,
}: {
  outputDir: string
  publicDir: string
  compileNodeCommonJS: boolean
  urls: string[]
  crawlConcurrency: number
  crawEnabled: boolean
  statikEnabled: boolean
  statikDataDir: string | false
  exitOnError: boolean
}) {
  sourceMap.install()

  const outPath = path.resolve(process.cwd(), outputDir)
  const publicPath = path.resolve(process.cwd(), publicDir)
  const buildClientPath = path.resolve(process.cwd(), '.pluffa/client')
  const buildNodePath = path.resolve(process.cwd(), '.pluffa/node')
  const buildImportExt = `${compileNodeCommonJS ? '' : 'm'}js`

  // NOTE: Ok, this should be do better but for now as workaround
  // expose them as env var...
  process.env.PLUFFA_BUILD_CLIENT_PATH = buildClientPath

  try {
    // Remove stale ourput
    rimraf.sync(outPath)
    // Copy public
    await ncp(publicPath, outPath)
    // Copy static from builded client
    await ncp(
      path.join(buildClientPath, 'static'),
      path.join(outPath, 'static')
    )
  } catch (err) {
    handleFileNotFoundError(err)
  }

  // Read build manifest
  const manifest = JSON.parse(
    await fs
      .readFile(path.join(buildClientPath, 'manifest.json'), 'utf-8')
      .catch(handleFileNotFoundError)
  )

  // NOTE: Set a flag so we can do different stuff during staticize
  process.env.PLUFFA_RUN_STATICIZE = '1'

  // Unifrom ESM vs CommonJS
  const uniformExport = (o: any) => (compileNodeCommonJS ? o.default : o)

  // Configure Statik
  if (statikEnabled) {
    // NOTE: We Inject the current user code for registerStatik
    // to inject into the correct version CommonJS vs ESM
    // we also import the correct version of statik runtime
    const getStatikRunTime: () => Promise<{
      configureStatikDataDir(dataDir: string): void
      configureRegisterStatik(register: RegisterStatik): void
    }> = compileNodeCommonJS
      ? async () => require('@pluffa/statik/runtime')
      : async () => await import('@pluffa/statik/runtime')

    const { configureRegisterStatik, configureStatikDataDir } =
      await getStatikRunTime()

    const { default: registerStatik } = await import(
      path.join(buildNodePath, `statik.${buildImportExt}`)
    )
      .catch(handleImportError)
      .then(uniformExport)

    configureRegisterStatik(registerStatik)
    if (statikDataDir !== false) {
      configureStatikDataDir(path.resolve(outPath, statikDataDir))
    }
  }

  const appPath = path.join(buildNodePath, `App.${buildImportExt}`)
  const {
    default: App,
    getSkeletonProps,
    getStaticProps,
  } = await import(appPath).catch(handleImportError).then(uniformExport)

  const skeletonPath = path.join(buildNodePath, `Skeleton.${buildImportExt}`)
  const { default: Skeleton } = await import(skeletonPath)
    .catch(handleImportError)
    .then(uniformExport)

  const { succeded, failedUrls } = await processURLs(urls, crawlConcurrency, {
    exitOnError,
    crawEnabled,
    async renderURL(url) {
      let RenderApp = App
      let crawlSess: CrawlSession
      if (crawEnabled) {
        crawlSess = createCrawlSession()
        RenderApp = (props: Record<string, any>) => (
          <CrawlContext.Provider value={crawlSess}>
            <App {...props} />
          </CrawlContext.Provider>
        )
      }
      let html = await render(
        {
          App: RenderApp,
          getSkeletonProps,
          getStaticProps,
          Skeleton,
          throwOnError: true,
        },
        {
          url,
          entrypoints: manifest.entrypoints,
        }
      )
      html = `<!DOCTYPE html>${html}`
      let urls: string[] = []
      if (crawEnabled) {
        urls = await crawlSess!.rewind()
      }
      return [html, urls]
    },
    async saveFile(url, html) {
      let filePath = path.join(outputDir, url)
      if (!filePath.endsWith('.html')) {
        mkdirp.sync(filePath)
        filePath = path.join(filePath, 'index.html')
      } else {
        mkdirp.sync(path.dirname(filePath))
      }
      await fs.writeFile(filePath, html)
    },
  })
  console.log()
  if (failedUrls.length === 0) {
    console.log(chalk.green('WoW all site staticized!'))
  } else {
    console.log(chalk.red('Wops! Some urls fails to staticized ....'))
  }
  console.log()
  console.log('Success:' + '  ' + chalk.green.bold(succeded))
  if (failedUrls.length > 0) {
    console.log('Failed:' + '   ' + chalk.red.bold(failedUrls.length))
    console.log()
    console.log(chalk.red('Urls failed:'))
    failedUrls.forEach((url) => {
      console.log(chalk.red(url))
    })
  }
}
