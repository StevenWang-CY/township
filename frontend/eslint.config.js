// Flat config: TypeScript + React hooks + accessibility over the app source,
// the scripts and the e2e specs. `npm run lint` (also part of `make lint`).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "dist-demo/**", "node_modules/**", "public/**", "src/game/stampDefs.json", "playwright-report/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      // React Compiler-era checks: valuable direction, but the existing
      // effect/ref patterns are covered by the e2e suite. Warn while they
      // are worked down, never block the build on them.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      // The chat composer and dialogs focus their first control on open by design.
      "jsx-a11y/no-autofocus": "off",
      // Scrollable lists take focus so keyboard users can scroll them.
      "jsx-a11y/no-noninteractive-tabindex": ["error", { roles: ["tabpanel", "list", "region"], allowExpressionValues: true }],
      // Choice cards nest their text a few levels inside the label.
      "jsx-a11y/label-has-associated-control": ["error", { depth: 5 }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["scripts/**/*.mjs", "e2e/**/*.ts", "*.config.{js,ts}", "vitest.config.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
);
