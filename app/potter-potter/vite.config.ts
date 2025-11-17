import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { NodeGlobalsPolyfillPlugin } from "@esbuild-plugins/node-globals-polyfill";
import { NodeModulesPolyfillPlugin } from "@esbuild-plugins/node-modules-polyfill";

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
    NodeGlobalsPolyfillPlugin({
      process: true,
    }),
    NodeModulesPolyfillPlugin(),
  ],
  optimizeDeps: {
    include: [
      "@solana/web3.js",
      "@solana/wallet-adapter-react",
      "@coral-xyz/anchor",
      "@solana/wallet-adapter-base",
      "@solana/wallet-adapter-react-ui",
      "@solana/wallet-adapter-wallets",
      "@solana/spl-token",
    ],
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
      plugins: [
        NodeGlobalsPolyfillPlugin({
          process: true,
        }),
        NodeModulesPolyfillPlugin(),
      ],
    },
  },
});
