const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (env, argv) => {
  const prod = argv.mode === 'production';
  return {
    context: __dirname,
    entry: './src/index.js',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: prod ? 'assets/[name].[contenthash].js' : 'assets/[name].js',
      publicPath: '/',
      clean: true,
    },
    resolve: {
      extensions: ['.js', '.jsx'],
      modules: [path.resolve(__dirname, '../node_modules'), 'node_modules'],
    },
    module: {
      rules: [
        {
          test: /\.m?js$/,
          resolve: { fullySpecified: false },
        },
        {
          test: /\.jsx?$/,
          exclude: /node_modules/,
          use: 'babel-loader',
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './public/index.html',
      }),
    ],
    devServer: {
      port: 8080,
      host: '127.0.0.1',
      historyApiFallback: true,
      hot: true,
      proxy: [
        {
          context: ['/api'],
          target: 'http://127.0.0.1:4000',
          changeOrigin: true,
        },
      ],
    },
    devtool: prod ? false : 'eval-cheap-module-source-map',
    performance: { hints: false },
    stats: 'errors-warnings',
  };
};
