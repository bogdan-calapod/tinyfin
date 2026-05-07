import js from '@eslint/js';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
    js.configs.recommended,
    eslintConfigPrettier,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                // External libraries
                Hls: 'readonly'
            }
        },
        rules: {
            // Multi-file script globals (classes and instances shared via <script> tags)
            'no-undef': 'off',
            // Best practices
            'eqeqeq': ['error', 'always'],
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-wrappers': 'error',
            'no-throw-literal': 'error',
            'no-useless-return': 'error',
            'no-var': 'error',
            'prefer-const': 'error',
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^(jellyfinAPI|downloadManager)$' }],

            // Downgrade ESLint 10 recommended rules that are too strict for existing code
            'preserve-caught-error': 'warn',

            // Code quality
            'no-duplicate-imports': 'error',
            'no-self-compare': 'error',
            'no-template-curly-in-string': 'warn',
            'no-unmodified-loop-condition': 'warn',
            'no-unreachable-loop': 'error',
            'no-use-before-define': ['error', { functions: false, classes: false }],

            // Style (non-formatting, Prettier handles the rest)
            'no-lonely-if': 'error',
            'no-nested-ternary': 'warn',
            'prefer-template': 'warn',
            'no-console': 'off'
        }
    },
    {
        // Service worker has its own global scope
        files: ['sw.js'],
        languageOptions: {
            globals: {
                ...globals.serviceworker
            }
        }
    },
    {
        ignores: ['node_modules/', 'dist/', 'build/']
    }
];
