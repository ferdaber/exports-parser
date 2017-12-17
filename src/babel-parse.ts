import { parse, PluginName } from 'babylon'

export function parseWithBabel(fileContent: string) {
    return parse(fileContent, {
        allowImportExportEverywhere: true,
        sourceType: 'module',
        plugins: [
            'asyncGenerators',
            'classProperties',
            'decorators',
            'dynamicImport',
            'flow',
            'jsx',
            'objectRestSpread'
        ] as PluginName[]
    })
}
