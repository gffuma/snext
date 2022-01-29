import path from 'path'
import express from 'express'
import webpack from 'webpack'
import nodeExternals from 'webpack-node-externals'
import ReactRefreshWebpackPlugin from '@pmmmwh/react-refresh-webpack-plugin'
import webpackDevMiddleware from 'webpack-dev-middleware'
import webpackHotMiddleware from 'webpack-hot-middleware'
import render from './render'
import logo from './logo'

export interface DevServerOptions {
  clientEntry: string
  serverEntry: string
  skeletonEntry: string
  port: number
}

export default async function devServer({
  clientEntry,
  serverEntry,
  skeletonEntry,
  port = 7000,
}: DevServerOptions) {
  const compiler = webpack([
    {
      name: 'client',
      mode: 'development',
      target: 'web',
      entry: [
        'webpack-hot-middleware/client?reload=true&name=client',
        clientEntry,
      ],
      output: {
        filename: 'bundle.js',
      },
      module: {
        rules: [
          {
            test: /\.m?js$/,
            exclude: /(node_modules)/,
            use: {
              loader: 'babel-loader',
              options: {
                presets: [
                  [
                    'react-app',
                    {
                      runtime: 'automatic',
                    },
                  ],
                ],
                plugins: [require.resolve('react-refresh/babel')],
              },
            },
          },
          {
            test: /\.css$/i,
            loader: 'css-loader',
          },
          {
            test: [/\.bmp$/, /\.gif$/, /\.jpe?g$/, /\.png$/],
            type: 'asset',
            parser: {
              dataUrlCondition: {
                maxSize: 10000,
              },
            },
          },
        ],
      },
      plugins: [
        new webpack.HotModuleReplacementPlugin(),
        new ReactRefreshWebpackPlugin(),
      ],
    },
    {
      name: 'server',
      mode: 'development',
      target: 'node',
      entry: {
        App: serverEntry,
        Skeleton: skeletonEntry,
      },
      externalsPresets: { node: true }, // in order to ignore built-in modules like path, fs, etc.
      externals: [nodeExternals()], // in order to ignore all modules in node_modules folder
      output: {
        path: path.join(process.cwd(), '.snext'),
        filename: '[name].js',
        libraryTarget: 'umd',
        libraryExport: 'default',
        publicPath: '/',
        assetModuleFilename: 'static/media/[name].[hash][ext]',
      },
      module: {
        rules: [
          {
            test: /\.m?js$/,
            exclude: /(node_modules)/,
            use: {
              loader: 'babel-loader',
              options: {
                presets: [
                  [
                    '@babel/preset-react',
                    {
                      runtime: 'automatic',
                    },
                  ],
                ],
              },
            },
          },
          {
            test: /\.css$/i,
            loader: 'css-loader',
            options: {
              modules: {
                exportOnlyLocals: true,
              },
            },
          },
          {
            test: [/\.bmp$/, /\.gif$/, /\.jpe?g$/, /\.png$/],
            type: 'asset',
            generator: {
              emit: false,
            },
            parser: {
              dataUrlCondition: {
                maxSize: 10000,
              },
            },
          },
        ],
      },
    },
  ])

  const app = express()

  const instance = webpackDevMiddleware(compiler, {
    writeToDisk: (target) => {
      if (path.relative(process.cwd(), target).startsWith('.snext')) {
        return true
      }
      return false
    },
  })

  app.use(webpackHotMiddleware(compiler))

  app.use(instance)

  app.use(async (req, res) => {
    const appPath = path.join(process.cwd(), '.snext', 'App.js')
    delete require.cache[require.resolve(appPath)]
    const App = require(appPath)

    const skeletonPath = path.join(process.cwd(), '.snext', 'Skeleton.js')
    delete require.cache[require.resolve(skeletonPath)]
    const Skeleton = require(skeletonPath)

    const html = await render(
      {
        App,
        Skeleton,
      },
      { url: req.url, entrypoints: ['build.js'] }
    )
    res.send(html)
  })

  app.listen(port, () => {
    console.log(logo)
    console.log(`Listen on port ${port}`)
  })
}
