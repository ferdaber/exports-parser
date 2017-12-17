#!/usr/bin/env node

const resolveCwd = require('resolve-cwd')
const { resolve } = require('path')
const { readFile, readdir } = require('fs')
const { argv } = require('yargs')
const prettyFormat = require('pretty-format')
const { findExports } = require('./index')

const { _, nodeModules } = argv

const IGNORE_DIRS = ['.bin', '@types']

function parse(filePath) {
    const resolvedFilePath = resolve(filePath)
    const isJson = /.json$/.test(resolvedFilePath)
    readFile(resolvedFilePath, 'utf8', (err, fileContent) => {
        const moduleExports = findExports(fileContent, resolvedFilePath, isJson)
        console.log(`Results for ${resolvedFilePath}:`)
        console.log(prettyFormat(moduleExports))
    })
}

if (nodeModules) {
    readdir(resolve('node_modules'), (err, dirs) => {
        dirs.filter(dirName => !IGNORE_DIRS.some(ignored => ignored === dirName)).forEach(dirName => {
            const modulePath = resolveCwd.silent(dirName)
            if (modulePath && /\.(js|ts|jsx|tsx)$/.test(modulePath)) {
                console.log(`Parsing ${modulePath}...`)
                parse(modulePath)
            }
        })
    })
} else {
    const filePath = resolve(_[0])
    const modulePath = resolveCwd.silent(_[0])
    parse(modulePath || filePath)
}
