#!/usr/bin/env node

import * as requireResolve from 'resolve'
import chalk from 'chalk'
const { resolve } = require('path')
const { readFile, readdir } = require('fs')
const { argv } = require('yargs')
const { findExports, guessDefaultExport } = require('./index')

const { _, nodeModules, dependenciesOnly, noDevDependencies } = argv

const IGNORE_DIRS = ['.bin', '@types']

if (nodeModules) {
    readdir(resolve('node_modules'), (err, dirs) => {
        dirs.filter(dirName => !IGNORE_DIRS.some(ignored => ignored === dirName)).forEach(parseModule)
    })
} else if (dependenciesOnly) {
    const packageJson = require(resolve('package.json'))
    const { dependencies, devDependencies } = packageJson
    Object.keys({ ...dependencies, ...(!noDevDependencies && devDependencies) })
        .filter(module => !IGNORE_DIRS.some(ignored => module.startsWith(ignored)))
        .forEach(parseModule)
} else {
    let modulePath
    const filePath = resolve(_[0])
    try {
        modulePath = requireResolveHere(_[0])
    } catch (e) {}
    parse(modulePath || filePath)
}

function warn(message) {
    return chalk.bgYellowBright.black.bold('WARN') + ' ' + message
}

function requireResolveHere(modulePath) {
    return requireResolve.sync(modulePath, { basedir: process.cwd() })
}

function parseModule(moduleName) {
    try {
        const modulePath = requireResolveHere(moduleName)
        parse(modulePath)
    } catch (e) {
        console.log(warn(`Could not resolve module ${moduleName}`))
    }
}

function parse(filePath) {
    const resolvedFilePath = resolve(filePath)
    const isJson = /.json$/.test(resolvedFilePath)
    readFile(resolvedFilePath, 'utf8', (err, fileContent) => {
        const { defaultExportName, hasDefaultExport, namedExports } = findExports(fileContent, resolvedFilePath, isJson)
        console.log(chalk.bold(`Results for ${resolvedFilePath}:`))
        console.log(
            hasDefaultExport
                ? defaultExportName
                  ? chalk.bold('Default export: ') + defaultExportName
                  : warn('No default export name')
                : warn('No default export found, best guess is: ' + guessDefaultExport(resolvedFilePath))
        )
        console.log(chalk.bold('Named exports:'), namedExports)
        console.log('\n')
    })
}
