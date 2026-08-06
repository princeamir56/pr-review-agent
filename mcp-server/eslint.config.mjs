import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
      globals: { console: "readonly", process: "readonly", Buffer: "readonly", setTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly", __dirname: "readonly" }
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      // The agents deliberately narrow unknown shapes by hand (SARIF, Octokit
      // errors); an explicit `any` there is checked at the boundary.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "off",
      eqeqeq: ["error", "smart"],
      "no-console": "off"
    }
  }
];
