import type { StorybookConfig } from "@storybook/react-vite";
import { resolve } from "node:path";

const config: StorybookConfig = {
  stories: ["../design/stories/**/*.stories.@(ts|tsx)"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  viteFinal(config) {
    return {
      ...config,
      resolve: {
        ...config.resolve,
        alias: [
          { find: "@", replacement: resolve(import.meta.dirname, "..") },
        ],
      },
    };
  },
};

export default config;
