export interface ModuleExports {
    namedExports: string[]
    hasDefaultExport?: boolean
    defaultExportName?: string
}

export function findExports(fileContent: string, absoluteFilePath: string, isJson?: boolean): ModuleExports
export function guessDefaultExport(absoluteFilePath: string): string
export function report(ModuleExports: ModuleExports, filePath: string): void

export default findExports
