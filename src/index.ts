import * as camelcase from 'camelcase'
import * as Babel from 'babel-types'
import * as resolve from 'resolve'
import chalk from 'chalk'
import { readFileSync } from 'fs'
import { parse } from 'path'

import { parseWithBabel } from './babel-parse'
import { flatten } from './helpers'
import {
    declarationTypeNameSwitchMap,
    expressionTypeNameSwitchMap,
    getIdName,
    getLhsName,
    isBlockFunctionExpression,
    isExpressionAccessInSet,
    isIdentifierNamed,
    isMemberExpressionAccessing
} from './babel-helpers'

interface ModuleExports {
    namedExports: string[]
    hasDefaultExport?: boolean
    defaultExportName?: string
}

type ExportDefaultDeclarationType = Babel.ExportDefaultDeclaration['declaration']

const GENERIC_NAMES = ['dist', 'bin', 'lib', 'src', 'index']

let debugLocation: Babel.SourceLocation

export function findExports(fileContent: string, absoluteFilePath: string, isJson?: boolean): ModuleExports {
    try {
        if (isJson) {
            return {
                namedExports: Object.keys(JSON.parse(fileContent)),
                hasDefaultExport: true
            }
        }
        const ast = parseWithBabel(fileContent)
        const astBody = findModuleBody(ast)
        astBody.forEach = function(callbackfn, thisArg) {
            Array.prototype.forEach.call(
                this || thisArg,
                (value: Babel.Statement, index: number, array: Babel.Statement[]) => {
                    debugLocation = value.loc
                    callbackfn(value, index, array)
                }
            )
        }
        const moduleExportsAliases = findModuleExportsAliases(astBody)
        const rootIdentifiers = findRootObjectIdentifiers(astBody)
        return findExportNames(astBody, moduleExportsAliases, absoluteFilePath, rootIdentifiers)
    } catch (error) {
        const name = chalk.bold.bgRedBright.whiteBright('ERROR')
        let message = `Parsing file ${absoluteFilePath}. `
        if (debugLocation) {
            message += `Occurred between lines ${debugLocation.start.line} and ${
                debugLocation.end.line
            } in the source file.`
        }
        message += chalk.bold('\n\nOriginal Error Info:') + `\n${error.name}: ${error.message}`
        throw Object.assign(new Error(), error, {
            name,
            message
        })
    }
}
export default findExports

export function guessDefaultExport(absoluteFilePath: string) {
    // try to assing a default export name when none was found but a default export exists
    let { dir, name } = parse(absoluteFilePath)
    while (GENERIC_NAMES.some(ignore => name === ignore)) {
        const pathInfo = parse(dir)
        name = pathInfo.name
        dir = pathInfo.dir
    }
    return camelcase(name)
}

function findModuleBody(ast: Babel.File) {
    const body = ast.program.body
    // if the entire module is an IIFE, try finding the function's body
    if (
        body.length === 1 &&
        body[0].type === 'ExpressionStatement' &&
        (body[0] as Babel.ExpressionStatement).expression.type === 'CallExpression'
    ) {
        const { callee } = (body[0] as Babel.ExpressionStatement).expression as Babel.CallExpression
        // IIFE with an instance call:
        // (function(){ ... }).call(this)
        if (callee.type === 'MemberExpression') {
            if (isBlockFunctionExpression(callee.object)) {
                return callee.object.body.body
            }
        } else if (isBlockFunctionExpression(callee)) {
            return callee.body.body
        }
    }
    return body
}

function findModuleExportsAliases(body: Babel.Statement[]) {
    // find other variables that point to module.exports
    const exportNames = new Set(['module.exports', 'exports'])
    body.forEach(
        statement =>
            statement.type === 'VariableDeclaration' &&
            statement.declarations.forEach(declarator => {
                if (
                    declarator.id.type === 'Identifier' &&
                    (isMemberExpressionAccessing(declarator.init, 'module', 'exports') ||
                        isIdentifierNamed(declarator.init, 'exports'))
                ) {
                    exportNames.add(getIdName(declarator.id))
                }
            })
    )
    return exportNames
}

function findRootObjectIdentifiers(body: Babel.Statement[]) {
    // find proper objects defined at the root level and store their properties
    // used for a case like:
    // let myExports = { a, b, c }; myExports.d = e
    // module.exports = myExports
    const rootIdentifiers: Map<string, string | string[]> = new Map()
    body.forEach(statement => {
        // myExports.foo.bar = ...
        if (
            statement.type === 'ExpressionStatement' &&
            statement.expression.type === 'AssignmentExpression' &&
            statement.expression.left.type === 'MemberExpression'
        ) {
            let { object, property } = statement.expression.left
            while (object.type === 'MemberExpression') {
                property = object.property
                object = object.object
            }
            const objectName = getIdName(object)
            if (objectName) {
                if (rootIdentifiers.has(objectName)) {
                    const names = rootIdentifiers.get(objectName)
                    Array.isArray(names) && names.push(getIdName(property))
                } else {
                    rootIdentifiers.set(objectName, [getIdName(property)])
                }
            }
        }
        // let/var/const myExports = ...
        if (statement.type === 'VariableDeclaration') {
            statement.declarations.filter(declarator => declarator.init).forEach(({ id, init }) => {
                // let/var/const myExports = { a, b(), c: 'c', ... }
                if (init.type === 'ObjectExpression' && expressionTypeNameSwitchMap.ObjectExpression) {
                    rootIdentifiers.set(getIdName(id), expressionTypeNameSwitchMap.ObjectExpression(init) as string[])
                }
                // let/var/const myExports = function a() { ... } / class { ... }
                if (init.type === 'FunctionExpression' || init.type === 'ClassExpression') {
                    rootIdentifiers.set(getIdName(id), init.id ? init.id.name : getIdName(id))
                }
            })
        }
        // function foo () { ... } / class klass { ... }
        if ((statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration') && statement.id) {
            rootIdentifiers.set(getIdName(statement.id), getIdName(statement.id))
        }
    })
    return rootIdentifiers
}

function findExportNames(
    body: Babel.Statement[],
    moduleExportsAliases: Set<string>,
    absoluteFilePath: string,
    rootIdentifiers: Map<string, string | string[]>
) {
    const moduleExports: ModuleExports = {
        namedExports: []
    }
    body.forEach(statement => {
        addESExports(moduleExports, statement)
        addCJSExports(moduleExports, statement, moduleExportsAliases, absoluteFilePath, rootIdentifiers)
    })
    // try to assing a default export name when none was found but a default export exists
    if (moduleExports.hasDefaultExport && !moduleExports.defaultExportName) {
        moduleExports.defaultExportName = guessDefaultExport(absoluteFilePath)
    }
    // filter out common __esModule interop export
    moduleExports.namedExports = moduleExports.namedExports.filter(name => name !== '__esModule')
    return moduleExports
}

function addESExports(moduleExports: ModuleExports, statement: Babel.Statement) {
    if (statement.type === 'ExportNamedDeclaration') {
        // export { ... }
        if (statement.specifiers.length) {
            statement.specifiers.forEach(specifier => {
                // export { foo as default, ... }
                if (specifier.exported.name === 'default') {
                    moduleExports.hasDefaultExport = true
                    moduleExports.defaultExportName = specifier.local.name
                } else {
                    // export { foo, bar }
                    moduleExports.namedExports.push(specifier.exported.name)
                }
            })
        }
        // export let/var/const/class/function
        if (statement.declaration) {
            const typeMap = declarationTypeNameSwitchMap[statement.declaration.type]
            const names = typeMap && typeMap(statement.declaration)
            names &&
                (Array.isArray(names)
                    ? moduleExports.namedExports.push(...names)
                    : moduleExports.namedExports.push(names))
        }
    }
    // export default { ... }
    if (statement.type === 'ExportDefaultDeclaration') {
        moduleExports.hasDefaultExport = true
        const { declaration } = statement
        const typeMap =
            declarationTypeNameSwitchMap[(<Babel.Declaration>declaration).type] ||
            expressionTypeNameSwitchMap[(<Babel.Expression>declaration).type]
        if (typeMap) {
            const names = (<(declaration: ExportDefaultDeclarationType) => string | string[]>typeMap)(declaration)
            if (!Array.isArray(names)) {
                moduleExports.defaultExportName = names
            }
        }
    }
    return moduleExports
}

function addCJSExports(
    moduleExports: ModuleExports,
    statement: Babel.Statement,
    moduleExportsAliases: Set<string>,
    absoluteFilePath: string,
    rootIdentifiers: Map<string, string | string[]>
) {
    if (statement.type === 'ExpressionStatement') {
        const { expression } = statement
        // {Object, Reflect}.defineProperty(module.exports, 'export-name', ...)
        if (
            expression.type === 'CallExpression' &&
            (isMemberExpressionAccessing(expression.callee, 'Object', 'defineProperty') ||
                isMemberExpressionAccessing(expression.callee, 'Reflect', 'defineProperty')) &&
            expression.arguments.length >= 2 &&
            isExpressionAccessInSet(moduleExportsAliases, <Babel.Expression>expression.arguments[0]) &&
            expression.arguments[1].type === 'StringLiteral'
        ) {
            const name = expression.arguments[1] as Babel.StringLiteral
            moduleExports.namedExports.push(name.value)
        }
        if (expression.type === 'AssignmentExpression') {
            addCJSExportsInAssignment(
                moduleExports,
                expression,
                moduleExportsAliases,
                absoluteFilePath,
                rootIdentifiers
            )
        }
    }
    if (statement.type === 'VariableDeclaration') {
        statement.declarations.forEach(declarator => {
            if (declarator.init && declarator.init.type === 'AssignmentExpression') {
                addCJSExportsInAssignment(
                    moduleExports,
                    declarator.init,
                    moduleExportsAliases,
                    absoluteFilePath,
                    rootIdentifiers
                )
            }
        })
    }
    return moduleExports
}

function addCJSExportsInAssignment(
    moduleExports: ModuleExports,
    expression: Babel.AssignmentExpression,
    moduleExportsAliases: Set<string>,
    absoluteFilePath: string,
    rootIdentifiers: Map<string, string | string[]>
) {
    if (expression.right.type === 'AssignmentExpression') {
        addCJSExportsInAssignment(
            moduleExports,
            expression.right,
            moduleExportsAliases,
            absoluteFilePath,
            rootIdentifiers
        )
    }
    // module.exports = ... or any of its aliases
    if (isExpressionAccessInSet(moduleExportsAliases, <Babel.Expression>expression.left)) {
        let { right } = expression
        // module.exports = ... ? true : false
        // resolve ternary expressions in exports to the 'true' outcome
        while (right.type === 'ConditionalExpression') {
            right = right.consequent
        }
        // module.exports = require('other-module')
        if (
            right.type === 'CallExpression' &&
            right.callee.type === 'Identifier' &&
            right.callee.name === 'require' &&
            right.arguments.length &&
            right.arguments[0].type === 'StringLiteral'
        ) {
            const importPath = (<Babel.StringLiteral>right.arguments[0]).value
            const resolvedImportPath = resolve.sync(importPath, {
                basedir: parse(absoluteFilePath).dir,
                extensions: ['.js', '.jsx', '.json', '.node']
            })
            const fileContent = readFileSync(resolvedImportPath, 'utf8')
            Object.assign(moduleExports, findExports(fileContent, resolvedImportPath))
        } else {
            moduleExports.hasDefaultExport = true
            const typeMap = expressionTypeNameSwitchMap[right.type]
            const names =
                right.type === 'Identifier' && rootIdentifiers.has(right.name)
                    ? // module.exports = myExports (where myExports was already defined)
                      // resolve indirect reference
                      rootIdentifiers.get(right.name)
                    : typeMap && typeMap(right)
            // module.exports = { exportA: ..., exportB, exportC(): {...}, ... }
            if (Array.isArray(names)) {
                moduleExports.namedExports = names
            } else if (names != null) {
                // module.exports = literal/function/class
                moduleExports.defaultExportName = names
            }
        }
    } else {
        // module.exports.foo = ... or any of its aliases
        let object = expression.left as Babel.Expression,
            property: Babel.Expression | undefined,
            parentProperty: Babel.Expression | undefined
        while (object.type === 'MemberExpression') {
            parentProperty = property
            property = object.property
            object = object.object
        }
        const objectName = getIdName(object)
        if (objectName && property) {
            const propName = getIdName(property)
            // module.exports.foo =
            const name =
                parentProperty && moduleExportsAliases.has(`${objectName}.${propName}`)
                    ? getIdName(parentProperty)
                    : // exports.foo = ...
                      moduleExportsAliases.has(objectName) ? propName : undefined
            // module.exports.default = foo
            if (name === 'default') {
                moduleExports.hasDefaultExport = true
                if (expression.right.type === 'Identifier') {
                    const isIndirectReference =
                        rootIdentifiers.has(expression.right.name) &&
                        !Array.isArray(rootIdentifiers.get(expression.right.name))
                    moduleExports.defaultExportName = isIndirectReference
                        ? (rootIdentifiers.get(expression.right.name) as string)
                        : expression.right.name
                }
            } else if (name) {
                moduleExports.namedExports.push(name)
            }
        }
    }
}
