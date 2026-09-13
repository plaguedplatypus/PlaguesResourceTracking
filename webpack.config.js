const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");

/**
 * @type {import("webpack").Configuration}
 */
module.exports = {
  context: path.resolve(__dirname, "src"),
  entry: "./index.ts",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "main.js",
    clean: true
  },
  devtool: false,
  mode: "production",
  // prevent webpack from bundling these imports (alt1 libs can use them when running in nodejs)
  externals: [
    "sharp",
    "canvas",
    "electron/common"
  ],
  performance: {
    hints: false,
  },
  resolve: {
    extensions: [".wasm", ".tsx", ".ts", ".mjs", ".jsx", ".js"],
    alias: {
      // Compile the active chatbox infrastructure from source so webpack
      // can retain only the assets used by the custom decoder.
      "alt1/chatbox$": path.resolve(__dirname, "node_modules/alt1/src/chatbox/index.ts"),
      // Alt1's source declares this legacy font but never reads it.
      [path.resolve(__dirname, "node_modules/alt1/src/fonts/aa_8px.fontmeta.json")]: false,
      // Resource Tracker intentionally supports only 10pt through 16pt.
      // ChatBoxReader is retained for discovery, but its unused larger
      // font assets must not remain in the production bundle.
      [path.resolve(__dirname, "node_modules/alt1/src/fonts/chatbox/18pt.fontmeta.json")]: false,
      [path.resolve(__dirname, "node_modules/alt1/src/fonts/chatbox/20pt.fontmeta.json")]: false,
      [path.resolve(__dirname, "node_modules/alt1/src/fonts/chatbox/22pt.fontmeta.json")]: false,
    },
  },
  module: {
    // The rules section tells webpack what to do with different file types when you import them from js/ts
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: "ts-loader",
          options: {
            transpileOnly: true
          }
        },
        exclude: /node_modules[\\/](?!alt1[\\/])/
      },
      { test: /\.css$/, use: ["style-loader", { loader: "css-loader", options: { url: false }, },] },
      { test: /\.scss$/, use: ["style-loader", "css-loader", "sass-loader"] },
      // type:"asset" means that webpack copies the file and gives you an url to them when you import them from js
      { test: /\.(png|jpg|jpeg|gif|webp)$/, type: "asset/resource", generator: { filename: "[base]" } },
      // Modern chat definitions are OCR data, not runtime URL assets.
      { test: /chat_\d+pt\.json$/, type: "json" },
      { test: /\.(html|json)$/, exclude: [/\.fontmeta\.json$/, /chat_\d+pt\.json$/], type: "asset/resource", generator: { filename: "[base]" } },
      // file types useful for writing alt1 apps, make sure these two loader come after any other json or png loaders, otherwise they will be ignored
      { test: /\.data\.png$/, loader: "alt1/imagedata-loader", type: "javascript/auto" },
      { test: /\.fontmeta\.json$/, loader: "alt1/font-loader", type: "json" }
    ]
  },

  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: "index.html", to: "index.html" },
        { from: "appconfig.json", to: "appconfig.json" },
        { from: "icons", to: "icons" },
        { from: "screenshots", to: "screenshots" }
      ]
    })
  ],
  devServer: {
    static: { directory: path.resolve(__dirname, "dist") },
    port: 8080,
    hot: true,
    client: { overlay: true }
  },
};
