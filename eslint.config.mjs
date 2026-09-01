import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    ignores: ["main.js", "test/**"],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs"]
        }
      }
    },
    rules: {
      "obsidianmd/ui/sentence-case": [
        "warn",
        { acronyms: ["TV"], brands: ["TV Progress Sync"] }
      ]
    }
  }
]);
