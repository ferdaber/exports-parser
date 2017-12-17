import * as Babel from 'babel-types'

import { flatten } from './helpers'

interface BlockFunctionExpression extends Babel.FunctionExpression {
    body: Babel.BlockStatement
}

interface BlockArrowFunctionExpression extends Babel.ArrowFunctionExpression {
    body: Babel.BlockStatement
}

type DeclarationType<D extends Babel.Declaration> = D['type']

type ExpressionType<E extends Babel.Expression> = E['type']

export function isFunctionExpression(
    expression: Babel.Expression
): expression is Babel.FunctionExpression | Babel.ArrowFunctionExpression {
    return expression.type === 'ArrowFunctionExpression' || expression.type === 'FunctionExpression'
}

export function isBlockFunctionExpression(
    expression: Babel.Expression
): expression is BlockFunctionExpression | BlockArrowFunctionExpression {
    return isFunctionExpression(expression) && expression.body.type === 'BlockStatement'
}

// check if expression is an identifier with a certain name
export function isIdentifierNamed(expression: Babel.Expression, idName: string): expression is Babel.Identifier {
    return expression && expression.type === 'Identifier' && expression.name === idName
}

// check if expression is one of these: objectName.propName || objectName['propName']
export function isMemberExpressionAccessing(
    expression: Babel.Expression,
    objectName: string,
    propName: string
): expression is Babel.MemberExpression {
    return (
        expression &&
        expression.type === 'MemberExpression' &&
        expression.object.type === 'Identifier' &&
        expression.object.name === objectName &&
        ((expression.property.type === 'StringLiteral' && expression.property.value === propName) ||
            isIdentifierNamed(expression.property, propName))
    )
}

export function isExpressionAccessInSet(set: Set<string> | Map<string, any>, expression: Babel.Expression) {
    if (expression.type !== 'MemberExpression' && expression.type !== 'Identifier') return false
    const name =
        expression.type === 'MemberExpression' && expression.object.type === 'Identifier'
            ? `${expression.object.name}.` +
              (expression.property.type === 'StringLiteral'
                  ? expression.property.value
                  : getIdName(expression.property))
            : getIdName(expression)
    return set.has(name)
}

export function getIdName(exp: Babel.Expression | Babel.LVal) {
    return (<Babel.Identifier>exp).name
}

export const declarationTypeNameSwitchMap: Partial<
    { [T in DeclarationType<Babel.Declaration>]: (declaration: Babel.Declaration) => string | string[] }
> = {
    ClassDeclaration(declaration) {
        return getIdName((<Babel.ClassDeclaration>declaration).id)
    },
    FunctionDeclaration(declaration) {
        return getIdName((<Babel.FunctionDeclaration>declaration).id)
    },
    VariableDeclaration(declaration) {
        return flatten(
            (<Babel.VariableDeclaration>declaration).declarations.map(declarator => getLhsName(declarator.id))
        )
    }
}

export const expressionTypeNameSwitchMap: Partial<
    { [T in ExpressionType<Babel.Expression>]: (expression: Babel.Expression) => string | string[] }
> = {
    AssignmentExpression(expression) {
        const { left } = expression as Babel.AssignmentExpression
        return getLhsName(left)
    },
    ClassExpression(expression) {
        return (expression.type === 'ClassExpression' && expression.id && getIdName(expression.id)) || ''
    },
    FunctionExpression(expression) {
        return (expression.type === 'FunctionExpression' && expression.id && getIdName(expression.id)) || ''
    },
    Identifier(expression) {
        return getIdName(<Babel.Identifier>expression)
    },
    ObjectExpression(expression) {
        const namedProps = (<Babel.ObjectExpression>expression).properties.filter(
            prop => (prop.type === 'ObjectMethod' || prop.type === 'ObjectProperty') && !prop.computed
        )
        return (<Array<Babel.ObjectMethod | Babel.ObjectProperty>>namedProps).map(
            prop => (prop.key.type === 'Identifier' ? prop.key.name : (<Babel.StringLiteral>prop.key).value)
        )
    },
    MemberExpression(expression) {
        let member = expression
        while (member.type === 'MemberExpression') {
            member = member.property
        }
        return getIdName(<Babel.Identifier>member)
    }
}

export function getLhsName(lhs: Babel.LVal) {
    switch (lhs.type) {
        case 'ArrayPattern':
            return lhs.elements.map((el: any) => getIdName(el.type === 'AssignmentPattern' ? el.left : el))
        case 'ObjectPattern':
            return lhs.properties.map(prop => getIdName(prop.type === 'RestProperty' ? prop.argument : prop.key))
        default:
            return getIdName(lhs)
    }
}
