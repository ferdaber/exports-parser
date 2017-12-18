import chalk from 'chalk'

export function flatten<T>(array: (T | T[] | undefined)[]) {
    const filteredArray = array.filter(Boolean) as (T | T[])[]
    return filteredArray.reduce((flatArray: T[], el) => flatArray.concat(el), [])
}

export function warn(message: string) {
    return chalk.bgYellowBright.black.bold('WARN') + ' ' + message
}

export function report(moduleExports: ModuleExports, filePath: string) {
    const { hasDefaultExport, namedExports, defaultExportName } = moduleExports
    console.log(chalk.bold(`Results for ${filePath}:`))
    console.log(
        hasDefaultExport
            ? defaultExportName ? chalk.bold('Default export: ') + defaultExportName : warn('No default export name')
            : warn('No default export found')
    )
    console.log(chalk.bold('Named exports:'), namedExports)
    console.log('\n')
}
