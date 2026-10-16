// ioBroker eslint template configuration file for js and ts files
// Please note that esm or react based modules need additional modules loaded.
import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        // specify files to exclude from linting here
        ignores: [
            '.claude/',
            '.dev-server/',
            '.vscode/',
            '**/*.test.js',
            'test/**/*.js',
            '*.config.mjs',
            'build',
            'dist',
            'admin/build',
            'admin/admin.d.ts',
            'admin/blockly.js',
            '**/adapter-config.d.ts',
        ],
    },
    {
        // types in JSDoc are wanted in plain JavaScript files, they are the only type information there
        files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
        rules: {
            'jsdoc/check-tag-names': ['warn', { typed: false }],
        },
    },
    {
        // you may disable some 'jsdoc' warnings - but using jsdoc is highly recommended
        // as this improves maintainability. jsdoc warnings will not block buiuld process.
        rules: {
            // 'jsdoc/require-jsdoc': 'off',
            // 'jsdoc/require-param': 'off',
            // 'jsdoc/require-param-description': 'off',
            // 'jsdoc/require-returns-description': 'off',
            // 'jsdoc/require-returns-check': 'off',
        },
    },
];
