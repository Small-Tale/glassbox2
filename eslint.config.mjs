import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import importX from 'eslint-plugin-import-x';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import kerfjs from 'eslint-plugin-kerfjs';
import tseslint from 'typescript-eslint';

const noPrettierIgnore = {
  rules: {
    'no-prettier-ignore': {
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              if (/\bprettier-ignore\b/u.test(comment.value))
                context.report({ loc: comment.loc, message: 'Remove prettier-ignore; fix the formatting.' });
            }
          },
        };
      },
    },
  },
};

const config = tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'component-composition.json'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked, kerfjs.configs['recommended-ui']],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: {
      '@stylistic': stylistic,
      import: importX,
      'simple-import-sort': simpleImportSort,
      local: noPrettierIgnore,
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNumber: true,
          allowBoolean: true,
          allow: [
            { from: 'file', name: 'SafeHtml' },
            { from: 'lib', name: 'URLSearchParams' },
          ],
        },
      ],
      'import/first': 'error',
      'import/newline-after-import': 'error',
      'import/no-duplicates': 'error',
      '@stylistic/max-len': [
        'error',
        {
          code: 200,
          ignoreComments: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreRegExpLiterals: true,
          ignoreUrls: true,
        },
      ],
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      '@stylistic/jsx-self-closing-comp': ['error', { component: true, html: true }],
      'local/no-prettier-ignore': 'error',
    },
  },
);

export default config;
