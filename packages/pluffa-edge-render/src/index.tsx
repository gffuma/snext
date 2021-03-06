import { ComponentType } from 'react'
import {
  renderToString,
  renderToReadableStream,
  RenderToReadableStreamOptions,
} from 'react-dom/server'

async function readResult(stream: ReadableStream) {
  const reader = stream.getReader()
  let result = ''
  const decoder = new TextDecoder('utf-8')
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      return result
    }
    result += decoder.decode(value, { stream: true })
  }
}

export interface PluffaProps<A = any, K = any> {
  /**
   * URL of incoming request
   */
  url: string

  /**
   * List of entrypoints file names by webpack entry name
   */
  entrypoints: Record<string, string[]>

  /**
   * Extra App props
   */
  appProps?: A

  /**
   * Extra Skeleton props
   */
  skeletonProps?: K
}

export interface AppProps {
  /**
   * URL of incoming request
   */
  url: string
}

export interface SkeletonProps {
  /**
   * List of entrypoints file names by webpack entry name
   */
  entrypoints: Record<string, string[]>

  /**
   * Rendered html of app
   */
  appHtml: string
}

export type GetStaticProps<Props = any> = (
  props: AppProps
) => { props: Props } | Promise<{ props: Props }>

export type GetSkeletonProps<StaticProps = any, Props = any> = (
  props: AppProps,
  staticProps: StaticProps
) => { props: Props } | Promise<{ props: Props }>

export type AppComponent<Props> = ComponentType<AppProps & Props>

export type SkeletonComponent<Props> = ComponentType<SkeletonProps & Props>

export async function render<
  StaticProps,
  HydrateSkeletonProps,
  ExtraAppProps,
  ExtraSkeletonProps
>(
  {
    App,
    getStaticProps,
    getSkeletonProps,
    Skeleton,
    ...renderOptions
  }: {
    /**
     * The static App Component
     */
    App: AppComponent<StaticProps & ExtraAppProps>
    /**
     * Called before each request.
     * Get the static props to inject into the App Component.
     */
    getStaticProps?: GetStaticProps<StaticProps>
    /**
     * Callend after the <App /> component has fully rendered.
     * Get the initial data to inject into <Skeleton />.
     */
    getSkeletonProps?: GetSkeletonProps<StaticProps, HydrateSkeletonProps>
    /**
     * The Skeleton Component
     */
    Skeleton: SkeletonComponent<HydrateSkeletonProps & ExtraSkeletonProps>
  } & RenderToReadableStreamOptions,
  props: PluffaProps<ExtraAppProps, ExtraSkeletonProps>
): Promise<string> {
  const { entrypoints, url } = props
  const appProps = { url }
  let staticProps: StaticProps | undefined
  if (getStaticProps) {
    const result = await getStaticProps(appProps)
    staticProps = result.props
  }

  const stream = await renderToReadableStream(
    <App {...staticProps!} {...props.appProps!} url={props.url} />,
    renderOptions
  )
  await stream.allReady
  const appHtml = await readResult(stream)

  let skeletonProps: HydrateSkeletonProps | undefined
  if (getSkeletonProps) {
    const result = await getSkeletonProps(appProps, staticProps!)
    skeletonProps = result.props
  }

  return renderToString(
    <Skeleton
      {...skeletonProps!}
      {...props.skeletonProps!}
      entrypoints={entrypoints}
      appHtml={appHtml}
    />
  )
}
