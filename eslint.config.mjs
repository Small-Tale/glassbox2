import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
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
    plugins: { '@stylistic': stylistic, 'simple-import-sort': simpleImportSort, local: noPrettierIgnore },
    rules: {
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
