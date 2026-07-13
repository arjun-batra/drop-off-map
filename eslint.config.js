import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importX from "eslint-plugin-import-x";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default [
  {
    ignores: ["dist", "node_modules", ".vercel"],
  },
  js.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        // Ambient global injected by Google's Maps JavaScript API script tag
        // at runtime (INC-10, FR-022) -- only ever referenced in type
        // positions here (e.g. `typeof google.maps.Size`), backed by the
        // @types/google.maps package (tsconfig.json's "types" array), not a
        // real module import ESLint/no-undef would otherwise recognize.
        google: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // REV-018 recurrence prevention: api/**.ts + non-frontend src/**.ts are executed
    // by Node's real ESM loader on Vercel, which requires explicit extensions on
    // relative specifiers, unlike tsconfig's Bundler resolution used for typecheck/build.
    // src/frontend/** is excluded — it's only ever bundled by Vite, never Node-ESM-loaded,
    // and existing convention there omits extensions.
    files: ["api/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
    ignores: ["src/frontend/**"],
    plugins: {
      "import-x": importX,
    },
    rules: {
      "import-x/extensions": ["error", "always", { ignorePackages: true }],
    },
  },
];
